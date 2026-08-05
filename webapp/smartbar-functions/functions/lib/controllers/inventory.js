"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../firebase");
const admin = __importStar(require("firebase-admin"));
const SESSIONS = 'inventory_sessions';
const READINGS = 'inventory_readings';
const EVENTS = 'inventory_events';
const REPORTS = 'consumption_reports';
class InventoryCtrl {
    constructor() {
        // ─── Sessions (optional named tracking periods) ─────────────────────
        this.startSession = async (req, res) => {
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
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
                const ref = await firebase_1.db.collection(SESSIONS).add(session);
                const doc = await ref.get();
                res.status(201).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.updateSession = async (req, res) => {
            try {
                const sessionId = req.params.id;
                const doc = await firebase_1.db.collection(SESSIONS).doc(sessionId).get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Session not found' });
                const { status, label, notes, closed_reason } = req.body;
                const updates = {};
                if (label !== undefined)
                    updates.label = label;
                if (notes !== undefined)
                    updates.notes = notes;
                if (status === 'paused') {
                    updates.status = 'paused';
                    updates.paused_at = admin.firestore.FieldValue.serverTimestamp();
                }
                else if (status === 'active') {
                    updates.status = 'active';
                    updates.paused_at = null;
                }
                else if (status === 'closed') {
                    updates.status = 'closed';
                    updates.closed_at = admin.firestore.FieldValue.serverTimestamp();
                    updates.closed_reason = closed_reason || 'manual';
                    const readingsCount = await firebase_1.db.collection(READINGS)
                        .where('session_id', '==', sessionId).get();
                    updates.reading_count = readingsCount.size;
                }
                await firebase_1.db.collection(SESSIONS).doc(sessionId).update(updates);
                const updated = await firebase_1.db.collection(SESSIONS).doc(sessionId).get();
                res.status(200).json(Object.assign({ _id: updated.id }, updated.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getSessions = async (req, res) => {
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                let query = firebase_1.db.collection(SESSIONS)
                    .where('business', '==', business)
                    .orderBy('started_at', 'desc');
                if (req.query.status) {
                    query = firebase_1.db.collection(SESSIONS)
                        .where('business', '==', business)
                        .where('status', '==', req.query.status)
                        .orderBy('started_at', 'desc');
                }
                if (req.query.limit) {
                    query = query.limit(parseInt(req.query.limit));
                }
                const snapshot = await query.get();
                const docs = snapshot.docs.map(d => (Object.assign({ _id: d.id }, d.data())));
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getSession = async (req, res) => {
            try {
                const doc = await firebase_1.db.collection(SESSIONS).doc(req.params.id).get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Session not found' });
                res.status(200).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.deleteSession = async (req, res) => {
            try {
                const sessionId = req.params.id;
                const doc = await firebase_1.db.collection(SESSIONS).doc(sessionId).get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Session not found' });
                // Unlink readings from this session (don't delete them — they're still valid data)
                const readings = await firebase_1.db.collection(READINGS)
                    .where('session_id', '==', sessionId).get();
                const batch = firebase_1.db.batch();
                readings.docs.forEach(r => batch.update(r.ref, { session_id: null }));
                batch.delete(firebase_1.db.collection(SESSIONS).doc(sessionId));
                await batch.commit();
                res.sendStatus(200);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // ─── Readings (continuous data stream) ──────────────────────────────
        /**
         * Called internally by bottleStat.insert on every device scan.
         * Also callable directly via API for manual entry.
         */
        this.createReading = async (business, barcode, weightG, opts = {}) => {
            var _a, _b;
            let prodId = opts.product_id || null;
            let prodName = opts.product_name || '';
            let prodBrand = opts.product_brand || '';
            let fullWeight = opts.bottle_full_weight_g || 0;
            let emptyWeight = opts.bottle_empty_weight_g || 0;
            let volumeMl = opts.bottle_volume_ml || 0;
            let costPerBottle = opts.cost_per_bottle || 0;
            if (!prodId) {
                const bottleSnap = await firebase_1.db.collection('bottles')
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
            const { estimatedVolumeMl, totalVolumeOnHandMl, totalValueOnHand } = this.calcVolumes(weightG, fullWeight, emptyWeight, volumeMl, sealed, costPerBottle);
            // Find previous reading for diff
            const prevSnap = await firebase_1.db.collection(READINGS)
                .where('business', '==', business)
                .where('barcode', '==', barcode)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();
            let prevVol = null;
            let prevSealed = null;
            let volumeChangeMl = 0;
            let sealedChange = 0;
            if (!prevSnap.empty) {
                const prev = prevSnap.docs[0].data();
                prevVol = (_a = prev.total_volume_on_hand_ml) !== null && _a !== void 0 ? _a : null;
                prevSealed = (_b = prev.sealed_count) !== null && _b !== void 0 ? _b : null;
                if (prevVol !== null)
                    volumeChangeMl = prevVol - totalVolumeOnHandMl;
                if (prevSealed !== null)
                    sealedChange = prevSealed - sealed;
            }
            // Check for active session to tag
            let sessionId = null;
            const activeSessions = await firebase_1.db.collection(SESSIONS)
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
            const ref = await firebase_1.db.collection(READINGS).add(reading);
            if (sessionId) {
                await firebase_1.db.collection(SESSIONS).doc(sessionId).update({
                    reading_count: admin.firestore.FieldValue.increment(1),
                });
            }
            const newDoc = await ref.get();
            return Object.assign({ _id: newDoc.id }, newDoc.data());
        };
        this.addReadingAPI = async (req, res) => {
            var _a, _b;
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                const { barcode, weight_g, open_bottle_weight_g, sealed_count, bottle_full_weight_g, bottle_empty_weight_g, bottle_volume_ml, cost_per_bottle, notes } = req.body;
                if (!barcode)
                    return res.status(400).json({ error: 'barcode is required' });
                const w = parseFloat(weight_g || open_bottle_weight_g) || 0;
                const result = await this.createReading(business, barcode, w, {
                    sealed_count: parseInt(sealed_count) || 0,
                    bottle_full_weight_g: parseFloat(bottle_full_weight_g) || 0,
                    bottle_empty_weight_g: parseFloat(bottle_empty_weight_g) || 0,
                    bottle_volume_ml: parseFloat(bottle_volume_ml) || 0,
                    cost_per_bottle: parseFloat(cost_per_bottle) || 0,
                    user_id: ((_a = req.user) === null || _a === void 0 ? void 0 : _a._id) || null,
                    device_id: ((_b = req.device) === null || _b === void 0 ? void 0 : _b._id) || null,
                    notes,
                });
                res.status(201).json(result);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getReadings = async (req, res) => {
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                let query = firebase_1.db.collection(READINGS)
                    .where('business', '==', business)
                    .orderBy('timestamp', 'desc');
                if (req.query.barcode) {
                    query = firebase_1.db.collection(READINGS)
                        .where('business', '==', business)
                        .where('barcode', '==', req.query.barcode)
                        .orderBy('timestamp', 'desc');
                }
                if (req.query.session_id) {
                    query = firebase_1.db.collection(READINGS)
                        .where('session_id', '==', req.query.session_id)
                        .orderBy('timestamp', 'desc');
                }
                if (req.query.limit) {
                    query = query.limit(parseInt(req.query.limit));
                }
                const snapshot = await query.get();
                const docs = snapshot.docs.map(d => (Object.assign({ _id: d.id }, d.data())));
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.deleteReading = async (req, res) => {
            try {
                const readingId = req.params.id;
                const doc = await firebase_1.db.collection(READINGS).doc(readingId).get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Reading not found' });
                await firebase_1.db.collection(READINGS).doc(readingId).delete();
                res.sendStatus(200);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // ─── Inventory Events ──────────────────────────────────────────────
        this.addEvent = async (req, res) => {
            var _a, _b;
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                const { barcode, product_id, event_type, quantity, weight_g, notes, date } = req.body;
                const validTypes = ['delivery', 'breakage', 'comp', 'transfer_in', 'transfer_out', 'spoilage', 'other'];
                if (!event_type || !validTypes.includes(event_type)) {
                    return res.status(400).json({ error: `event_type must be one of: ${validTypes.join(', ')}` });
                }
                let prodId = product_id || null;
                if (barcode && !prodId) {
                    const bottleSnap = await firebase_1.db.collection('bottles')
                        .where('barcode', '==', barcode).limit(1).get();
                    if (!bottleSnap.empty)
                        prodId = bottleSnap.docs[0].id;
                }
                const event = {
                    business, product_id: prodId, barcode: barcode || '',
                    event_type, quantity: parseInt(quantity) || 0,
                    weight_g: weight_g ? parseFloat(weight_g) : null,
                    notes: notes || '', date: date || new Date().toISOString().split('T')[0],
                    logged_by: ((_a = req.user) === null || _a === void 0 ? void 0 : _a._id) || ((_b = req.device) === null || _b === void 0 ? void 0 : _b._id) || null,
                    logged_at: admin.firestore.FieldValue.serverTimestamp(),
                };
                const ref = await firebase_1.db.collection(EVENTS).add(event);
                const doc = await ref.get();
                res.status(201).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getEvents = async (req, res) => {
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                let query = firebase_1.db.collection(EVENTS)
                    .where('business', '==', business)
                    .orderBy('logged_at', 'desc');
                if (req.query.limit) {
                    query = query.limit(parseInt(req.query.limit));
                }
                const snapshot = await query.get();
                const docs = snapshot.docs.map(d => (Object.assign({ _id: d.id }, d.data())));
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.deleteEvent = async (req, res) => {
            try {
                const doc = await firebase_1.db.collection(EVENTS).doc(req.params.id).get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Event not found' });
                await firebase_1.db.collection(EVENTS).doc(req.params.id).delete();
                res.sendStatus(200);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // ─── Consumption Report (time-range based) ─────────────────────────
        this.generateReport = async (req, res) => {
            var _a, _b;
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                const { start_date, end_date, session_id } = req.body;
                if (!start_date || !end_date) {
                    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
                }
                const startTs = new Date(start_date + 'T00:00:00Z');
                const endTs = new Date(end_date + 'T23:59:59Z');
                // For each barcode: find the closest reading AT or BEFORE start, and the latest reading AT or BEFORE end
                const allReadings = await firebase_1.db.collection(READINGS)
                    .where('business', '==', business)
                    .where('timestamp', '<=', endTs)
                    .orderBy('timestamp', 'desc')
                    .get();
                // Group readings by barcode, find start/end snapshots
                const byBarcode = new Map();
                for (const doc of allReadings.docs) {
                    const data = Object.assign({ _id: doc.id }, doc.data());
                    const bc = data.barcode;
                    if (!byBarcode.has(bc))
                        byBarcode.set(bc, { start: null, end: null, all: [] });
                    const entry = byBarcode.get(bc);
                    const ts = ((_b = (_a = data.timestamp) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) || new Date(0);
                    if (ts <= endTs && !entry.end) {
                        entry.end = data;
                    }
                    if (ts <= startTs && !entry.start) {
                        entry.start = data;
                    }
                    entry.all.push(data);
                }
                // Get events in the date range
                const eventsSnap = await firebase_1.db.collection(EVENTS)
                    .where('business', '==', business)
                    .where('date', '>=', start_date)
                    .where('date', '<=', end_date)
                    .get();
                const eventsMap = new Map();
                eventsSnap.docs.forEach(d => {
                    const data = d.data();
                    const key = data.barcode || 'unknown';
                    if (!eventsMap.has(key))
                        eventsMap.set(key, []);
                    eventsMap.get(key).push(data);
                });
                const items = [];
                let totalStartValue = 0, totalEndValue = 0, totalConsumedValue = 0;
                let totalDeliveriesValue = 0, totalWasteValue = 0;
                for (const [barcode, { start, end }] of byBarcode) {
                    if (!end)
                        continue;
                    const startVol = (start === null || start === void 0 ? void 0 : start.total_volume_on_hand_ml) || 0;
                    const startVal = (start === null || start === void 0 ? void 0 : start.total_value_on_hand) || 0;
                    const endVol = end.total_volume_on_hand_ml || 0;
                    const endVal = end.total_value_on_hand || 0;
                    const volumeMl = end.bottle_volume_ml || (start === null || start === void 0 ? void 0 : start.bottle_volume_ml) || 0;
                    const costPerBottle = end.cost_per_bottle || (start === null || start === void 0 ? void 0 : start.cost_per_bottle) || 0;
                    const events = eventsMap.get(barcode) || [];
                    let deliveriesVol = 0, breakageVol = 0, compsVol = 0;
                    for (const evt of events) {
                        const evtVol = (evt.quantity || 0) * volumeMl;
                        switch (evt.event_type) {
                            case 'delivery':
                            case 'transfer_in':
                                deliveriesVol += evtVol;
                                break;
                            case 'breakage':
                            case 'spoilage':
                                breakageVol += evtVol;
                                break;
                            case 'comp':
                            case 'transfer_out':
                                compsVol += evtVol;
                                break;
                        }
                    }
                    const consumedVol = Math.max(startVol + deliveriesVol - breakageVol - compsVol - endVol, 0);
                    const toVal = (vol) => volumeMl > 0 && costPerBottle > 0
                        ? Math.round((vol / volumeMl) * costPerBottle * 100) / 100 : 0;
                    const status = !start ? 'new' : 'tracked';
                    items.push({
                        product_id: end.product_id || (start === null || start === void 0 ? void 0 : start.product_id) || null,
                        barcode,
                        product_name: end.product_name || (start === null || start === void 0 ? void 0 : start.product_name) || '',
                        product_brand: end.product_brand || (start === null || start === void 0 ? void 0 : start.product_brand) || '',
                        status,
                        start_volume_ml: startVol, start_value: startVal,
                        end_volume_ml: endVol, end_value: endVal,
                        deliveries_volume_ml: deliveriesVol,
                        breakage_volume_ml: breakageVol,
                        comps_volume_ml: compsVol,
                        consumed_volume_ml: consumedVol,
                        consumed_value: toVal(consumedVol),
                        reading_count: byBarcode.get(barcode).all.filter(r => {
                            var _a, _b;
                            const ts = ((_b = (_a = r.timestamp) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) || new Date(0);
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
                const ref = await firebase_1.db.collection(REPORTS).add(report);
                const saved = await ref.get();
                res.status(200).json(Object.assign({ _id: saved.id }, saved.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getReports = async (req, res) => {
            try {
                const business = this.getBusinessId(req);
                if (!business)
                    return res.status(403).json({ error: 'No business associated' });
                let query = firebase_1.db.collection(REPORTS)
                    .where('business', '==', business)
                    .orderBy('generated_at', 'desc');
                if (req.query.limit)
                    query = query.limit(parseInt(req.query.limit));
                const snapshot = await query.get();
                const docs = snapshot.docs.map(d => (Object.assign({ _id: d.id }, d.data())));
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getReport = async (req, res) => {
            try {
                const doc = await firebase_1.db.collection(REPORTS).doc(req.params.id).get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Report not found' });
                res.status(200).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // ─── Product Config ────────────────────────────────────────────────
        this.updateProductConfig = async (req, res) => {
            try {
                const barcode = req.params.barcode;
                if (!barcode)
                    return res.status(400).json({ error: 'barcode is required' });
                const allowed = [
                    'bottle_full_weight_g', 'bottle_empty_weight_g', 'bottle_volume_ml',
                    'cost_per_bottle', 'cost_unit', 'par_level', 'product_type', 'tracking_method',
                ];
                const updates = {};
                for (const key of allowed) {
                    if (req.body[key] !== undefined)
                        updates[key] = req.body[key];
                }
                if (Object.keys(updates).length === 0) {
                    return res.status(400).json({ error: 'No valid fields to update' });
                }
                const bottleSnap = await firebase_1.db.collection('bottles')
                    .where('barcode', '==', barcode).limit(1).get();
                if (bottleSnap.empty)
                    return res.status(404).json({ error: 'Product not found' });
                const docId = bottleSnap.docs[0].id;
                await firebase_1.db.collection('bottles').doc(docId).update(updates);
                const updated = await firebase_1.db.collection('bottles').doc(docId).get();
                res.status(200).json(Object.assign({ _id: updated.id }, updated.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
    }
    // ─── Helpers ───────────────────────────────────────────────────────
    calcVolumes(weightG, fullWeight, emptyWeight, volumeMl, sealed, costPerBottle) {
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
    getBusinessId(req) {
        var _a, _b, _c, _d, _e, _f;
        if ((_c = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.business) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c._id)
            return req.user.business[0]._id;
        if ((_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.business) === null || _e === void 0 ? void 0 : _e[0])
            return req.user.business[0];
        if ((_f = req.device) === null || _f === void 0 ? void 0 : _f.business)
            return req.device.business;
        return null;
    }
}
exports.default = InventoryCtrl;
//# sourceMappingURL=inventory.js.map