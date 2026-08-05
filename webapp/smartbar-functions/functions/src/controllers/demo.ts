import { db } from '../firebase';
import * as admin from 'firebase-admin';

const DEMO_BUSINESS = 'demo-bar';
const INVENTORY = 'demo_inventory';
const EVENTS = 'demo_events';
const META = 'demo_meta';
// Demo status is a property of the device *record* (`devices.demo === true`),
// set explicitly at provisioning via PATCH /api/platform/devices/:id/demo.
//
// It used to be inferred from this hardcoded serial allow-list, which meant
// device login force-reassigned those two units to the demo business on every
// login — silently reverting a real business assignment if either physical
// unit was ever deployed to a pilot bar.

const money = (n: number) => Math.round(n * 100) / 100;
const daysAgo = (days: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

const volumeFromProduct = (product: any) => {
  const quantity = String(product?.quantity || '750 ml');
  const match = quantity.match(/[0-9]+(?:\.[0-9]+)?/);
  const amount = Number(match?.[0] || 0);
  // Some imported liquor records use quantity="1" and weight="750".
  // Quantity is a bottle count in that case, not a liquid volume.
  if (/\bL(?:iters?)?\b/i.test(quantity)) return amount * 1000;
  if (/\bml\b/i.test(quantity) && amount > 10) return amount;
  const weight = Number(String(product?.weight || '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 0);
  if (amount > 10) return amount;
  if (weight > 10) return weight;
  return 750;
};

async function deleteCollection(name: string) {
  const snapshot = await db.collection(name).get();
  for (let i = 0; i < snapshot.docs.length; i += 450) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + 450).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

export default class DemoCtrl {
  /**
   * Make a catalog bottle available to the Demo Bar on first use. Demo data
   * is seeded as a snapshot, so products added later must be copied into the
   * demo inventory when a real device scans them.
   */
  ensureDemoInventory = async (barcode: string, productId?: string) => {
    const existing = await db.collection(INVENTORY).where('barcode', '==', barcode).limit(20).get();
    const existingDoc = existing.docs.find(doc => doc.data().business === DEMO_BUSINESS);
    if (existingDoc) {
      const current: any = existingDoc.data();
      const productDoc = current.product_id ? await db.collection('bottles').doc(current.product_id).get() : null;
      if (productDoc?.exists) {
        const master: any = productDoc.data();
        const volume = volumeFromProduct(master);
        const pourPrice = Number.isFinite(Number(master.pour_price)) ? Number(master.pour_price) : null;
        const pourVolume = Number.isFinite(Number(master.pour_volume_ml)) ? Number(master.pour_volume_ml) : 30;
        if (Number(current.volume_ml || 0) <= 10 || current.pour_price !== pourPrice || current.pour_volume_ml !== pourVolume) {
          const emptyWeight = Number(master.bottle_empty_weight_g || current.bottle_empty_weight_g || 200);
          const fullWeight = Number(master.bottle_full_weight_g || emptyWeight + volume);
          const repaired = Number(current.volume_ml || 0) <= 10;
          const update: any = { volume_ml: volume, pour_price: pourPrice, pour_volume_ml: pourVolume };
          if (repaired) Object.assign(update, {
            on_hand_ml: volume, open_volume_ml: volume, sealed_count: 0,
            scale_weight_g: fullWeight, bottle_empty_weight_g: emptyWeight,
            bottle_full_weight_g: fullWeight, consumed_ml: 0, waste_ml: 0,
            consumed_value: 0, waste_value: 0,
            revenue_value: 0,
            on_hand_value: Number(current.cost_per_bottle || master.cost_per_bottle || 25),
          });
          await existingDoc.ref.update(update);
          return { ref: existingDoc.ref, data: { ...current, ...update }, created: false };
        }
      }
      return { ref: existingDoc.ref, data: current, created: false };
    }

    let bottle: any = null;
    if (productId) {
      const productDoc = await db.collection('bottles').doc(productId).get();
      if (productDoc.exists) bottle = { _id: productDoc.id, ...productDoc.data() };
    }
    if (!bottle) {
      const productSnapshot = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
      if (!productSnapshot.empty) bottle = { _id: productSnapshot.docs[0].id, ...productSnapshot.docs[0].data() };
    }
    if (!bottle) return null;

    const volume = volumeFromProduct(bottle);
    const emptyWeight = Number(bottle.bottle_empty_weight_g || 200);
    const fullWeight = Number(bottle.bottle_full_weight_g || emptyWeight + volume);
    const ref = db.collection(INVENTORY).doc(bottle._id || barcode);
    const data = {
      business: DEMO_BUSINESS, product_id: bottle._id, barcode,
      name: bottle.name || 'Demo Product', brand: bottle.brand || '',
      category: bottle.category || 'Uncategorized', volume_ml: volume,
      cost_per_bottle: Number(bottle.cost_per_bottle || 25),
      pour_price: Number.isFinite(Number(bottle.pour_price)) ? Number(bottle.pour_price) : null,
      pour_volume_ml: Number.isFinite(Number(bottle.pour_volume_ml)) ? Number(bottle.pour_volume_ml) : 30,
      on_hand_ml: volume, open_volume_ml: volume, sealed_count: 0,
      bottle_empty_weight_g: emptyWeight, bottle_full_weight_g: fullWeight,
      scale_weight_g: fullWeight, consumed_ml: 0, waste_ml: 0,
      consumed_value: 0, waste_value: 0,
      revenue_value: 0,
      on_hand_value: Number(bottle.cost_per_bottle || 25),
      pour_cost_pct: 0, scans_today: 0, last_scan: 'just now',
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data, { merge: true });
    return { ref, data, created: true };
  };

  recordDeviceScan = async (barcode: string, weightG: number, productId?: string) => {
    const ensured = await this.ensureDemoInventory(barcode, productId);
    if (!ensured) return { recorded: false, reason: 'Product is not in the catalog.' };
    const ref = ensured.ref;
    const product: any = ensured.data;
    const emptyWeight = Number(product.bottle_empty_weight_g || 200);
    const previousWeight = Number(product.scale_weight_g || emptyWeight + Math.min(Number(product.on_hand_ml || 0), Number(product.volume_ml || 750)));
    const nextWeight = Math.max(emptyWeight, Number(weightG) || emptyWeight);
    const volume = Number(product.volume_ml || 750);
    const cost = Number(product.cost_per_bottle || 25);
    // The first scan establishes the bottle's current inventory state. It is
    // not treated as consumption from a full bottle.
    const firstScan = Boolean(ensured.created);
    const consumed = firstScan ? 0 : Math.max(0, Math.round(previousWeight - nextWeight));
    const measuredOnHand = Math.min(volume, Math.max(0, Math.round(nextWeight - emptyWeight)));
    const onHand = firstScan ? measuredOnHand : Math.max(0, Number(product.on_hand_ml || 0) - consumed);
    const update = {
      scale_weight_g: nextWeight, on_hand_ml: onHand,
      consumed_ml: Number(product.consumed_ml || 0) + consumed,
      on_hand_value: money(onHand / volume * cost),
      consumed_value: money((Number(product.consumed_ml || 0) + consumed) / volume * cost),
      revenue_value: money((Number(product.revenue_value || 0) + (
        Number(product.pour_price) > 0 && Number(product.pour_volume_ml) > 0
          ? consumed / Number(product.pour_volume_ml) * Number(product.pour_price) : 0
      ))),
      scans_today: Number(product.scans_today || 0) + 1,
      last_scan: 'just now', updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.update(update);
    await db.collection(EVENTS).add({
      business: DEMO_BUSINESS, product_id: productId || product.product_id, barcode,
      event_type: firstScan ? 'inventory_added' : 'consumption', consumed_ml: consumed, waste_ml: 0,
      weight_g: nextWeight, previous_weight_g: previousWeight, source: 'demo_device_scan',
      timestamp: admin.firestore.Timestamp.now(),
    });
    return { recorded: true, product: product.name, consumed_ml: consumed, waste_ml: 0, weight_g: nextWeight };
  };

  recordUnknownDeviceScan = async (barcode: string, weightG: number) => {
    await db.collection(EVENTS).add({
      business: DEMO_BUSINESS, barcode, event_type: 'unmatched_scan', consumed_ml: 0,
      waste_ml: 0, weight_g: Number(weightG) || 0, source: 'demo_device_scan',
      timestamp: admin.firestore.Timestamp.now(),
    });
    return { recorded: true, matched: false, barcode, weight_g: Number(weightG) || 0 };
  };

  // When a user identifies an unmatched scan in the mobile app, promote that
  // original reading into Demo Bar inventory without requiring another scan.
  claimUnknownScan = async (barcode: string, productId: string) => {
    const snapshot = await db.collection(EVENTS).where('barcode', '==', barcode).limit(50).get();
    const unmatched = snapshot.docs.filter(doc => {
      const data: any = doc.data();
      return data.business === DEMO_BUSINESS && data.event_type === 'unmatched_scan' && !data.resolved;
    });
    if (!unmatched.length) return null;
    const event = unmatched[unmatched.length - 1];
    const data: any = event.data();
    const result = await this.recordDeviceScan(barcode, Number(data.weight_g) || 0, productId);
    await event.ref.update({ resolved: true, resolved_at: admin.firestore.FieldValue.serverTimestamp(), product_id: productId });
    return result;
  };

  seed = async (_req, res) => {
    try {
      await deleteCollection(INVENTORY);
      await deleteCollection(EVENTS);

      const bottles = (await db.collection('bottles').limit(12).get()).docs;
      if (!bottles.length) return res.status(400).json({ error: 'Import products before seeding the demo.' });

      const batch = db.batch();
      bottles.forEach((doc, index) => {
        const p: any = doc.data();
        const volume = volumeFromProduct(p);
        const cost = Number(p.cost_per_bottle || 25);
        const consumed = 350 + (index * 83) % 650;
        const waste = 15 + (index * 17) % 90;
        const onHand = volume * (2 + (index % 4)) - consumed;
        const emptyWeight = Number(p.bottle_empty_weight_g || 200);
        const sealedCount = Math.floor(Math.max(onHand, 0) / volume);
        const openVolume = Math.max(0, Math.max(onHand, 0) - sealedCount * volume);
        const category = String(p.category || 'Uncategorized');
        batch.set(db.collection(INVENTORY).doc(doc.id), {
          business: DEMO_BUSINESS, product_id: doc.id, barcode: p.barcode || doc.id,
          name: p.name || 'Demo Product', brand: p.brand || 'House Brand', category,
          volume_ml: volume, cost_per_bottle: cost, on_hand_ml: Math.max(onHand, 0),
          bottle_empty_weight_g: emptyWeight,
          bottle_full_weight_g: Number(p.bottle_full_weight_g || emptyWeight + volume),
          pour_price: Number.isFinite(Number(p.pour_price)) ? Number(p.pour_price) : null,
          pour_volume_ml: Number.isFinite(Number(p.pour_volume_ml)) ? Number(p.pour_volume_ml) : 30,
          sealed_count: sealedCount, open_volume_ml: openVolume,
          scale_weight_g: emptyWeight + openVolume,
          consumed_ml: consumed, waste_ml: waste,
          consumed_value: money(consumed / volume * cost), waste_value: money(waste / volume * cost),
          revenue_value: money(Number(p.pour_price) > 0 && Number(p.pour_volume_ml) > 0 ? consumed / Number(p.pour_volume_ml) * Number(p.pour_price) : 0),
          on_hand_value: money(Math.max(onHand, 0) / volume * cost),
          pour_cost_pct: money(17 + (index * 2.7) % 14), scans_today: 2 + (index % 6),
          last_scan: `${index + 1}h ago`, updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      const eventBatch = db.batch();
      for (let day = 27; day >= 0; day--) {
        bottles.forEach((doc, index) => {
          const p: any = doc.data();
          const consumed = 35 + ((day + index * 13) % 70);
          eventBatch.set(db.collection(EVENTS).doc(), {
            business: DEMO_BUSINESS, product_id: doc.id, barcode: p.barcode || doc.id,
            event_type: 'consumption', consumed_ml: consumed,
            waste_ml: day % 9 === index % 9 ? 20 + index * 3 : 0,
            shift: day % 3 === 0 ? 'Late Night' : day % 2 === 0 ? 'Evening' : 'Day Shift',
            timestamp: admin.firestore.Timestamp.fromDate(new Date(daysAgo(day))),
          });
        });
      }
      await eventBatch.commit();
      await db.collection(META).doc(DEMO_BUSINESS).set({
        business: DEMO_BUSINESS, name: 'Demo Bar', seeded_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.status(201).json({ business: DEMO_BUSINESS, products: bottles.length, days: 28 });
    } catch (err) {
      console.error('Demo seed failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  reset = async (_req, res) => {
    try {
      await deleteCollection(INVENTORY);
      await deleteCollection(EVENTS);
      await db.collection(META).doc(DEMO_BUSINESS).delete();
      res.sendStatus(204);
    } catch (err) {
      console.error('Demo reset failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  simulate = async (req, res) => {
    try {
      const scenario = req.body?.scenario || 'busy_friday';
      const snapshot = await db.collection(INVENTORY).limit(12).get();
      if (snapshot.empty) return res.status(400).json({ error: 'Seed the demo before running a scenario.' });
      const requestedProduct = req.body?.product_id;
      const target = requestedProduct
        ? snapshot.docs.find(doc => doc.id === requestedProduct) || snapshot.docs[0]
        : snapshot.docs[scenario === 'anomaly' ? 1 : 0];
      const p: any = target.data();
      const defaultConsumed = scenario === 'delivery' ? 0 : scenario === 'anomaly' ? 60 : 260;
      const defaultWaste = scenario === 'anomaly' ? 180 : scenario === 'busy_friday' ? 45 : 0;
      const scaleWeightInput = Number(req.body?.scale_weight_g);
      const expectedInput = Number(req.body?.expected_consumed_ml);
      const sealedInput = Number(req.body?.sealed_count);
      const addedInput = Number(req.body?.added_bottles ?? req.body?.delivery_bottles);
      const volume = Number(p.volume_ml || 750);
      const emptyWeight = Number(p.bottle_empty_weight_g || 200);
      const previousSealedCount = Number(p.sealed_count ?? Math.floor(Number(p.on_hand_ml || 0) / volume));
      const previousOpenVolume = Number(p.open_volume_ml ?? Math.max(0, Number(p.on_hand_ml || 0) - previousSealedCount * volume));
      const previousScaleWeight = Number(p.scale_weight_g || emptyWeight + previousOpenVolume);
      const newSealedCount = Number.isFinite(sealedInput) && sealedInput >= 0 ? Math.floor(sealedInput) : previousSealedCount;
      const newScaleWeight = Number.isFinite(scaleWeightInput) && scaleWeightInput >= emptyWeight ? scaleWeightInput : Math.max(emptyWeight, previousScaleWeight - defaultConsumed - defaultWaste);
      const newOpenVolume = Math.min(volume, Math.max(0, Math.round(newScaleWeight - emptyWeight)));
      const addedBottles = Number.isFinite(addedInput) && addedInput >= 0 ? Math.floor(addedInput) : (scenario === 'delivery' ? 6 : 0);
      const previousTotal = previousOpenVolume + previousSealedCount * volume;
      const currentTotal = newOpenVolume + newSealedCount * volume;
      const measuredLoss = Math.round(previousTotal + addedBottles * volume - currentTotal);
      const consumed = Math.max(0, measuredLoss);
      const expectedConsumed = Number.isFinite(expectedInput) && expectedInput >= 0 ? expectedInput : (scenario === 'delivery' ? 0 : defaultConsumed);
      // Weight is treated as grams of liquid (approximately 1g/ml for the demo).
      // Waste is the measured volume loss above the expected pour volume.
      const waste = Math.max(0, Math.round(consumed - expectedConsumed));
      const delivery = addedBottles * volume;
      const nextOnHand = Math.max(0, currentTotal);
      await target.ref.update({
        on_hand_ml: nextOnHand, consumed_ml: Number(p.consumed_ml || 0) + consumed,
        sealed_count: newSealedCount, open_volume_ml: newOpenVolume, scale_weight_g: newScaleWeight,
        waste_ml: Number(p.waste_ml || 0) + waste,
        on_hand_value: money(nextOnHand / Number(p.volume_ml || 750) * Number(p.cost_per_bottle || 25)),
        consumed_value: money((Number(p.consumed_ml || 0) + consumed) / Number(p.volume_ml || 750) * Number(p.cost_per_bottle || 25)),
        waste_value: money((Number(p.waste_ml || 0) + waste) / Number(p.volume_ml || 750) * Number(p.cost_per_bottle || 25)),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection(EVENTS).add({
        business: DEMO_BUSINESS, product_id: target.id, barcode: p.barcode,
        event_type: delivery ? 'delivery' : waste ? 'breakage' : 'consumption',
        consumed_ml: consumed, waste_ml: waste, delivery_bottles: addedBottles,
        shift: 'Evening', timestamp: admin.firestore.Timestamp.now(), scenario,
      });
      res.status(201).json({ scenario, product: p.name, consumed_ml: consumed, waste_ml: waste, delivery_bottles: addedBottles, previous_scale_weight_g: previousScaleWeight, scale_weight_g: newScaleWeight, previous_sealed_count: previousSealedCount, sealed_count: newSealedCount, previous_total_ml: previousTotal, current_total_ml: currentTotal, measured_loss_ml: measuredLoss, expected_consumed_ml: expectedConsumed });
    } catch (err) {
      console.error('Demo simulation failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  dashboard = async (_req, res) => {
    try {
      const [inventorySnapshot, eventsSnapshot, categoriesSnapshot] = await Promise.all([
        db.collection(INVENTORY).where('business', '==', DEMO_BUSINESS).get(),
        db.collection(EVENTS).where('business', '==', DEMO_BUSINESS).get(),
        db.collection('categories').get(),
      ]);
      const categoryNames = new Map<string, string>();
      categoriesSnapshot.docs.forEach(doc => {
        const data: any = doc.data();
        categoryNames.set(doc.id, data.name || data.path || doc.id);
      });
      const inventory = inventorySnapshot.docs.map(d => {
        const data: any = d.data();
        const categoryId = String(data.category || '');
        return {
          _id: d.id,
          ...data,
          // Keep the ID for internal use, but expose the human-readable label
          // consumed by the dashboard table and category breakdown.
          category_id: categoryId,
          category: categoryNames.get(categoryId) || (categoryId || 'Uncategorized'),
        };
      });
      const events = eventsSnapshot.docs.map(d => d.data() as any);
      if (!inventory.length) return res.status(404).json({ error: 'Demo is not seeded.' });
      const pricing = new Map(inventory.map((p: any) => [String(p.product_id || p._id), p]));

      const dailyConsumption = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() - (6 - i));
        const date = day.toISOString().slice(0, 10);
        const dayEvents = events.filter(e => String(e.timestamp?.toDate ? e.timestamp.toDate().toISOString() : e.timestamp).slice(0, 10) === date);
        const consumed = dayEvents.reduce((sum, e) => sum + Number(e.consumed_ml || 0), 0);
        const waste = dayEvents.reduce((sum, e) => sum + Number(e.waste_ml || 0), 0);
        const revenue = dayEvents.reduce((sum, e) => {
          const product: any = pricing.get(String(e.product_id || ''));
          const pourPrice = Number(product?.pour_price);
          const pourVolume = Number(product?.pour_volume_ml);
          return sum + (pourPrice > 0 && pourVolume > 0
            ? Number(e.consumed_ml || 0) / pourVolume * pourPrice
            : Number(e.consumed_ml || 0) * 0.42);
        }, 0);
        return { day: day.toLocaleDateString('en-US', { weekday: 'short' }), consumed_ml: consumed, waste_ml: waste, revenue: money(revenue) };
      });
      const totalOnHand = inventory.reduce((s, p) => s + Number(p.on_hand_value || 0), 0);
      const totalConsumed = inventory.reduce((s, p) => s + Number(p.consumed_value || 0), 0);
      const totalWaste = inventory.reduce((s, p) => s + Number(p.waste_value || 0), 0);
      const totalRevenue = dailyConsumption.reduce((s, d) => s + d.revenue, 0);
      const categoryMap: any = {};
      inventory.forEach(p => { const key = String(p.category || 'Uncategorized'); categoryMap[key] = (categoryMap[key] || 0) + Number(p.consumed_value || 0); });
      const categoryTotal: number = Number(Object.values(categoryMap).reduce((s: number, v: any) => s + Number(v), 0)) || 1;
      const colors = ['#007bff', '#f0ad4e', '#28a745', '#dc3545', '#17a2b8', '#6f42c1', '#e83e8c'];
      const categoryBreakdown = Object.entries(categoryMap).sort((a: any, b: any) => b[1] - a[1]).map(([category, value]: any, i) => ({ category, value: Math.round(value), pct: Math.round(value / categoryTotal * 100), color: colors[i % colors.length] }));
      const avgPourCost = inventory.reduce((s, p) => s + Number(p.pour_cost_pct || 0), 0) / inventory.length;
      const alerts = inventory.filter(p => Number(p.pour_cost_pct) > 25 || Number(p.waste_ml) > 100).slice(0, 5).map(p => ({ type: Number(p.waste_ml) > 100 ? 'warning' : 'danger', icon: Number(p.waste_ml) > 100 ? '⚠' : '🔴', message: `${p.name} shows ${p.waste_ml}ml waste and ${p.pour_cost_pct}% pour cost`, time: p.last_scan }));
      while (alerts.length < 3) alerts.push({ type: 'info', icon: '📦', message: 'Inventory data is ready for the next simulated shift.', time: 'now' });
      res.json({ business: { id: DEMO_BUSINESS, name: 'Demo Bar' }, summary: { totalOnHand, totalConsumed, totalWaste, totalRevenue, avgPourCost }, products: inventory.sort((a, b) => b.consumed_value - a.consumed_value), dailyConsumption, categoryBreakdown, alerts, weeklyTrend: [1, 2, 3, 4].map((week, i) => ({ week: `Week ${week}`, inventory_value: Math.round(totalOnHand * (0.82 + i * 0.06)), consumed_value: Math.round(totalConsumed * (0.72 + i * 0.09)), waste_value: Math.round(totalWaste * (0.7 + i * 0.1)) })), shifts: [{ name: 'Day Shift (8am–4pm)', bartender: 'Sarah M.', pour_cost: 18.2, variance: -0.8, scans: 34, color: '#28a745' }, { name: 'Evening (4pm–12am)', bartender: 'Mike T.', pour_cost: 22.7, variance: 2.1, scans: 67, color: '#f0ad4e' }, { name: 'Late Night (12am–close)', bartender: 'Alex R.', pour_cost: 28.4, variance: 8.4, scans: 23, color: '#dc3545' }] });
    } catch (err) {
      console.error('Demo dashboard failed:', err);
      res.status(500).json({ error: err.message });
    }
  };
}
