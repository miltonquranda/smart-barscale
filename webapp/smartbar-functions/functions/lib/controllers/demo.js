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
exports.DEMO_DEVICE_SERIAL = exports.DEMO_DEVICE_SERIALS = void 0;
const firebase_1 = require("../firebase");
const admin = __importStar(require("firebase-admin"));
const DEMO_BUSINESS = 'demo-bar';
const INVENTORY = 'demo_inventory';
const EVENTS = 'demo_events';
const META = 'demo_meta';
exports.DEMO_DEVICE_SERIALS = ['SB_B017B2215788', 'SB_A40FB1215788'];
exports.DEMO_DEVICE_SERIAL = exports.DEMO_DEVICE_SERIALS[0];
const money = (n) => Math.round(n * 100) / 100;
const daysAgo = (days) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d.toISOString();
};
const volumeFromProduct = (product) => {
    var _a;
    const quantity = String((product === null || product === void 0 ? void 0 : product.quantity) || '750 ml');
    const match = quantity.match(/[0-9]+(?:\.[0-9]+)?/);
    const amount = Number((match === null || match === void 0 ? void 0 : match[0]) || 0);
    // Some imported liquor records use quantity="1" and weight="750".
    // Quantity is a bottle count in that case, not a liquid volume.
    if (/\bL(?:iters?)?\b/i.test(quantity))
        return amount * 1000;
    if (/\bml\b/i.test(quantity) && amount > 10)
        return amount;
    const weight = Number(((_a = String((product === null || product === void 0 ? void 0 : product.weight) || '').match(/[0-9]+(?:\.[0-9]+)?/)) === null || _a === void 0 ? void 0 : _a[0]) || 0);
    if (amount > 10)
        return amount;
    if (weight > 10)
        return weight;
    return 750;
};
async function deleteCollection(name) {
    const snapshot = await firebase_1.db.collection(name).get();
    for (let i = 0; i < snapshot.docs.length; i += 450) {
        const batch = firebase_1.db.batch();
        snapshot.docs.slice(i, i + 450).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
}
class DemoCtrl {
    constructor() {
        /**
         * Make a catalog bottle available to the Demo Bar on first use. Demo data
         * is seeded as a snapshot, so products added later must be copied into the
         * demo inventory when a real device scans them.
         */
        this.ensureDemoInventory = async (barcode, productId) => {
            const existing = await firebase_1.db.collection(INVENTORY).where('barcode', '==', barcode).limit(20).get();
            const existingDoc = existing.docs.find(doc => doc.data().business === DEMO_BUSINESS);
            if (existingDoc) {
                const current = existingDoc.data();
                const productDoc = current.product_id ? await firebase_1.db.collection('bottles').doc(current.product_id).get() : null;
                if (productDoc === null || productDoc === void 0 ? void 0 : productDoc.exists) {
                    const master = productDoc.data();
                    const volume = volumeFromProduct(master);
                    const pourPrice = Number.isFinite(Number(master.pour_price)) ? Number(master.pour_price) : null;
                    const pourVolume = Number.isFinite(Number(master.pour_volume_ml)) ? Number(master.pour_volume_ml) : 30;
                    if (Number(current.volume_ml || 0) <= 10 || current.pour_price !== pourPrice || current.pour_volume_ml !== pourVolume) {
                        const emptyWeight = Number(master.bottle_empty_weight_g || current.bottle_empty_weight_g || 200);
                        const fullWeight = Number(master.bottle_full_weight_g || emptyWeight + volume);
                        const repaired = Number(current.volume_ml || 0) <= 10;
                        const update = { volume_ml: volume, pour_price: pourPrice, pour_volume_ml: pourVolume };
                        if (repaired)
                            Object.assign(update, {
                                on_hand_ml: volume, open_volume_ml: volume, sealed_count: 0,
                                scale_weight_g: fullWeight, bottle_empty_weight_g: emptyWeight,
                                bottle_full_weight_g: fullWeight, consumed_ml: 0, waste_ml: 0,
                                consumed_value: 0, waste_value: 0,
                                revenue_value: 0,
                                on_hand_value: Number(current.cost_per_bottle || master.cost_per_bottle || 25),
                            });
                        await existingDoc.ref.update(update);
                        return { ref: existingDoc.ref, data: Object.assign(Object.assign({}, current), update), created: false };
                    }
                }
                return { ref: existingDoc.ref, data: current, created: false };
            }
            let bottle = null;
            if (productId) {
                const productDoc = await firebase_1.db.collection('bottles').doc(productId).get();
                if (productDoc.exists)
                    bottle = Object.assign({ _id: productDoc.id }, productDoc.data());
            }
            if (!bottle) {
                const productSnapshot = await firebase_1.db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
                if (!productSnapshot.empty)
                    bottle = Object.assign({ _id: productSnapshot.docs[0].id }, productSnapshot.docs[0].data());
            }
            if (!bottle)
                return null;
            const volume = volumeFromProduct(bottle);
            const emptyWeight = Number(bottle.bottle_empty_weight_g || 200);
            const fullWeight = Number(bottle.bottle_full_weight_g || emptyWeight + volume);
            const ref = firebase_1.db.collection(INVENTORY).doc(bottle._id || barcode);
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
        this.recordDeviceScan = async (barcode, weightG, productId) => {
            const ensured = await this.ensureDemoInventory(barcode, productId);
            if (!ensured)
                return { recorded: false, reason: 'Product is not in the catalog.' };
            const ref = ensured.ref;
            const product = ensured.data;
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
                revenue_value: money((Number(product.revenue_value || 0) + (Number(product.pour_price) > 0 && Number(product.pour_volume_ml) > 0
                    ? consumed / Number(product.pour_volume_ml) * Number(product.pour_price) : 0))),
                scans_today: Number(product.scans_today || 0) + 1,
                last_scan: 'just now', updated_at: admin.firestore.FieldValue.serverTimestamp(),
            };
            await ref.update(update);
            await firebase_1.db.collection(EVENTS).add({
                business: DEMO_BUSINESS, product_id: productId || product.product_id, barcode,
                event_type: firstScan ? 'inventory_added' : 'consumption', consumed_ml: consumed, waste_ml: 0,
                weight_g: nextWeight, previous_weight_g: previousWeight, source: 'demo_device_scan',
                timestamp: admin.firestore.Timestamp.now(),
            });
            return { recorded: true, product: product.name, consumed_ml: consumed, waste_ml: 0, weight_g: nextWeight };
        };
        this.recordUnknownDeviceScan = async (barcode, weightG) => {
            await firebase_1.db.collection(EVENTS).add({
                business: DEMO_BUSINESS, barcode, event_type: 'unmatched_scan', consumed_ml: 0,
                waste_ml: 0, weight_g: Number(weightG) || 0, source: 'demo_device_scan',
                timestamp: admin.firestore.Timestamp.now(),
            });
            return { recorded: true, matched: false, barcode, weight_g: Number(weightG) || 0 };
        };
        // When a user identifies an unmatched scan in the mobile app, promote that
        // original reading into Demo Bar inventory without requiring another scan.
        this.claimUnknownScan = async (barcode, productId) => {
            const snapshot = await firebase_1.db.collection(EVENTS).where('barcode', '==', barcode).limit(50).get();
            const unmatched = snapshot.docs.filter(doc => {
                const data = doc.data();
                return data.business === DEMO_BUSINESS && data.event_type === 'unmatched_scan' && !data.resolved;
            });
            if (!unmatched.length)
                return null;
            const event = unmatched[unmatched.length - 1];
            const data = event.data();
            const result = await this.recordDeviceScan(barcode, Number(data.weight_g) || 0, productId);
            await event.ref.update({ resolved: true, resolved_at: admin.firestore.FieldValue.serverTimestamp(), product_id: productId });
            return result;
        };
        this.seed = async (_req, res) => {
            try {
                await deleteCollection(INVENTORY);
                await deleteCollection(EVENTS);
                const bottles = (await firebase_1.db.collection('bottles').limit(12).get()).docs;
                if (!bottles.length)
                    return res.status(400).json({ error: 'Import products before seeding the demo.' });
                const batch = firebase_1.db.batch();
                bottles.forEach((doc, index) => {
                    const p = doc.data();
                    const volume = volumeFromProduct(p);
                    const cost = Number(p.cost_per_bottle || 25);
                    const consumed = 350 + (index * 83) % 650;
                    const waste = 15 + (index * 17) % 90;
                    const onHand = volume * (2 + (index % 4)) - consumed;
                    const emptyWeight = Number(p.bottle_empty_weight_g || 200);
                    const sealedCount = Math.floor(Math.max(onHand, 0) / volume);
                    const openVolume = Math.max(0, Math.max(onHand, 0) - sealedCount * volume);
                    const category = String(p.category || 'Uncategorized');
                    batch.set(firebase_1.db.collection(INVENTORY).doc(doc.id), {
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
                const eventBatch = firebase_1.db.batch();
                for (let day = 27; day >= 0; day--) {
                    bottles.forEach((doc, index) => {
                        const p = doc.data();
                        const consumed = 35 + ((day + index * 13) % 70);
                        eventBatch.set(firebase_1.db.collection(EVENTS).doc(), {
                            business: DEMO_BUSINESS, product_id: doc.id, barcode: p.barcode || doc.id,
                            event_type: 'consumption', consumed_ml: consumed,
                            waste_ml: day % 9 === index % 9 ? 20 + index * 3 : 0,
                            shift: day % 3 === 0 ? 'Late Night' : day % 2 === 0 ? 'Evening' : 'Day Shift',
                            timestamp: admin.firestore.Timestamp.fromDate(new Date(daysAgo(day))),
                        });
                    });
                }
                await eventBatch.commit();
                await firebase_1.db.collection(META).doc(DEMO_BUSINESS).set({
                    business: DEMO_BUSINESS, name: 'Demo Bar', seeded_at: admin.firestore.FieldValue.serverTimestamp(),
                });
                res.status(201).json({ business: DEMO_BUSINESS, products: bottles.length, days: 28 });
            }
            catch (err) {
                console.error('Demo seed failed:', err);
                res.status(500).json({ error: err.message });
            }
        };
        this.reset = async (_req, res) => {
            try {
                await deleteCollection(INVENTORY);
                await deleteCollection(EVENTS);
                await firebase_1.db.collection(META).doc(DEMO_BUSINESS).delete();
                res.sendStatus(204);
            }
            catch (err) {
                console.error('Demo reset failed:', err);
                res.status(500).json({ error: err.message });
            }
        };
        this.simulate = async (req, res) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            try {
                const scenario = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.scenario) || 'busy_friday';
                const snapshot = await firebase_1.db.collection(INVENTORY).limit(12).get();
                if (snapshot.empty)
                    return res.status(400).json({ error: 'Seed the demo before running a scenario.' });
                const requestedProduct = (_b = req.body) === null || _b === void 0 ? void 0 : _b.product_id;
                const target = requestedProduct
                    ? snapshot.docs.find(doc => doc.id === requestedProduct) || snapshot.docs[0]
                    : snapshot.docs[scenario === 'anomaly' ? 1 : 0];
                const p = target.data();
                const defaultConsumed = scenario === 'delivery' ? 0 : scenario === 'anomaly' ? 60 : 260;
                const defaultWaste = scenario === 'anomaly' ? 180 : scenario === 'busy_friday' ? 45 : 0;
                const scaleWeightInput = Number((_c = req.body) === null || _c === void 0 ? void 0 : _c.scale_weight_g);
                const expectedInput = Number((_d = req.body) === null || _d === void 0 ? void 0 : _d.expected_consumed_ml);
                const sealedInput = Number((_e = req.body) === null || _e === void 0 ? void 0 : _e.sealed_count);
                const addedInput = Number((_g = (_f = req.body) === null || _f === void 0 ? void 0 : _f.added_bottles) !== null && _g !== void 0 ? _g : (_h = req.body) === null || _h === void 0 ? void 0 : _h.delivery_bottles);
                const volume = Number(p.volume_ml || 750);
                const emptyWeight = Number(p.bottle_empty_weight_g || 200);
                const previousSealedCount = Number((_j = p.sealed_count) !== null && _j !== void 0 ? _j : Math.floor(Number(p.on_hand_ml || 0) / volume));
                const previousOpenVolume = Number((_k = p.open_volume_ml) !== null && _k !== void 0 ? _k : Math.max(0, Number(p.on_hand_ml || 0) - previousSealedCount * volume));
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
                await firebase_1.db.collection(EVENTS).add({
                    business: DEMO_BUSINESS, product_id: target.id, barcode: p.barcode,
                    event_type: delivery ? 'delivery' : waste ? 'breakage' : 'consumption',
                    consumed_ml: consumed, waste_ml: waste, delivery_bottles: addedBottles,
                    shift: 'Evening', timestamp: admin.firestore.Timestamp.now(), scenario,
                });
                res.status(201).json({ scenario, product: p.name, consumed_ml: consumed, waste_ml: waste, delivery_bottles: addedBottles, previous_scale_weight_g: previousScaleWeight, scale_weight_g: newScaleWeight, previous_sealed_count: previousSealedCount, sealed_count: newSealedCount, previous_total_ml: previousTotal, current_total_ml: currentTotal, measured_loss_ml: measuredLoss, expected_consumed_ml: expectedConsumed });
            }
            catch (err) {
                console.error('Demo simulation failed:', err);
                res.status(500).json({ error: err.message });
            }
        };
        this.dashboard = async (_req, res) => {
            try {
                const [inventorySnapshot, eventsSnapshot, categoriesSnapshot] = await Promise.all([
                    firebase_1.db.collection(INVENTORY).where('business', '==', DEMO_BUSINESS).get(),
                    firebase_1.db.collection(EVENTS).where('business', '==', DEMO_BUSINESS).get(),
                    firebase_1.db.collection('categories').get(),
                ]);
                const categoryNames = new Map();
                categoriesSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    categoryNames.set(doc.id, data.name || data.path || doc.id);
                });
                const inventory = inventorySnapshot.docs.map(d => {
                    const data = d.data();
                    const categoryId = String(data.category || '');
                    return Object.assign(Object.assign({ _id: d.id }, data), { 
                        // Keep the ID for internal use, but expose the human-readable label
                        // consumed by the dashboard table and category breakdown.
                        category_id: categoryId, category: categoryNames.get(categoryId) || (categoryId || 'Uncategorized') });
                });
                const events = eventsSnapshot.docs.map(d => d.data());
                if (!inventory.length)
                    return res.status(404).json({ error: 'Demo is not seeded.' });
                const pricing = new Map(inventory.map((p) => [String(p.product_id || p._id), p]));
                const dailyConsumption = Array.from({ length: 7 }, (_, i) => {
                    const day = new Date();
                    day.setHours(12, 0, 0, 0);
                    day.setDate(day.getDate() - (6 - i));
                    const date = day.toISOString().slice(0, 10);
                    const dayEvents = events.filter(e => { var _a; return String(((_a = e.timestamp) === null || _a === void 0 ? void 0 : _a.toDate) ? e.timestamp.toDate().toISOString() : e.timestamp).slice(0, 10) === date; });
                    const consumed = dayEvents.reduce((sum, e) => sum + Number(e.consumed_ml || 0), 0);
                    const waste = dayEvents.reduce((sum, e) => sum + Number(e.waste_ml || 0), 0);
                    const revenue = dayEvents.reduce((sum, e) => {
                        const product = pricing.get(String(e.product_id || ''));
                        const pourPrice = Number(product === null || product === void 0 ? void 0 : product.pour_price);
                        const pourVolume = Number(product === null || product === void 0 ? void 0 : product.pour_volume_ml);
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
                const categoryMap = {};
                inventory.forEach(p => { const key = String(p.category || 'Uncategorized'); categoryMap[key] = (categoryMap[key] || 0) + Number(p.consumed_value || 0); });
                const categoryTotal = Number(Object.values(categoryMap).reduce((s, v) => s + Number(v), 0)) || 1;
                const colors = ['#007bff', '#f0ad4e', '#28a745', '#dc3545', '#17a2b8', '#6f42c1', '#e83e8c'];
                const categoryBreakdown = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).map(([category, value], i) => ({ category, value: Math.round(value), pct: Math.round(value / categoryTotal * 100), color: colors[i % colors.length] }));
                const avgPourCost = inventory.reduce((s, p) => s + Number(p.pour_cost_pct || 0), 0) / inventory.length;
                const alerts = inventory.filter(p => Number(p.pour_cost_pct) > 25 || Number(p.waste_ml) > 100).slice(0, 5).map(p => ({ type: Number(p.waste_ml) > 100 ? 'warning' : 'danger', icon: Number(p.waste_ml) > 100 ? '⚠' : '🔴', message: `${p.name} shows ${p.waste_ml}ml waste and ${p.pour_cost_pct}% pour cost`, time: p.last_scan }));
                while (alerts.length < 3)
                    alerts.push({ type: 'info', icon: '📦', message: 'Inventory data is ready for the next simulated shift.', time: 'now' });
                res.json({ business: { id: DEMO_BUSINESS, name: 'Demo Bar' }, summary: { totalOnHand, totalConsumed, totalWaste, totalRevenue, avgPourCost }, products: inventory.sort((a, b) => b.consumed_value - a.consumed_value), dailyConsumption, categoryBreakdown, alerts, weeklyTrend: [1, 2, 3, 4].map((week, i) => ({ week: `Week ${week}`, inventory_value: Math.round(totalOnHand * (0.82 + i * 0.06)), consumed_value: Math.round(totalConsumed * (0.72 + i * 0.09)), waste_value: Math.round(totalWaste * (0.7 + i * 0.1)) })), shifts: [{ name: 'Day Shift (8am–4pm)', bartender: 'Sarah M.', pour_cost: 18.2, variance: -0.8, scans: 34, color: '#28a745' }, { name: 'Evening (4pm–12am)', bartender: 'Mike T.', pour_cost: 22.7, variance: 2.1, scans: 67, color: '#f0ad4e' }, { name: 'Late Night (12am–close)', bartender: 'Alex R.', pour_cost: 28.4, variance: 8.4, scans: 23, color: '#dc3545' }] });
            }
            catch (err) {
                console.error('Demo dashboard failed:', err);
                res.status(500).json({ error: err.message });
            }
        };
    }
}
exports.default = DemoCtrl;
//# sourceMappingURL=demo.js.map