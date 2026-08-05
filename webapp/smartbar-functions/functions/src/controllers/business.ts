import { db } from '../firebase';
import BaseCtrl from './base';

export default class BusinessCtrl extends BaseCtrl {
  collectionName = 'businesses';

  getUsers = async (req, res) => {
    try {
      const snapshot = await db.collection('users').where('business', 'array-contains', req.params.id).get();
      const users = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
      res.status(200).json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  getDevices = async (req, res) => {
    try {
      const snapshot = await db.collection('devices').where('business', '==', req.params.id).get();
      const devices = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
      res.status(200).json(devices);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  insert = async (req, res) => {
    try {
      const data = req.body;
      const ref = await db.collection(this.collectionName).add(data);
      const businessId = ref.id;

      // Create device
      const newDevice = {
        business: businessId,
        type: 'scan-scale'
      };
      await db.collection('devices').add(newDevice);

      const doc = await ref.get();
      res.status(200).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  }
}
