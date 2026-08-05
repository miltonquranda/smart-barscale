"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../firebase");
class BaseCtrl {
    constructor() {
        // Get all
        this.getAll = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).get();
                const docs = snapshot.docs.map(doc => (Object.assign({ _id: doc.id }, doc.data())));
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // Get All and populate fields (Firestore doesn't support populate natively, returning raw data for now)
        this.getAllWith = (fields) => async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).get();
                const docs = snapshot.docs.map(doc => (Object.assign({ _id: doc.id }, doc.data())));
                // TODO: Implement manual population if needed
                res.status(200).json(docs);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // Count all
        this.count = async (req, res) => {
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).get();
                res.status(200).json(snapshot.size);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // Insert
        this.insert = async (req, res) => {
            try {
                const data = req.body;
                const ref = await firebase_1.db.collection(this.collectionName).add(data);
                const doc = await ref.get();
                res.status(200).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(400).json({ error: err.message });
            }
        };
        // Get by id
        this.get = async (req, res) => {
            try {
                const doc = await firebase_1.db.collection(this.collectionName).doc(req.params.id).get();
                if (!doc.exists) {
                    return res.sendStatus(404);
                }
                res.status(200).json(Object.assign({ _id: doc.id }, doc.data()));
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        // Update by id
        this.update = async (req, res) => {
            try {
                await firebase_1.db.collection(this.collectionName).doc(req.params.id).update(req.body);
                res.sendStatus(200);
            }
            catch (err) {
                console.error(err);
                res.status(400).json({ error: err.message });
            }
        };
        // Delete by id
        this.delete = async (req, res) => {
            try {
                await firebase_1.db.collection(this.collectionName).doc(req.params.id).delete();
                res.sendStatus(200);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
    }
}
exports.default = BaseCtrl;
//# sourceMappingURL=base.js.map