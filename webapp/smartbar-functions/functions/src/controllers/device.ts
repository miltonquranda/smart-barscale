import * as jwt from 'jsonwebtoken';
import { db } from '../firebase';
import BaseCtrl from './base';
import { DEMO_DEVICE_SERIALS } from './demo';

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

  getBySerial = async (req, res) => {
    try {
      const serial = req.params.serialNumber;
      const snapshot = await db.collection(this.collectionName).where('serialNumber', '==', serial).limit(1).get();
      if (snapshot.empty) return res.status(404).json({ error: 'Device not found' });

      const doc = snapshot.docs[0];
      const device: any = { _id: doc.id, ...doc.data() };

      if (device.business) {
        const bizDoc = await db.collection('businesses').doc(device.business).get();
        if (bizDoc.exists) device.business = { _id: bizDoc.id, ...bizDoc.data() };
      }

      res.status(200).json(device);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  assignBusiness = async (req, res) => {
    try {
      const serial = req.params.serialNumber;
      const { businessId } = req.body;
      if (!businessId) return res.status(400).json({ error: 'businessId is required' });

      const snapshot = await db.collection(this.collectionName).where('serialNumber', '==', serial).limit(1).get();
      if (snapshot.empty) return res.status(404).json({ error: 'Device not found' });

      const doc = snapshot.docs[0];
      const device: any = { _id: doc.id, ...doc.data() };

      // Only allow assignment if device has no business yet
      if (device.business) {
        const bizDoc = await db.collection('businesses').doc(device.business).get();
        const bizName = bizDoc.exists ? bizDoc.data().name : device.business;
        return res.status(403).json({ error: `Device already assigned to ${bizName}. Contact admin to reassign.` });
      }

      // Verify business exists
      const bizDoc = await db.collection('businesses').doc(businessId).get();
      if (!bizDoc.exists) return res.status(404).json({ error: 'Business not found' });

      await db.collection(this.collectionName).doc(doc.id).update({ business: businessId });

      res.status(200).json({
        _id: doc.id,
        ...doc.data(),
        business: { _id: bizDoc.id, ...bizDoc.data() }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  login = async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).where('serialNumber', '==', req.body.serialNumber).limit(1).get();
      if (snapshot.empty) {
        // Auto-register device
        const newDeviceRef = await db.collection(this.collectionName).add({
          serialNumber: req.body.serialNumber,
          createdAt: new Date(),
          status: 'online',
          ...(DEMO_DEVICE_SERIALS.includes(req.body.serialNumber) ? { business: 'demo-bar', demo: true } : {}),
        });
        const isDemo = DEMO_DEVICE_SERIALS.includes(req.body.serialNumber);
        const token = jwt.sign({ serialNumber: { _id: newDeviceRef.id, serialNumber: req.body.serialNumber, business: isDemo ? 'demo-bar' : undefined, demo: isDemo } }, process.env.SECRET_TOKEN as string);
        return res.status(200).json({ token: token });
      }
      const doc = snapshot.docs[0];
      const device: any = { _id: doc.id, ...doc.data() };

      if (DEMO_DEVICE_SERIALS.includes(req.body.serialNumber) && device.business !== 'demo-bar') {
        await doc.ref.update({ business: 'demo-bar', demo: true, status: 'online' });
        device.business = 'demo-bar';
        device.demo = true;
      }

      if (device.business) {
        const bizDoc = await db.collection('businesses').doc(device.business).get();
        if (bizDoc.exists) device.business = { _id: bizDoc.id, ...bizDoc.data() };
      }

      const token = jwt.sign({ serialNumber: device }, process.env.SECRET_TOKEN as string);
      res.status(200).json({ token: token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
}
