"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../firebase");
const base_1 = __importDefault(require("./base"));
class BusinessCtrl extends base_1.default {
    constructor() {
        super(...arguments);
        this.collectionName = 'businesses';
        this.getUsers = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection('users').where('business', 'array-contains', req.params.id).get();
                const users = snapshot.docs.map(doc => (Object.assign({ _id: doc.id }, doc.data())));
                res.status(200).json(users);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getDevices = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection('devices').where('business', '==', req.params.id).get();
                const devices = snapshot.docs.map(doc => (Object.assign({ _id: doc.id }, doc.data())));
                res.status(200).json(devices);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.insert = async (req, res) => {
            try {
                const data = req.body;
                const ref = await firebase_1.db.collection(this.collectionName).add(data);
                const businessId = ref.id;
                // Create device
                const newDevice = {
                    business: businessId,
                    type: 'scan-scale'
                };
                await firebase_1.db.collection('devices').add(newDevice);
                const doc = await ref.get();
                res.status(200).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(400).json({ error: err.message });
            }
        };
    }
}
exports.default = BusinessCtrl;
//# sourceMappingURL=business.js.map