import { db } from '../firebase';
import * as admin from 'firebase-admin';

const SESSIONS = 'inventory_sessions';
const READINGS = 'inventory_readings';
const EVENTS = 'inventory_events';
const REPORTS = 'consumption_reports';

export default class InventoryCtrl {

  // ─── Sessions (optional named tracking periods) ─────────────────────

  startSession = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const { label, notes } = req.body;

      const session = {
        business,
        label: label || `Inventory ${new Date().toISOString().split('T')[0]}`,
        status: 'active',
        started_at: admin.firestore.FieldValue.serverTimestamp(),
        paused_at: null,
        closed_at: null,
        closed_reason: null,
        notes: notes || '',
        reading_count: 0,
      };

      const ref = await db.collection(SESSIONS).add(session);
      const doc = await ref.get();
      res.status(201).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  updateSession = async (req, res) => {
    try {
      const sessionId = req.params.id;
      const doc = await db.collection(SESSIONS).doc(sessionId).get();
      if (!doc.exists) return res.status(404).json({ error: 'Session not found' });

      const { status, label, notes, closed_reason } = req.body;
      const updates: any = {};

      if (label !== undefined) updates.label = label;
      if (notes !== undefined) updates.notes = notes;

      if (status === 'paused') {
        updates.status = 'paused';
        updates.paused_at = admin.firestore.FieldValue.serverTimestamp();
      } else if (status === 'active') {
        updates.status = 'active';
        updates.paused_at = null;
      } else if (status === 'closed') {
        updates.status = 'closed';
        updates.closed_at = admin.firestore.FieldValue.serverTimestamp();
        updates.closed_reason = closed_reason || 'manual';

        const readingsCount = await db.collection(READINGS)
          .where('session_id', '==', sessionId).get();
        updates.reading_count = readingsCount.size;
      }

      await db.collection(SESSIONS).doc(sessionId).update(updates);
      const updated = await db.collection(SESSIONS).doc(sessionId).get();
      res.status(200).json({ _id: updated.id, ...updated.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  getSessions = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      let query: admin.firestore.Query = db.collection(SESSIONS)
        .where('business', '==', business)
        .orderBy('started_at', 'desc');

      if (req.query.status) {
        query = db.collection(SESSIONS)
          .where('business', '==', business)
          .where('status', '==', req.query.status)
          .orderBy('started_at', 'desc');
      }

      if (req.query.limit) {
        query = query.limit(parseInt(req.query.limit));
      }

      const snapshot = await query.get();
      const docs = snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  getSession = async (req, res) => {
    try {
      const doc = await db.collection(SESSIONS).doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
      res.status(200).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  deleteSession = async (req, res) => {
    try {
      const sessionId = req.params.id;
      const doc = await db.collection(SESSIONS).doc(sessionId).get();
      if (!doc.exists) return res.status(404).json({ error: 'Session not found' });

      // Unlink readings from this session (don't delete them — they're still valid data)
      const readings = await db.collection(READINGS)
        .where('session_id', '==', sessionId).get();
      const batch = db.batch();
      readings.docs.forEach(r => batch.update(r.ref, { session_id: null }));
      batch.delete(db.collection(SESSIONS).doc(sessionId));
      await batch.commit();

      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  // ─── Readings (continuous data stream) ──────────────────────────────

  /**
   * Called internally by bottleStat.insert on every device scan.
   * Also callable directly via API for manual entry.
   */
  createReading = async (business: string, barcode: string, weightG: number, opts: {
    product_id?: string; product_name?: string; product_brand?: string;
    sealed_count?: number; device_id?: string; user_id?: string;
    bottle_full_weight_g?: number; bottle_empty_weight_g?: number;
    bottle_volume_ml?: number; cost_per_bottle?: number; notes?: string;
  } = {}) => {
    let prodId = opts.product_id || null;
    let prodName = opts.product_name || '';
    let prodBrand = opts.product_brand || '';
    let fullWeight = opts.bottle_full_weight_g || 0;
    let emptyWeight = opts.bottle_empty_weight_g || 0;
    let volumeMl = opts.bottle_volume_ml || 0;
    let costPerBottle = opts.cost_per_bottle || 0;

    if (!prodId) {
      const bottleSnap = await db.collection('bottles')
        .where('barcode', '==', barcode).limit(1).get();
      if (!bottleSnap.empty) {
        const b = bottleSnap.docs[0];
        const bData = b.data();
        prodId = b.id;
        prodName = prodName || bData.name || '';
        prodBrand = prodBrand || bData.brand || '';
        fullWeight = fullWeight || bData.bottle_full_weight_g || 0;
        emptyWeight = emptyWeight || bData.bottle_empty_weight_g || 0;
        volumeMl = volumeMl || bData.bottle_volume_ml || 0;
        costPerBottle = costPerBottle || bData.cost_per_bottle || 0;
      }
    }

    const sealed = opts.sealed_count || 0;
    const { estimatedVolumeMl, totalVolumeOnHandMl, totalValueOnHand } =
      this.calcVolumes(weightG, fullWeight, emptyWeight, volumeMl, sealed, costPerBottle);

    // Find previous reading for diff
    const prevSnap = await db.collection(READINGS)
      .where('business', '==', business)
      .where('barcode', '==', barcode)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    let prevVol: number | null = null;
    let prevSealed: number | null = null;
    let volumeChangeMl = 0;
    let sealedChange = 0;
    if (!prevSnap.empty) {
      const prev = prevSnap.docs[0].data();
      prevVol = prev.total_volume_on_hand_ml ?? null;
      prevSealed = prev.sealed_count ?? null;
      if (prevVol !== null) volumeChangeMl = prevVol - totalVolumeOnHandMl;
      if (prevSealed !== null) sealedChange = prevSealed - sealed;
    }

    // Check for active session to tag
    let sessionId: string | null = null;
    const activeSessions = await db.collection(SESSIONS)
      .where('business', '==', business)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (!activeSessions.empty) {
      sessionId = activeSessions.docs[0].id;
    }

    const reading = {
      business,
      session_id: sessionId,
      product_id: prodId,
      barcode,
      product_name: prodName,
      product_brand: prodBrand,
      weight_g: weightG,
      sealed_count: sealed,
      bottle_full_weight_g: fullWeight,
      bottle_empty_weight_g: emptyWeight,
      bottle_volume_ml: volumeMl,
      cost_per_bottle: costPerBottle,
      estimated_volume_ml: estimatedVolumeMl,
      total_volume_on_hand_ml: totalVolumeOnHandMl,
      total_value_on_hand: totalValueOnHand,
      prev_volume_on_hand_ml: prevVol,
      prev_sealed_count: prevSealed,
      volume_change_ml: volumeChangeMl,
      sealed_change: sealedChange,
      device_id: opts.device_id || null,
      notes: opts.notes || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      recorded_by: opts.user_id || opts.device_id || null,
    };

    const ref = await db.collection(READINGS).add(reading);

    if (sessionId) {
      await db.collection(SESSIONS).doc(sessionId).update({
        reading_count: admin.firestore.FieldValue.increment(1),
      });
    }

    const newDoc = await ref.get();
    return { _id: newDoc.id, ...newDoc.data() };
  };

  addReadingAPI = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const { barcode, weight_g, open_bottle_weight_g, sealed_count,
        bottle_full_weight_g, bottle_empty_weight_g, bottle_volume_ml,
        cost_per_bottle, notes } = req.body;

      if (!barcode) return res.status(400).json({ error: 'barcode is required' });

      const w = parseFloat(weight_g || open_bottle_weight_g) || 0;
      const result = await this.createReading(business, barcode, w, {
        sealed_count: parseInt(sealed_count) || 0,
        bottle_full_weight_g: parseFloat(bottle_full_weight_g) || 0,
        bottle_empty_weight_g: parseFloat(bottle_empty_weight_g) || 0,
        bottle_volume_ml: parseFloat(bottle_volume_ml) || 0,
        cost_per_bottle: parseFloat(cost_per_bottle) || 0,
        user_id: req.user?._id || null,
        device_id: req.device?._id || null,
        notes,
      });

      res.status(201).json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * Record an opening count: the baseline stock level for a set of products.
   *
   * A dashboard built purely on scan deltas has nothing to show until a bottle
   * has been weighed twice. An opening count writes one reading per product so
   * there is a real starting position, and subsequent device scans difference
   * against it naturally — no separate "seed" data model, and nothing to
   * reconcile later.
   *
   * Body: { items: [{ barcode, sealed_count, open_weight_g?, open_volume_ml? }], notes? }
   *
   * `open_weight_g` is preferred (it is what a scale reports). `open_volume_ml`
   * is accepted for counts done by eye, e.g. "about half a bottle", and is
   * converted to a weight using the product's own full/empty weights.
   */
  recordOpeningCount = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const items = Array.isArray(req.body?.items) ? req.body.items : null;
      if (!items || !items.length) return res.status(400).json({ error: 'items[] is required' });
      if (items.length > 200) return res.status(400).json({ error: 'Limit opening counts to 200 items per request.' });

      const results: any[] = [];
      const errors: any[] = [];

      for (const item of items) {
        const barcode = String(item?.barcode || '').trim();
        if (!barcode) { errors.push({ barcode: null, error: 'barcode is required' }); continue; }

        const snap = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
        if (snap.empty) { errors.push({ barcode, error: 'Product not in catalog' }); continue; }

        const bottle: any = snap.docs[0].data();
        const emptyW = Number(bottle.bottle_empty_weight_g || 0);
        const fullW = Number(bottle.bottle_full_weight_g || 0);
        const volMl = Number(bottle.bottle_volume_ml || 0);

        // Without these three, the reading is recorded but every derived figure
        // is zero. Surface that rather than writing a silently useless row.
        if (!emptyW || !fullW || !volMl) {
          errors.push({
            barcode, error: 'Product is missing bottle_full_weight_g, bottle_empty_weight_g or bottle_volume_ml. Set these before counting.',
          });
          continue;
        }

        let weightG = Number(item?.open_weight_g);
        if (!Number.isFinite(weightG) || weightG <= 0) {
          const openMl = Number(item?.open_volume_ml);
          weightG = Number.isFinite(openMl) && openMl > 0
            ? emptyW + (openMl / volMl) * (fullW - emptyW)
            : 0;  // no open bottle on the scale; sealed stock only
        }

        try {
          const reading = await this.createReading(business, barcode, weightG, {
            sealed_count: parseInt(item?.sealed_count) || 0,
            user_id: req.user?._id || null,
            notes: req.body?.notes || 'Opening count',
          });
          results.push(reading);
        } catch (e) {
          errors.push({ barcode, error: e.message });
        }
      }

      res.status(results.length ? 201 : 400).json({
        recorded: results.length,
        failed: errors.length,
        readings: results,
        errors,
      });
    } catch (err) {
      console.error('Opening count failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * Add stock for a product: logs a delivery event and writes a new reading
   * reflecting the higher sealed count, so on-hand updates immediately rather
   * than waiting for the next scan.
   *
   * Body: { barcode, bottles, notes?, date? }
   */
  addStock = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const barcode = String(req.body?.barcode || '').trim();
      const bottlesAdded = parseInt(req.body?.bottles);
      if (!barcode) return res.status(400).json({ error: 'barcode is required' });
      if (!Number.isInteger(bottlesAdded) || bottlesAdded <= 0) {
        return res.status(400).json({ error: 'bottles must be a positive integer' });
      }

      const snap = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
      if (snap.empty) return res.status(404).json({ error: 'Product not in catalog' });
      const productId = snap.docs[0].id;

      // Current position, so the new sealed count is additive rather than
      // overwriting whatever the last scan saw.
      const prevSnap = await db.collection(READINGS)
        .where('business', '==', business)
        .where('barcode', '==', barcode)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      const prev: any = prevSnap.empty ? null : prevSnap.docs[0].data();
      const prevSealed = Number(prev?.sealed_count || 0);
      const prevWeight = Number(prev?.weight_g || 0);

      const event = {
        business, product_id: productId, barcode,
        event_type: 'delivery',
        quantity: bottlesAdded,
        weight_g: null,
        notes: req.body?.notes || '',
        date: req.body?.date || new Date().toISOString().split('T')[0],
        logged_by: req.user?._id || null,
        logged_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      const eventRef = await db.collection(EVENTS).add(event);

      const reading = await this.createReading(business, barcode, prevWeight, {
        product_id: productId,
        sealed_count: prevSealed + bottlesAdded,
        user_id: req.user?._id || null,
        notes: `Stock added: +${bottlesAdded} bottle(s)`,
      });

      res.status(201).json({
        event: { _id: eventRef.id, ...event },
        reading,
        sealed_count: prevSealed + bottlesAdded,
      });
    } catch (err) {
      console.error('Add stock failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * Seed a starting inventory for the caller's *own* business from catalog
   * products that have complete specs.
   *
   * Unlike the Demo Bar, this writes ordinary `inventory_readings` rows against
   * the real business, so a device scan the next minute differences against it
   * like any other reading. There is no separate demo data model to reconcile
   * later — the seeded position simply becomes the opening count, and can be
   * corrected by re-counting.
   *
   * Body: { limit?: number, sealed_per_product?: number }
   */
  seedSampleInventory = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const limit = Math.min(Math.max(parseInt(req.body?.limit) || 12, 1), 50);
      const sealedPer = Math.min(Math.max(parseInt(req.body?.sealed_per_product) || 2, 0), 20);

      const existing = await db.collection(READINGS)
        .where('business', '==', business).limit(1).get();
      if (!existing.empty && !req.body?.force) {
        return res.status(409).json({
          error: 'This business already has inventory readings. Pass force:true to seed anyway, or record an opening count instead.',
        });
      }

      // Only products with the full spec set produce meaningful numbers.
      //
      // Query on bottle_volume_ml rather than scanning the first N documents:
      // on a catalog of a few thousand products, an arbitrary first slice can
      // easily contain zero spec'd items even when most of the catalog is fine.
      // Firestore auto-indexes single fields, so this range filter needs no
      // composite index. The remaining two specs are checked in memory because
      // Firestore permits a range filter on only one field per query.
      const specced = await db.collection('bottles')
        .where('bottle_volume_ml', '>', 0)
        .limit(Math.max(limit * 5, 100))
        .get();

      const usable = specced.docs.filter(d => {
        const b: any = d.data();
        return Number(b.bottle_full_weight_g) > 0
          && Number(b.bottle_empty_weight_g) > 0;
      }).slice(0, limit);

      if (!usable.length) {
        const catalogSize = (await db.collection('bottles').limit(1).get()).size;
        return res.status(400).json({
          error: catalogSize === 0
            ? 'The product catalog is empty. Import products before seeding inventory.'
            : 'No catalog products have bottle weight and volume specs yet. Run the backfill to derive them for the whole catalog: cd webapp/smartbar-functions/functions && npm run backfill:specs -- --dry-run (then --commit). Or set the specs manually on one product from the Products page.',
          code: 'NO_SPECS',
        });
      }

      const readings: any[] = [];
      for (let i = 0; i < usable.length; i++) {
        const b: any = usable[i].data();
        const emptyW = Number(b.bottle_empty_weight_g);
        const fullW = Number(b.bottle_full_weight_g);
        // Vary the open bottle between roughly 1/4 and full so the opening
        // position looks like a real bar rather than a rack of full bottles.
        const fraction = 0.25 + ((i * 37) % 70) / 100;
        const weightG = Math.round(emptyW + fraction * (fullW - emptyW));
        readings.push(await this.createReading(business, b.barcode || usable[i].id, weightG, {
          product_id: usable[i].id,
          sealed_count: sealedPer,
          user_id: req.user?._id || null,
          notes: 'Seeded starting inventory',
        }));
      }

      res.status(201).json({ recorded: readings.length, readings });
    } catch (err) {
      console.error('Seed sample inventory failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * Compact inventory list for the mobile app.
   *
   * The full dashboard payload is far more than a phone needs and is expensive
   * to compute. This returns one row per product with the current position and
   * the fields a bartender or manager acts on, plus a `needs_specs` flag so the
   * app can offer to capture missing weights on the spot.
   *
   * Query: search, limit, only=low_stock|missing_specs
   */
  getMobileSummary = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 300);
      const search = String(req.query.search || '').trim().toLowerCase();
      const only = String(req.query.only || '').trim();

      // Latest reading per barcode. Readings are appended, so the most recent
      // row for a barcode is the current position.
      const snapshot = await db.collection(READINGS)
        .where('business', '==', business)
        .orderBy('timestamp', 'desc')
        .limit(2000)
        .get();

      const latest = new Map<string, any>();
      snapshot.docs.forEach(doc => {
        const data: any = doc.data();
        if (!latest.has(data.barcode)) latest.set(data.barcode, data);
      });

      const productIds = Array.from(latest.values())
        .map(r => r.product_id)
        .filter(Boolean);
      const bottleDocs = await Promise.all(
        Array.from(new Set(productIds)).map(id => db.collection('bottles').doc(id).get())
      );
      const bottles = new Map<string, any>();
      bottleDocs.forEach(d => { if (d.exists) bottles.set(d.id, d.data()); });

      let items = Array.from(latest.entries()).map(([barcode, reading]) => {
        const meta = reading.product_id ? bottles.get(reading.product_id) || {} : {};
        const volumeMl = Number(meta.bottle_volume_ml || 0);
        const costPerBottle = Number(meta.cost_per_bottle || 0);
        const pourPrice = Number(meta.pour_price) > 0 ? Number(meta.pour_price) : null;
        const pourVolume = Number(meta.pour_volume_ml) > 0 ? Number(meta.pour_volume_ml) : null;
        const parLevel = Number(meta.par_level) > 0 ? Number(meta.par_level) : null;

        const onHandMl = Number(reading.total_volume_on_hand_ml || 0);
        const bottlesOnHand = volumeMl > 0 ? onHandMl / volumeMl : null;

        // Pour cost is a property of pricing, not of the current stock level,
        // so it can be shown even for a product that has not moved.
        const pourCostPct = pourPrice && pourVolume && volumeMl > 0 && costPerBottle > 0
          ? Math.round(((costPerBottle / volumeMl) * pourVolume / pourPrice) * 100 * 10) / 10
          : null;

        const needsSpecs = !(Number(meta.bottle_full_weight_g) > 0
          && Number(meta.bottle_empty_weight_g) > 0
          && volumeMl > 0);

        return {
          product_id: reading.product_id || null,
          barcode,
          name: meta.name || reading.product_name || 'Unknown product',
          brand: meta.brand || reading.product_brand || '',
          image_url: meta.image_url || null,
          on_hand_ml: Math.round(onHandMl),
          on_hand_bottles: bottlesOnHand === null ? null : Math.round(bottlesOnHand * 10) / 10,
          on_hand_value: Math.round(Number(reading.total_value_on_hand || 0) * 100) / 100,
          sealed_count: Number(reading.sealed_count || 0),
          bottle_volume_ml: volumeMl || null,
          cost_per_bottle: costPerBottle || null,
          pour_price: pourPrice,
          pour_volume_ml: pourVolume,
          pour_cost_pct: pourCostPct,
          par_level: parLevel,
          below_par: parLevel !== null && bottlesOnHand !== null && bottlesOnHand < parLevel,
          needs_specs: needsSpecs,
          specs_estimated: meta.specs_estimated === true,
          last_reading_at: reading.timestamp?.toDate?.()?.toISOString() || null,
        };
      });

      if (search) {
        items = items.filter(i =>
          i.name.toLowerCase().includes(search)
          || i.brand.toLowerCase().includes(search)
          || i.barcode.includes(search));
      }
      if (only === 'low_stock') items = items.filter(i => i.below_par);
      if (only === 'missing_specs') items = items.filter(i => i.needs_specs || i.specs_estimated);

      items.sort((a, b) => {
        // Surface what needs attention first: below par, then unmeasured specs.
        if (a.below_par !== b.below_par) return a.below_par ? -1 : 1;
        if (a.needs_specs !== b.needs_specs) return a.needs_specs ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.status(200).json({
        items: items.slice(0, limit),
        total: items.length,
        counts: {
          below_par: items.filter(i => i.below_par).length,
          needs_specs: items.filter(i => i.needs_specs).length,
          estimated_specs: items.filter(i => i.specs_estimated).length,
        },
      });
    } catch (err) {
      console.error('Mobile summary failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  getReadings = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      let query: admin.firestore.Query = db.collection(READINGS)
        .where('business', '==', business)
        .orderBy('timestamp', 'desc');

      if (req.query.barcode) {
        query = db.collection(READINGS)
          .where('business', '==', business)
          .where('barcode', '==', req.query.barcode)
          .orderBy('timestamp', 'desc');
      }

      if (req.query.session_id) {
        query = db.collection(READINGS)
          .where('session_id', '==', req.query.session_id)
          .orderBy('timestamp', 'desc');
      }

      if (req.query.limit) {
        query = query.limit(parseInt(req.query.limit as string));
      }

      const snapshot = await query.get();
      const docs = snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  deleteReading = async (req, res) => {
    try {
      const readingId = req.params.id;
      const doc = await db.collection(READINGS).doc(readingId).get();
      if (!doc.exists) return res.status(404).json({ error: 'Reading not found' });
      await db.collection(READINGS).doc(readingId).delete();
      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  // ─── Inventory Events ──────────────────────────────────────────────

  addEvent = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const { barcode, product_id, event_type, quantity, weight_g, notes, date } = req.body;
      const validTypes = ['delivery', 'breakage', 'comp', 'transfer_in', 'transfer_out', 'spoilage', 'other'];
      if (!event_type || !validTypes.includes(event_type)) {
        return res.status(400).json({ error: `event_type must be one of: ${validTypes.join(', ')}` });
      }

      let prodId = product_id || null;
      if (barcode && !prodId) {
        const bottleSnap = await db.collection('bottles')
          .where('barcode', '==', barcode).limit(1).get();
        if (!bottleSnap.empty) prodId = bottleSnap.docs[0].id;
      }

      const event = {
        business, product_id: prodId, barcode: barcode || '',
        event_type, quantity: parseInt(quantity) || 0,
        weight_g: weight_g ? parseFloat(weight_g) : null,
        notes: notes || '', date: date || new Date().toISOString().split('T')[0],
        logged_by: req.user?._id || req.device?._id || null,
        logged_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = await db.collection(EVENTS).add(event);
      const doc = await ref.get();
      res.status(201).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  getEvents = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      let query: admin.firestore.Query = db.collection(EVENTS)
        .where('business', '==', business)
        .orderBy('logged_at', 'desc');

      if (req.query.limit) {
        query = query.limit(parseInt(req.query.limit as string));
      }

      const snapshot = await query.get();
      const docs = snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  deleteEvent = async (req, res) => {
    try {
      const doc = await db.collection(EVENTS).doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Event not found' });
      await db.collection(EVENTS).doc(req.params.id).delete();
      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  // ─── Consumption Report (time-range based) ─────────────────────────

  generateReport = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      const { start_date, end_date, session_id } = req.body;

      if (!start_date || !end_date) {
        return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
      }

      const startTs = new Date(start_date + 'T00:00:00Z');
      const endTs = new Date(end_date + 'T23:59:59Z');

      // For each barcode: the latest reading at or before `start` (the opening
      // position) and the latest at or before `end` (the closing position).
      //
      // A lower bound matters: without one this query scanned the business's
      // entire reading history on every report, which grows without limit and
      // costs a document read per row. Looking back one window before `start`
      // is enough to find an opening reading for anything scanned recently;
      // products with no reading in that lookback are reported as `new`.
      const rangeMs = Math.max(endTs.getTime() - startTs.getTime(), 7 * 86400000);
      const lookbackTs = new Date(startTs.getTime() - rangeMs);

      const allReadings = await db.collection(READINGS)
        .where('business', '==', business)
        .where('timestamp', '>=', lookbackTs)
        .where('timestamp', '<=', endTs)
        .orderBy('timestamp', 'desc')
        .get();

      // Group readings by barcode, find start/end snapshots
      const byBarcode = new Map<string, { start: any; end: any; all: any[] }>();

      for (const doc of allReadings.docs) {
        const data: any = { _id: doc.id, ...doc.data() };
        const bc = data.barcode;
        if (!byBarcode.has(bc)) byBarcode.set(bc, { start: null, end: null, all: [] });
        const entry = byBarcode.get(bc)!;

        const ts = data.timestamp?.toDate?.() || new Date(0);

        if (ts <= endTs && !entry.end) {
          entry.end = data;
        }
        if (ts <= startTs && !entry.start) {
          entry.start = data;
        }
        entry.all.push(data);
      }

      // Get events in the date range
      const eventsSnap = await db.collection(EVENTS)
        .where('business', '==', business)
        .where('date', '>=', start_date)
        .where('date', '<=', end_date)
        .get();

      const eventsMap = new Map<string, any[]>();
      eventsSnap.docs.forEach(d => {
        const data = d.data();
        const key = data.barcode || 'unknown';
        if (!eventsMap.has(key)) eventsMap.set(key, []);
        eventsMap.get(key)!.push(data);
      });

      const items: any[] = [];
      let totalStartValue = 0, totalEndValue = 0, totalConsumedValue = 0;
      let totalDeliveriesValue = 0, totalWasteValue = 0;

      for (const [barcode, { start, end }] of byBarcode) {
        if (!end) continue;

        const startVol = start?.total_volume_on_hand_ml || 0;
        const startVal = start?.total_value_on_hand || 0;
        const endVol = end.total_volume_on_hand_ml || 0;
        const endVal = end.total_value_on_hand || 0;
        const volumeMl = end.bottle_volume_ml || start?.bottle_volume_ml || 0;
        const costPerBottle = end.cost_per_bottle || start?.cost_per_bottle || 0;
        const events = eventsMap.get(barcode) || [];

        let deliveriesVol = 0, breakageVol = 0, compsVol = 0;
        for (const evt of events) {
          const evtVol = (evt.quantity || 0) * volumeMl;
          switch (evt.event_type) {
            case 'delivery': case 'transfer_in': deliveriesVol += evtVol; break;
            case 'breakage': case 'spoilage': breakageVol += evtVol; break;
            case 'comp': case 'transfer_out': compsVol += evtVol; break;
          }
        }

        const consumedVol = Math.max(startVol + deliveriesVol - breakageVol - compsVol - endVol, 0);
        const toVal = (vol: number) => volumeMl > 0 && costPerBottle > 0
          ? Math.round((vol / volumeMl) * costPerBottle * 100) / 100 : 0;

        const status = !start ? 'new' : 'tracked';

        items.push({
          product_id: end.product_id || start?.product_id || null,
          barcode,
          product_name: end.product_name || start?.product_name || '',
          product_brand: end.product_brand || start?.product_brand || '',
          status,
          start_volume_ml: startVol, start_value: startVal,
          end_volume_ml: endVol, end_value: endVal,
          deliveries_volume_ml: deliveriesVol,
          breakage_volume_ml: breakageVol,
          comps_volume_ml: compsVol,
          consumed_volume_ml: consumedVol,
          consumed_value: toVal(consumedVol),
          reading_count: byBarcode.get(barcode)!.all.filter(r => {
            const ts = r.timestamp?.toDate?.() || new Date(0);
            return ts >= startTs && ts <= endTs;
          }).length,
        });

        totalStartValue += startVal;
        totalEndValue += endVal;
        totalConsumedValue += toVal(consumedVol);
        totalDeliveriesValue += toVal(deliveriesVol);
        totalWasteValue += toVal(breakageVol + compsVol);
      }

      const report = {
        business,
        start_date, end_date,
        session_id: session_id || null,
        generated_at: admin.firestore.FieldValue.serverTimestamp(),
        items,
        total_start_value: Math.round(totalStartValue * 100) / 100,
        total_end_value: Math.round(totalEndValue * 100) / 100,
        total_consumed_value: Math.round(totalConsumedValue * 100) / 100,
        total_deliveries_value: Math.round(totalDeliveriesValue * 100) / 100,
        total_waste_value: Math.round(totalWasteValue * 100) / 100,
        products_tracked: items.length,
      };

      const ref = await db.collection(REPORTS).add(report);
      const saved = await ref.get();
      res.status(200).json({ _id: saved.id, ...saved.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  getReports = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business is associated with this account.', code: 'NO_BUSINESS' });

      let query: admin.firestore.Query = db.collection(REPORTS)
        .where('business', '==', business)
        .orderBy('generated_at', 'desc');

      if (req.query.limit) query = query.limit(parseInt(req.query.limit as string));

      const snapshot = await query.get();
      const docs = snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  getReport = async (req, res) => {
    try {
      const doc = await db.collection(REPORTS).doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Report not found' });
      res.status(200).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  // ─── Product Config ────────────────────────────────────────────────

  updateProductConfig = async (req, res) => {
    try {
      const barcode = req.params.barcode;
      if (!barcode) return res.status(400).json({ error: 'barcode is required' });

      const allowed = [
        'bottle_full_weight_g', 'bottle_empty_weight_g', 'bottle_volume_ml',
        'cost_per_bottle', 'cost_unit', 'par_level', 'product_type', 'tracking_method',
        'pour_price', 'pour_volume_ml',
        // Set false by the mobile capture flow when weights are physically
        // measured, so backfilled estimates can be told apart from real
        // measurements and re-measured selectively.
        'specs_estimated',
      ];
      const updates: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // Guard the same invariant the product upsert enforces: a bottle cannot
      // weigh less full than empty. Without this the config route is a way to
      // write a state that produces negative pours.
      const full = updates.bottle_full_weight_g;
      const empty = updates.bottle_empty_weight_g;
      if (full != null && empty != null && Number(full) <= Number(empty)) {
        return res.status(400).json({
          error: 'bottle_full_weight_g must be greater than bottle_empty_weight_g.',
        });
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const bottleSnap = await db.collection('bottles')
        .where('barcode', '==', barcode).limit(1).get();
      if (bottleSnap.empty) return res.status(404).json({ error: 'Product not found' });

      const docId = bottleSnap.docs[0].id;
      await db.collection('bottles').doc(docId).update(updates);
      const updated = await db.collection('bottles').doc(docId).get();
      res.status(200).json({ _id: updated.id, ...updated.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────

  private calcVolumes(weightG: number, fullWeight: number, emptyWeight: number,
    volumeMl: number, sealed: number, costPerBottle: number) {
    let estimatedVolumeMl = 0;
    if (fullWeight > 0 && emptyWeight > 0 && volumeMl > 0 && weightG > emptyWeight) {
      const liquidWeightG = weightG - emptyWeight;
      const fullLiquidWeight = fullWeight - emptyWeight;
      estimatedVolumeMl = Math.round((liquidWeightG / fullLiquidWeight) * volumeMl);
    }
    const sealedVolumeMl = sealed * (volumeMl || 0);
    const totalVolumeOnHandMl = estimatedVolumeMl + sealedVolumeMl;
    const totalValueOnHand = costPerBottle > 0
      ? Math.round(((estimatedVolumeMl / (volumeMl || 1)) + sealed) * costPerBottle * 100) / 100 : 0;
    return { estimatedVolumeMl, totalVolumeOnHandMl, totalValueOnHand };
  }

  getBusinessId(req: any): string | null {
    if (req.user?.business?.[0]?._id) return req.user.business[0]._id;
    if (req.user?.business?.[0]) return req.user.business[0];
    if (req.device?.business) return req.device.business;
    return null;
  }
}
