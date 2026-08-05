import { db } from '../firebase';
import BaseCtrl from './base';
import { signDeviceToken } from '../auth';

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
      const serialNumber = String(req.body.serialNumber || '').trim();
      if (!serialNumber) return res.status(400).json({ error: 'serialNumber is required' });

      const snapshot = await db.collection(this.collectionName)
        .where('serialNumber', '==', serialNumber).limit(1).get();

      if (snapshot.empty) {
        // Auto-register on first contact. A device starts unassigned; a human
        // attaches it to a business from the mobile app or platform admin.
        // Demo status is a property of the device record, never inferred from
        // the serial number.
        const ref = await db.collection(this.collectionName).add({
          serialNumber,
          createdAt: new Date(),
          status: 'online',
          demo: false,
          lastSeenAt: new Date(),
        });
        return res.status(200).json({ token: signDeviceToken({ _id: ref.id, serialNumber }) });
      }

      const doc = snapshot.docs[0];
      const device: any = { _id: doc.id, ...doc.data() };

      await doc.ref.update({ status: 'online', lastSeenAt: new Date() });

      res.status(200).json({ token: signDeviceToken(device) });
    } catch (err) {
      console.error('Device login failed:', err);
      res.status(500).json({ error: err.message });
    }
  }
}
