import * as jwt from 'jsonwebtoken';
import { db } from '../firebase';
import BaseCtrl from './base';

export default class DeviceCtrl extends BaseCtrl {
  collectionName = 'devices';

  getAll = async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).get();
      const docs = await Promise.all(snapshot.docs.map(async doc => {
        const data = doc.data();
        let business = null;
        if (data.business) {
          const bizDoc = await db.collection('businesses').doc(data.business).get();
          if (bizDoc.exists) business = { _id: bizDoc.id, ...bizDoc.data() };
        }
        return { _id: doc.id, ...data, business };
      }));
      res.status(200).json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  login = async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).where('serialNumber', '==', req.body.serialNumber).limit(1).get();
      if (snapshot.empty) { return res.sendStatus(403); }
      const doc = snapshot.docs[0];
      const device: any = { _id: doc.id, ...doc.data() };

      if (device.business) {
        const bizDoc = await db.collection('businesses').doc(device.business).get();
        if (bizDoc.exists) device.business = { _id: bizDoc.id, ...bizDoc.data() };
      }

      const token = jwt.sign({ serialNumber: device }, process.env.SECRET_TOKEN);
      res.status(200).json({ token: token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
}
