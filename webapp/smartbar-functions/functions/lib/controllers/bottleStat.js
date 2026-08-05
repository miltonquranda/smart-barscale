"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../firebase");
const base_1 = __importDefault(require("./base"));
const productLookup_1 = require("../productLookup");
const inventory_1 = __importDefault(require("./inventory"));
const demo_1 = __importDefault(require("./demo"));
const inventoryCtrl = new inventory_1.default();
const demoCtrl = new demo_1.default();
class BottleStatCtrl extends base_1.default {
    constructor() {
        super(...arguments);
        this.collectionName = 'bottle-stats';
        this.getAll = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).get();
                const docs = await Promise.all(snapshot.docs.map(async (doc) => {
                    const data = doc.data();
                    let bottle = null;
                    let business = null;
                    if (data.bottle) {
                        const bDoc = await firebase_1.db.collection('bottles').doc(data.bottle).get();
                        if (bDoc.exists)
                            bottle = Object.assign({ _id: bDoc.id }, bDoc.data());
                    }
                    if (data.business) {
                        const bizDoc = await firebase_1.db.collection('businesses').doc(data.business).get();
                        if (bizDoc.exists)
                            business = Object.assign({ _id: bizDoc.id }, bizDoc.data());
                    }
                    return Object.assign(Object.assign({ _id: doc.id }, data), { bottle, business });
                }));
                res.status(200).json(docs);
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
        this.getAllInBusiness = async (req, res) => {
            try {
                if (!req.user)
                    return res.status(403).json({ message: 'not authorized' });
                let query = firebase_1.db.collection(this.collectionName).where('business', '==', req.user.business[0]._id || req.user.business[0]);
                if (req.query.start && req.query.end) {
                    query = query.where('date', '>', req.query.start).where('date', '<', req.query.end);
                }
                const snapshot = await query.get();
                const docs = await Promise.all(snapshot.docs.map(async (doc) => {
                    const data = doc.data();
                    let bottle = null;
                    if (data.bottle) {
                        const bDoc = await firebase_1.db.collection('bottles').doc(data.bottle).get();
                        if (bDoc.exists)
                            bottle = Object.assign({ _id: bDoc.id }, bDoc.data());
                    }
                    return Object.assign(Object.assign({ _id: doc.id }, data), { bottle });
                }));
                res.status(200).json(docs);
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
        this.insert = async (req, res) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const barcode = req.body.barcode;
            // Always use the server's current time for accuracy instead of the ESP32's uptime seconds
            req.body.date = new Date().toISOString();
            try {
                const result = await (0, productLookup_1.lookupProduct)(barcode);
                if (result) {
                    req.body.bottle = result.bottleId;
                    const business = req.user
                        ? (((_b = (_a = req.user.business) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b._id) || ((_c = req.user.business) === null || _c === void 0 ? void 0 : _c[0]) || null)
                        : (((_d = req.device) === null || _d === void 0 ? void 0 : _d.business) || null);
                    const stat = Object.assign({}, req.body);
                    if (business)
                        stat.business = business;
                    if (((_e = req.device) === null || _e === void 0 ? void 0 : _e.demo) || ((_f = req.device) === null || _f === void 0 ? void 0 : _f.business) === 'demo-bar') {
                        await demoCtrl.recordDeviceScan(barcode, parseFloat(req.body.weight) || 0, result.bottleId);
                    }
                    await this.addBottleStat(stat, res);
                }
                else {
                    if (((_g = req.device) === null || _g === void 0 ? void 0 : _g.demo) || ((_h = req.device) === null || _h === void 0 ? void 0 : _h.business) === 'demo-bar') {
                        const scan = await demoCtrl.recordUnknownDeviceScan(barcode, parseFloat(req.body.weight) || 0);
                        return res.status(201).json(Object.assign(Object.assign({}, scan), { message: 'Barcode recorded for Demo Bar; product needs to be added.' }));
                    }
                    res.status(404).json({ error: 'Product not found for barcode: ' + barcode });
                }
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.addBottleStat = async (newStat, res) => {
            try {
                const ref = await firebase_1.db.collection(this.collectionName).add(newStat);
                const doc = await ref.get();
                const statData = Object.assign({ _id: doc.id }, doc.data());
                // Auto-create inventory reading from device scan
                if (newStat.business && newStat.barcode && newStat.weight != null) {
                    try {
                        await inventoryCtrl.createReading(newStat.business, newStat.barcode, parseFloat(newStat.weight) || 0, {
                            product_id: newStat.bottle || undefined,
                            device_id: newStat.device_id || undefined,
                        });
                    }
                    catch (invErr) {
                        console.error('Inventory reading auto-create failed (non-blocking):', invErr);
                    }
                }
                res.status(200).json(statData);
            }
            catch (err) {
                res.status(400).json({ error: err.message });
            }
        };
    }
}
exports.default = BottleStatCtrl;
//# sourceMappingURL=bottleStat.js.map