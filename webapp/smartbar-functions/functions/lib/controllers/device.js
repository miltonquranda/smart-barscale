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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jwt = __importStar(require("jsonwebtoken"));
const firebase_1 = require("../firebase");
const base_1 = __importDefault(require("./base"));
const demo_1 = require("./demo");
class DeviceCtrl extends base_1.default {
    constructor() {
        super(...arguments);
        this.collectionName = 'devices';
        this.getAll = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).get();
                const docs = await Promise.all(snapshot.docs.map(async (doc) => {
                    const data = doc.data();
                    let business = null;
                    if (data.business) {
                        const bizDoc = await firebase_1.db.collection('businesses').doc(data.business).get();
                        if (bizDoc.exists)
                            business = Object.assign({ _id: bizDoc.id }, bizDoc.data());
                    }
                    return Object.assign(Object.assign({ _id: doc.id }, data), { business });
                }));
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getBySerial = async (req, res) => {
            try {
                const serial = req.params.serialNumber;
                const snapshot = await firebase_1.db.collection(this.collectionName).where('serialNumber', '==', serial).limit(1).get();
                if (snapshot.empty)
                    return res.status(404).json({ error: 'Device not found' });
                const doc = snapshot.docs[0];
                const device = Object.assign({ _id: doc.id }, doc.data());
                if (device.business) {
                    const bizDoc = await firebase_1.db.collection('businesses').doc(device.business).get();
                    if (bizDoc.exists)
                        device.business = Object.assign({ _id: bizDoc.id }, bizDoc.data());
                }
                res.status(200).json(device);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.assignBusiness = async (req, res) => {
            try {
                const serial = req.params.serialNumber;
                const { businessId } = req.body;
                if (!businessId)
                    return res.status(400).json({ error: 'businessId is required' });
                const snapshot = await firebase_1.db.collection(this.collectionName).where('serialNumber', '==', serial).limit(1).get();
                if (snapshot.empty)
                    return res.status(404).json({ error: 'Device not found' });
                const doc = snapshot.docs[0];
                const device = Object.assign({ _id: doc.id }, doc.data());
                // Only allow assignment if device has no business yet
                if (device.business) {
                    const bizDoc = await firebase_1.db.collection('businesses').doc(device.business).get();
                    const bizName = bizDoc.exists ? bizDoc.data().name : device.business;
                    return res.status(403).json({ error: `Device already assigned to ${bizName}. Contact admin to reassign.` });
                }
                // Verify business exists
                const bizDoc = await firebase_1.db.collection('businesses').doc(businessId).get();
                if (!bizDoc.exists)
                    return res.status(404).json({ error: 'Business not found' });
                await firebase_1.db.collection(this.collectionName).doc(doc.id).update({ business: businessId });
                res.status(200).json(Object.assign(Object.assign({ _id: doc.id }, doc.data()), { business: Object.assign({ _id: bizDoc.id }, bizDoc.data()) }));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.login = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).where('serialNumber', '==', req.body.serialNumber).limit(1).get();
                if (snapshot.empty) {
                    // Auto-register device
                    const newDeviceRef = await firebase_1.db.collection(this.collectionName).add(Object.assign({ serialNumber: req.body.serialNumber, createdAt: new Date(), status: 'online' }, (demo_1.DEMO_DEVICE_SERIALS.includes(req.body.serialNumber) ? { business: 'demo-bar', demo: true } : {})));
                    const isDemo = demo_1.DEMO_DEVICE_SERIALS.includes(req.body.serialNumber);
                    const token = jwt.sign({ serialNumber: { _id: newDeviceRef.id, serialNumber: req.body.serialNumber, business: isDemo ? 'demo-bar' : undefined, demo: isDemo } }, process.env.SECRET_TOKEN);
                    return res.status(200).json({ token: token });
                }
                const doc = snapshot.docs[0];
                const device = Object.assign({ _id: doc.id }, doc.data());
                if (demo_1.DEMO_DEVICE_SERIALS.includes(req.body.serialNumber) && device.business !== 'demo-bar') {
                    await doc.ref.update({ business: 'demo-bar', demo: true, status: 'online' });
                    device.business = 'demo-bar';
                    device.demo = true;
                }
                if (device.business) {
                    const bizDoc = await firebase_1.db.collection('businesses').doc(device.business).get();
                    if (bizDoc.exists)
                        device.business = Object.assign({ _id: bizDoc.id }, bizDoc.data());
                }
                const token = jwt.sign({ serialNumber: device }, process.env.SECRET_TOKEN);
                res.status(200).json({ token: token });
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
    }
}
exports.default = DeviceCtrl;
//# sourceMappingURL=device.js.map