import { db } from '../firebase';

abstract class BaseCtrl {

  abstract collectionName: string;

  // Get all
  getAll = async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).get();
      const docs = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  // Get All and populate fields (Firestore doesn't support populate natively, returning raw data for now)
  getAllWith = (fields) => async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).get();
      const docs = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
      // TODO: Implement manual population if needed
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  // Count all
  count = async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).get();
      res.status(200).json(snapshot.size);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  // Insert
  insert = async (req, res) => {
    try {
      const data = req.body;
      const ref = await db.collection(this.collectionName).add(data);
      const doc = await ref.get();
      res.status(200).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  }

  // Get by id
  get = async (req, res) => {
    try {
      const doc = await db.collection(this.collectionName).doc(req.params.id).get();
      if (!doc.exists) {
        return res.sendStatus(404);
      }
      res.status(200).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  // Update by id
  update = async (req, res) => {
    try {
      await db.collection(this.collectionName).doc(req.params.id).update(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  }

  // Delete by id
  delete = async (req, res) => {
    try {
      await db.collection(this.collectionName).doc(req.params.id).delete();
      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
}

export default BaseCtrl;
