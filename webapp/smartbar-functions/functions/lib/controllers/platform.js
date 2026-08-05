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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt = __importStar(require("bcryptjs"));
const firebase_1 = require("../firebase");
/** Platform-level provisioning and lifecycle operations. */
class PlatformCtrl {
    constructor() {
        this.listBusinesses = async (_req, res) => {
            try {
                const [businesses, users, devices] = await Promise.all([
                    firebase_1.db.collection('businesses').get(),
                    firebase_1.db.collection('users').get(),
                    firebase_1.db.collection('devices').get(),
                ]);
                const usersByBusiness = {};
                users.docs.forEach(doc => (doc.data().business || []).forEach((id) => { usersByBusiness[id] = (usersByBusiness[id] || 0) + 1; }));
                const devicesByBusiness = {};
                devices.docs.forEach(doc => { const id = doc.data().business; if (id)
                    devicesByBusiness[id] = (devicesByBusiness[id] || 0) + 1; });
                res.json(businesses.docs.map(doc => (Object.assign(Object.assign({ _id: doc.id }, doc.data()), { status: doc.data().status || 'active', user_count: usersByBusiness[doc.id] || 0, device_count: devicesByBusiness[doc.id] || 0 }))));
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
        this.onboardBusiness = async (req, res) => {
            try {
                const { businessName, zipCode, firstName, lastName, email, password } = req.body || {};
                if (!businessName || !firstName || !lastName || !email || !password)
                    return res.status(400).json({ error: 'Business, owner name, email, and password are required.' });
                const existing = await firebase_1.db.collection('users').where('email', '==', email.trim().toLowerCase()).limit(1).get();
                if (!existing.empty)
                    return res.status(409).json({ error: 'A user with that email already exists.' });
                const businessRef = await firebase_1.db.collection('businesses').add({ name: businessName.trim(), zipCode: zipCode || '', status: 'active', createdAt: new Date(), onboardingStatus: 'invited' });
                const hash = await bcrypt.hash(password, 10);
                const userRef = await firebase_1.db.collection('users').add({
                    username: email.trim().toLowerCase(), email: email.trim().toLowerCase(), firstName, lastName,
                    password: hash, role: 'business_admin', business: [businessRef.id], status: 'active', createdAt: new Date(),
                });
                const deviceRef = await firebase_1.db.collection('devices').add({ business: businessRef.id, type: 'scan-scale', status: 'unassigned', createdAt: new Date() });
                res.status(201).json({
                    business: { _id: businessRef.id, name: businessName.trim(), zipCode: zipCode || '', status: 'active' },
                    owner: { _id: userRef.id, email: email.trim().toLowerCase(), firstName, lastName, role: 'business_admin' },
                    device: { _id: deviceRef.id, business: businessRef.id, status: 'unassigned' },
                });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
        this.updateBusinessStatus = async (req, res) => {
            var _a;
            try {
                const status = (_a = req.body) === null || _a === void 0 ? void 0 : _a.status;
                if (!['active', 'suspended', 'offboarded'].includes(status))
                    return res.status(400).json({ error: 'Invalid business status.' });
                const ref = firebase_1.db.collection('businesses').doc(req.params.id);
                const doc = await ref.get();
                if (!doc.exists)
                    return res.status(404).json({ error: 'Business not found.' });
                await ref.update({ status, updatedAt: new Date() });
                if (status !== 'active') {
                    const users = await firebase_1.db.collection('users').where('business', 'array-contains', req.params.id).get();
                    const batch = firebase_1.db.batch();
                    users.docs.forEach(user => batch.update(user.ref, { status: status === 'offboarded' ? 'offboarded' : 'suspended' }));
                    if (!users.empty)
                        await batch.commit();
                }
                res.json({ _id: req.params.id, status });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
        this.assignDevice = async (req, res) => {
            try {
                const { businessId } = req.body || {};
                const deviceRef = firebase_1.db.collection('devices').doc(req.params.id);
                const [device, business] = await Promise.all([deviceRef.get(), firebase_1.db.collection('businesses').doc(businessId).get()]);
                if (!device.exists)
                    return res.status(404).json({ error: 'Device not found.' });
                if (!business.exists)
                    return res.status(404).json({ error: 'Business not found.' });
                await deviceRef.update({ business: businessId, status: 'assigned', updatedAt: new Date() });
                res.json(Object.assign(Object.assign({ _id: device.id }, device.data()), { business: Object.assign({ _id: business.id }, business.data()), status: 'assigned' }));
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
    }
}
exports.default = PlatformCtrl;
//# sourceMappingURL=platform.js.map