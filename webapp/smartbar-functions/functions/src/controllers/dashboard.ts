import { db } from '../firebase';
import * as admin from 'firebase-admin';
import ShiftCtrl, { ShiftDef, shiftForDate, localParts } from './shift';

const READINGS = 'inventory_readings';
const EVENTS = 'inventory_events';

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const ml = (n: number) => Math.round(Number(n) || 0);

/** Event types that represent a documented loss rather than a sale. */
const LOSS_TYPES = ['breakage', 'spoilage', 'comp', 'transfer_out'] as const;
const GAIN_TYPES = ['delivery', 'transfer_in'] as const;

const LOSS_LABELS: Record<string, string> = {
  breakage: 'Breakage',
  spoilage: 'Spoilage',
  comp: 'Comps & giveaways',
  transfer_out: 'Transfers out',
};
const LOSS_COLORS: Record<string, string> = {
  breakage: '#dc3545',
  spoilage: '#dc3545',
  comp: '#f0ad4e',
  transfer_out: '#6f42c1',
};

interface ProductRollup {
  product_id: string | null;
  barcode: string;
  name: string;
  brand: string;
  category_id: string;
  category: string;
  volume_ml: number;
  cost_per_bottle: number;
  pour_price: number | null;
  pour_volume_ml: number | null;
  on_hand_ml: number;
  on_hand_value: number;
  consumed_ml: number;
  consumed_value: number;
  waste_ml: number;
  waste_value: number;
  revenue_value: number | null;
  pour_cost_pct: number | null;
  scans: number;
  last_scan: string | null;
  /** Why revenue/pour cost could not be computed, if they could not be. */
  missing: string[];
  /** Volume excluded from consumption as implausible (bottle swaps, mis-scans). */
  unexplained_drop_ml: number;
  unexplained_count: number;
  restock_count: number;
}

export default class DashboardCtrl {
  getBusinessId(req: any): string | null {
    if (req.user?.business?.[0]?._id) return req.user.business[0]._id;
    if (req.user?.business?.[0]) return req.user.business[0];
    if (req.device?.business) return req.device.business;
    return null;
  }

  /**
   * Live operational dashboard for the caller's business.
   *
   * Everything here is derived from `inventory_readings` (what the scale saw)
   * and `inventory_events` (what a human logged). Nothing is synthesised. Where
   * an input is missing — most commonly `pour_price` — the corresponding output
   * is null rather than estimated, and the gap is reported in `coverage` so the
   * UI can tell the operator what to fill in.
   *
   * Query params:
   *   days  — window length, default 7, max 90
   */
  get = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) {
        // 400, not 403: the caller is authenticated, their account just isn't
        // attached to a business yet. A 403 here would trip the client's
        // auth interceptor and log them out in a loop.
        return res.status(400).json({
          error: 'No business is associated with this account.',
          code: 'NO_BUSINESS',
        });
      }

      const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);

      const bizDoc = await db.collection('businesses').doc(business).get();
      const bizData: any = bizDoc.exists ? bizDoc.data() : {};
      const timeZone = bizData.timezone || 'UTC';

      const now = new Date();
      const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      // Four whole weeks back, for the trend panel.
      const trendStart = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

      const [readingsSnap, eventsSnap, categoriesSnap, shifts] = await Promise.all([
        db.collection(READINGS)
          .where('business', '==', business)
          .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(trendStart))
          .orderBy('timestamp', 'asc')
          .get(),
        db.collection(EVENTS)
          .where('business', '==', business)
          .where('date', '>=', localParts(trendStart, timeZone).ymd)
          .get(),
        db.collection('categories').get(),
        ShiftCtrl.listForBusiness(business),
      ]);

      const categoryNames = new Map<string, string>();
      categoriesSnap.docs.forEach(d => {
        const data: any = d.data();
        categoryNames.set(d.id, data.name || data.path || d.id);
      });

      const readings = readingsSnap.docs.map(d => {
        const data: any = d.data();
        return { _id: d.id, ...data, _ts: data.timestamp?.toDate?.() || null };
      }).filter(r => r._ts);

      const events = eventsSnap.docs.map(d => ({ _id: d.id, ...d.data() } as any));

      if (!readings.length && !events.length) {
        return res.status(200).json(this.emptyPayload(business, bizData, days, shifts, timeZone));
      }

      // ─── Per-product rollup ────────────────────────────────────────────
      // Group readings by barcode in ascending time order so consecutive
      // pairs can be differenced.
      const byBarcode = new Map<string, any[]>();
      for (const r of readings) {
        if (!byBarcode.has(r.barcode)) byBarcode.set(r.barcode, []);
        byBarcode.get(r.barcode)!.push(r);
      }

      // Product metadata comes from the bottles catalog, not the reading, so a
      // price correction applies retroactively instead of being frozen at
      // scan time.
      const productIds = new Set<string>();
      byBarcode.forEach(list => { const p = list[list.length - 1].product_id; if (p) productIds.add(p); });
      const bottleDocs = await Promise.all(
        Array.from(productIds).map(id => db.collection('bottles').doc(id).get())
      );
      const bottles = new Map<string, any>();
      bottleDocs.forEach(d => { if (d.exists) bottles.set(d.id, d.data()); });

      // Events grouped by barcode for loss/gain attribution.
      const eventsByBarcode = new Map<string, any[]>();
      for (const e of events) {
        const key = e.barcode || '';
        if (!eventsByBarcode.has(key)) eventsByBarcode.set(key, []);
        eventsByBarcode.get(key)!.push(e);
      }

      const products: ProductRollup[] = [];
      // Consumption deltas kept for day/week/shift bucketing.
      const deltas: { ts: Date; barcode: string; consumed_ml: number; cost: number; revenue: number | null }[] = [];
      // Readings excluded from consumption because they cannot represent a
      // pour. Surfaced rather than dropped: these are the events an operator
      // most needs to see.
      const unexplained: any[] = [];

      for (const [barcode, list] of byBarcode) {
        const latest = list[list.length - 1];
        const meta = latest.product_id ? bottles.get(latest.product_id) || {} : {};

        const volumeMl = Number(meta.bottle_volume_ml || latest.bottle_volume_ml || 0);
        const costPerBottle = Number(meta.cost_per_bottle || latest.cost_per_bottle || 0);
        const pourPrice = Number.isFinite(Number(meta.pour_price)) && Number(meta.pour_price) > 0
          ? Number(meta.pour_price) : null;
        const pourVolume = Number.isFinite(Number(meta.pour_volume_ml)) && Number(meta.pour_volume_ml) > 0
          ? Number(meta.pour_volume_ml) : null;

        const missing: string[] = [];
        if (!volumeMl) missing.push('bottle_volume_ml');
        if (!costPerBottle) missing.push('cost_per_bottle');
        if (!pourPrice) missing.push('pour_price');
        if (!pourVolume) missing.push('pour_volume_ml');

        // Consumption = sum of *decreases* between consecutive readings inside
        // the window. Increases are restocks (a fresh bottle on the scale, or a
        // delivery) and are deliberately not counted as negative consumption.
        let consumedMl = 0;
        let scans = 0;
        let anomalyMl = 0;
        let anomalyCount = 0;
        let restockCount = 0;
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (r._ts < windowStart) continue;
          scans++;
          if (i === 0) continue;
          const prev = list[i - 1];
          const drop = Number(prev.total_volume_on_hand_ml || 0) - Number(r.total_volume_on_hand_ml || 0);

          if (drop <= 0) {
            // Stock went up. A fresh bottle on the scale or a delivery — not
            // negative consumption.
            if (drop < 0) restockCount++;
            continue;
          }

          // A drop larger than a full bottle between two readings cannot be a
          // pour: the bottle on the scale was swapped, removed, or mis-read.
          // Counting it would inflate consumption and pour cost enormously.
          // It is excluded from consumption but *reported*, because a silent
          // exclusion hides exactly the events worth investigating.
          if (volumeMl > 0 && drop > volumeMl) {
            anomalyMl += drop;
            anomalyCount++;
            unexplained.push({
              barcode,
              product_name: meta.name || latest.product_name || barcode,
              timestamp: r._ts.toISOString(),
              drop_ml: ml(drop),
              bottle_volume_ml: volumeMl,
              reason: 'Drop exceeds one full bottle — likely a bottle swap or mis-scan.',
            });
            continue;
          }

          consumedMl += drop;
          const cost = volumeMl > 0 && costPerBottle > 0 ? (drop / volumeMl) * costPerBottle : 0;
          const revenue = pourPrice && pourVolume ? (drop / pourVolume) * pourPrice : null;
          deltas.push({ ts: r._ts, barcode, consumed_ml: drop, cost, revenue });
        }

        // Documented losses from logged events, in the window.
        const windowYmd = localParts(windowStart, timeZone).ymd;
        const prodEvents = (eventsByBarcode.get(barcode) || []).filter(e => String(e.date || '') >= windowYmd);
        let wasteMl = 0;
        for (const e of prodEvents) {
          if (!(LOSS_TYPES as readonly string[]).includes(e.event_type)) continue;
          // Prefer a measured weight if the logger supplied one; otherwise fall
          // back to whole bottles.
          wasteMl += e.weight_g != null ? Number(e.weight_g) : Number(e.quantity || 0) * volumeMl;
        }

        const toValue = (vol: number) =>
          volumeMl > 0 && costPerBottle > 0 ? money((vol / volumeMl) * costPerBottle) : 0;

        const consumedValue = toValue(consumedMl);
        const revenueValue = pourPrice && pourVolume ? money((consumedMl / pourVolume) * pourPrice) : null;
        // Pour cost % is the industry definition: cost of product poured
        // divided by revenue from those pours. Undefined without revenue.
        const pourCostPct = revenueValue && revenueValue > 0
          ? money((consumedValue / revenueValue) * 100) : null;

        const categoryId = String(meta.category || latest.category || '');

        products.push({
          product_id: latest.product_id || null,
          barcode,
          name: meta.name || latest.product_name || 'Unknown product',
          brand: meta.brand || latest.product_brand || '',
          category_id: categoryId,
          category: categoryNames.get(categoryId) || 'Uncategorized',
          volume_ml: volumeMl,
          cost_per_bottle: costPerBottle,
          pour_price: pourPrice,
          pour_volume_ml: pourVolume,
          on_hand_ml: ml(latest.total_volume_on_hand_ml),
          on_hand_value: money(latest.total_value_on_hand),
          consumed_ml: ml(consumedMl),
          consumed_value: consumedValue,
          waste_ml: ml(wasteMl),
          waste_value: toValue(wasteMl),
          revenue_value: revenueValue,
          pour_cost_pct: pourCostPct,
          scans,
          last_scan: latest._ts.toISOString(),
          missing,
          unexplained_drop_ml: ml(anomalyMl),
          unexplained_count: anomalyCount,
          restock_count: restockCount,
        });
      }

      products.sort((a, b) => b.consumed_value - a.consumed_value);

      // ─── Summary ───────────────────────────────────────────────────────
      const totalOnHand = money(products.reduce((s, p) => s + p.on_hand_value, 0));
      const totalConsumed = money(products.reduce((s, p) => s + p.consumed_value, 0));
      const totalWaste = money(products.reduce((s, p) => s + p.waste_value, 0));

      const priced = products.filter(p => p.revenue_value !== null);
      const totalRevenue = priced.length ? money(priced.reduce((s, p) => s + (p.revenue_value || 0), 0)) : null;
      const pricedCost = priced.reduce((s, p) => s + p.consumed_value, 0);
      // Weighted across products, not a mean of percentages — a mean would let
      // a rarely-poured bottle swing the figure as much as the house pour.
      const avgPourCost = totalRevenue && totalRevenue > 0 ? money((pricedCost / totalRevenue) * 100) : null;

      // ─── Daily series (business-local days) ────────────────────────────
      const dayKeys: string[] = [];
      for (let i = days - 1; i >= 0; i--) {
        dayKeys.push(localParts(new Date(now.getTime() - i * 86400000), timeZone).ymd);
      }
      const dayBuckets = new Map<string, { consumed_ml: number; cost: number; revenue: number | null }>();
      dayKeys.forEach(k => dayBuckets.set(k, { consumed_ml: 0, cost: 0, revenue: null }));
      for (const d of deltas) {
        const key = localParts(d.ts, timeZone).ymd;
        const bucket = dayBuckets.get(key);
        if (!bucket) continue;
        bucket.consumed_ml += d.consumed_ml;
        bucket.cost += d.cost;
        if (d.revenue !== null) bucket.revenue = (bucket.revenue || 0) + d.revenue;
      }
      const wasteByDay = new Map<string, number>();
      for (const e of events) {
        if (!(LOSS_TYPES as readonly string[]).includes(e.event_type)) continue;
        const key = String(e.date || '');
        const prod = products.find(p => p.barcode === e.barcode);
        const vol = e.weight_g != null ? Number(e.weight_g) : Number(e.quantity || 0) * (prod?.volume_ml || 0);
        wasteByDay.set(key, (wasteByDay.get(key) || 0) + vol);
      }
      const dailyConsumption = dayKeys.map(key => {
        const b = dayBuckets.get(key)!;
        return {
          date: key,
          day: new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
          consumed_ml: ml(b.consumed_ml),
          waste_ml: ml(wasteByDay.get(key) || 0),
          revenue: b.revenue === null ? null : money(b.revenue),
        };
      });

      // ─── Weekly trend (4 buckets of 7 days) ────────────────────────────
      const weeklyTrend = [3, 2, 1, 0].map(weeksAgo => {
        const end = new Date(now.getTime() - weeksAgo * 7 * 86400000);
        const start = new Date(end.getTime() - 7 * 86400000);
        const inWeek = deltas.filter(d => d.ts >= start && d.ts < end);
        const consumedValue = inWeek.reduce((s, d) => s + d.cost, 0);
        const startYmd = localParts(start, timeZone).ymd;
        const endYmd = localParts(end, timeZone).ymd;
        const weekWaste = events
          .filter(e => (LOSS_TYPES as readonly string[]).includes(e.event_type))
          .filter(e => String(e.date || '') >= startYmd && String(e.date || '') < endYmd)
          .reduce((s, e) => {
            const prod = products.find(p => p.barcode === e.barcode);
            const vol = e.weight_g != null ? Number(e.weight_g) : Number(e.quantity || 0) * (prod?.volume_ml || 0);
            return s + (prod && prod.volume_ml > 0 && prod.cost_per_bottle > 0
              ? (vol / prod.volume_ml) * prod.cost_per_bottle : 0);
          }, 0);
        // On-hand is a point-in-time figure: value of the last reading per
        // product at or before the end of that week.
        let inventoryValue = 0;
        for (const [, list] of byBarcode) {
          const last = [...list].reverse().find(r => r._ts < end);
          if (last) inventoryValue += Number(last.total_value_on_hand || 0);
        }
        return {
          week: weeksAgo === 0 ? 'This week' : `${weeksAgo}w ago`,
          inventory_value: money(inventoryValue),
          consumed_value: money(consumedValue),
          waste_value: money(weekWaste),
        };
      });

      // ─── Category breakdown ────────────────────────────────────────────
      const categoryMap = new Map<string, number>();
      products.forEach(p => categoryMap.set(p.category, (categoryMap.get(p.category) || 0) + p.consumed_value));
      const categoryTotal = Array.from(categoryMap.values()).reduce((s, v) => s + v, 0) || 1;
      const colors = ['#007bff', '#f0ad4e', '#28a745', '#dc3545', '#17a2b8', '#6f42c1', '#e83e8c'];
      const categoryBreakdown = Array.from(categoryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([category, value], i) => ({
          category,
          value: money(value),
          pct: Math.round((value / categoryTotal) * 100),
          color: colors[i % colors.length],
        }));

      // ─── Shift attribution ─────────────────────────────────────────────
      const shiftAgg = new Map<string, { cost: number; revenue: number | null; scans: number; consumed_ml: number }>();
      let unattributed = 0;
      for (const d of deltas) {
        const shift = shiftForDate(d.ts, shifts, timeZone);
        if (!shift) { unattributed++; continue; }
        const key = shift._id!;
        if (!shiftAgg.has(key)) shiftAgg.set(key, { cost: 0, revenue: null, scans: 0, consumed_ml: 0 });
        const agg = shiftAgg.get(key)!;
        agg.cost += d.cost;
        agg.scans++;
        agg.consumed_ml += d.consumed_ml;
        if (d.revenue !== null) agg.revenue = (agg.revenue || 0) + d.revenue;
      }
      const shiftPanel = shifts.filter(s => s.active).map(s => {
        const agg = shiftAgg.get(s._id!) || { cost: 0, revenue: null, scans: 0, consumed_ml: 0 };
        const pourCost = agg.revenue && agg.revenue > 0 ? money((agg.cost / agg.revenue) * 100) : null;
        const target = s.target_pour_cost_pct;
        return {
          _id: s._id,
          name: s.name,
          staff: s.staff_name || null,
          window: `${String(s.start_hour).padStart(2, '0')}:00–${String(s.end_hour).padStart(2, '0')}:00`,
          scans: agg.scans,
          consumed_ml: ml(agg.consumed_ml),
          consumed_value: money(agg.cost),
          revenue: agg.revenue === null ? null : money(agg.revenue),
          pour_cost: pourCost,
          target_pour_cost: target,
          variance: pourCost !== null && target !== null ? money(pourCost - target) : null,
          color: s.color || '#007bff',
        };
      });

      // ─── Documented losses (replaces the projection panels) ────────────
      const lossByType = new Map<string, { volume_ml: number; value: number; count: number }>();
      const windowYmd = localParts(windowStart, timeZone).ymd;
      for (const e of events) {
        if (String(e.date || '') < windowYmd) continue;
        const type = e.event_type;
        if (!(LOSS_TYPES as readonly string[]).includes(type)) continue;
        const prod = products.find(p => p.barcode === e.barcode);
        const vol = e.weight_g != null ? Number(e.weight_g) : Number(e.quantity || 0) * (prod?.volume_ml || 0);
        const value = prod && prod.volume_ml > 0 && prod.cost_per_bottle > 0
          ? (vol / prod.volume_ml) * prod.cost_per_bottle : 0;
        if (!lossByType.has(type)) lossByType.set(type, { volume_ml: 0, value: 0, count: 0 });
        const agg = lossByType.get(type)!;
        agg.volume_ml += vol;
        agg.value += value;
        agg.count++;
      }
      const documentedLosses = (LOSS_TYPES as readonly string[]).map(type => {
        const agg = lossByType.get(type) || { volume_ml: 0, value: 0, count: 0 };
        return {
          type, label: LOSS_LABELS[type], color: LOSS_COLORS[type],
          volume_ml: ml(agg.volume_ml), value: money(agg.value), event_count: agg.count,
        };
      }).filter(r => r.event_count > 0);
      const totalDocumentedLoss = money(documentedLosses.reduce((s, r) => s + r.value, 0));

      const gainAgg = (GAIN_TYPES as readonly string[]).map(type => {
        const matching = events.filter(e => e.event_type === type && String(e.date || '') >= windowYmd);
        const value = matching.reduce((s, e) => {
          const prod = products.find(p => p.barcode === e.barcode);
          return s + (prod && prod.cost_per_bottle > 0 ? Number(e.quantity || 0) * prod.cost_per_bottle : 0);
        }, 0);
        return { type, label: type === 'delivery' ? 'Deliveries' : 'Transfers in', value: money(value), event_count: matching.length };
      }).filter(r => r.event_count > 0);

      // ─── Coverage: what is missing, so the UI can prompt for it ────────
      const missingPourPrice = products.filter(p => p.missing.includes('pour_price')).length;
      const missingCost = products.filter(p => p.missing.includes('cost_per_bottle')).length;
      const missingVolume = products.filter(p => p.missing.includes('bottle_volume_ml')).length;
      const coverage = {
        products_total: products.length,
        missing_pour_price: missingPourPrice,
        missing_cost_per_bottle: missingCost,
        missing_bottle_volume: missingVolume,
        revenue_available: totalRevenue !== null,
        shifts_configured: shifts.length,
        unattributed_deltas: unattributed,
      };

      // ─── Alerts, from real thresholds only ─────────────────────────────
      const alerts: any[] = [];
      if (missingVolume || missingCost) {
        alerts.push({
          type: 'warning', icon: '⚙',
          message: `${missingVolume || missingCost} product(s) are missing bottle volume or cost. On-hand value and pour cost cannot be calculated for them.`,
          time: null,
        });
      }
      if (missingPourPrice) {
        alerts.push({
          type: 'info', icon: '💲',
          message: `${missingPourPrice} product(s) have no pour price set, so revenue and pour cost are excluded for them.`,
          time: null,
        });
      }
      if (!shifts.length) {
        alerts.push({ type: 'info', icon: '🕑', message: 'No shifts are defined, so consumption cannot be attributed to a shift.', time: null });
      } else if (unattributed) {
        alerts.push({ type: 'info', icon: '🕑', message: `${unattributed} reading(s) fell outside every defined shift window.`, time: null });
      }
      const anomalyTotal = products.reduce((s, p) => s + p.unexplained_count, 0);
      if (anomalyTotal) {
        alerts.push({
          type: 'warning', icon: '🔍',
          message: `${anomalyTotal} reading(s) showed a drop larger than a full bottle and were excluded from consumption. Usually a bottle swap; worth confirming.`,
          time: null,
        });
      }
      products
        .filter(p => p.pour_cost_pct !== null && p.pour_cost_pct > 25)
        .slice(0, 3)
        .forEach(p => alerts.push({
          type: 'danger', icon: '🔴',
          message: `${p.name} pour cost is ${p.pour_cost_pct}% against a 18–22% target.`,
          time: p.last_scan,
        }));
      products
        .filter(p => p.waste_value > 0)
        .sort((a, b) => b.waste_value - a.waste_value)
        .slice(0, 2)
        .forEach(p => alerts.push({
          type: 'warning', icon: '⚠',
          message: `${p.name} has ${p.waste_ml}ml of documented loss ($${p.waste_value.toFixed(2)}) in this period.`,
          time: p.last_scan,
        }));

      res.status(200).json({
        business: { id: business, name: bizData.name || 'Your bar', timezone: timeZone },
        period: { days, start: windowStart.toISOString(), end: now.toISOString() },
        summary: {
          totalOnHand, totalConsumed, totalWaste,
          totalRevenue, avgPourCost,
          totalDocumentedLoss,
        },
        products,
        dailyConsumption,
        weeklyTrend,
        categoryBreakdown,
        shifts: shiftPanel,
        documentedLosses,
        inboundEvents: gainAgg,
        alerts,
        coverage,
        unexplained: unexplained.sort((a, b) => b.drop_ml - a.drop_ml).slice(0, 20),
      });
    } catch (err) {
      console.error('Dashboard failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  /** Shape-compatible response for a business with no data yet. */
  private emptyPayload(business: string, bizData: any, days: number, shifts: ShiftDef[], timeZone: string) {
    return {
      business: { id: business, name: bizData.name || 'Your bar', timezone: timeZone },
      period: { days, start: new Date(Date.now() - days * 86400000).toISOString(), end: new Date().toISOString() },
      summary: {
        totalOnHand: 0, totalConsumed: 0, totalWaste: 0,
        totalRevenue: null, avgPourCost: null, totalDocumentedLoss: 0,
      },
      products: [],
      dailyConsumption: [],
      weeklyTrend: [],
      categoryBreakdown: [],
      shifts: [],
      documentedLosses: [],
      inboundEvents: [],
      alerts: [{
        type: 'info', icon: '📦',
        message: 'No inventory data yet. Record an opening count to establish a baseline, then scans will build on it.',
        time: null,
      }],
      coverage: {
        products_total: 0, missing_pour_price: 0, missing_cost_per_bottle: 0,
        missing_bottle_volume: 0, revenue_available: false,
        shifts_configured: shifts.length, unattributed_deltas: 0,
      },
      unexplained: [],
      empty: true,
    };
  }
}
