import * as bcrypt from 'bcryptjs';
import { db } from '../firebase';

/** Platform-level provisioning and lifecycle operations. */
export default class PlatformCtrl {
  listBusinesses = async (_req, res) => {
    try {
      const [businesses, users, devices] = await Promise.all([
        db.collection('businesses').get(),
        db.collection('users').get(),
        db.collection('devices').get(),
      ]);
      const usersByBusiness: Record<string, number> = {};
      users.docs.forEach(doc => (doc.data().business || []).forEach((id: string) => { usersByBusiness[id] = (usersByBusiness[id] || 0) + 1; }));
      const devicesByBusiness: Record<string, number> = {};
      devices.docs.forEach(doc => { const id = doc.data().business; if (id) devicesByBusiness[id] = (devicesByBusiness[id] || 0) + 1; });
      res.json(businesses.docs.map(doc => ({
        _id: doc.id, ...doc.data(),
        status: doc.data().status || 'active',
        user_count: usersByBusiness[doc.id] || 0,
        device_count: devicesByBusiness[doc.id] || 0,
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  };

  onboardBusiness = async (req, res) => {
    try {
      const { businessName, zipCode, firstName, lastName, email, password } = req.body || {};
      if (!businessName || !firstName || !lastName || !email || !password) return res.status(400).json({ error: 'Business, owner name, email, and password are required.' });
      const existing = await db.collection('users').where('email', '==', email.trim().toLowerCase()).limit(1).get();
      if (!existing.empty) return res.status(409).json({ error: 'A user with that email already exists.' });
      const businessRef = await db.collection('businesses').add({ name: businessName.trim(), zipCode: zipCode || '', status: 'active', createdAt: new Date(), onboardingStatus: 'invited' });
      const hash = await bcrypt.hash(password, 10);
      const userRef = await db.collection('users').add({
        username: email.trim().toLowerCase(), email: email.trim().toLowerCase(), firstName, lastName,
        password: hash, role: 'business_admin', business: [businessRef.id], status: 'active', createdAt: new Date(),
      });
      const deviceRef = await db.collection('devices').add({ business: businessRef.id, type: 'scan-scale', status: 'unassigned', createdAt: new Date() });
      res.status(201).json({
        business: { _id: businessRef.id, name: businessName.trim(), zipCode: zipCode || '', status: 'active' },
        owner: { _id: userRef.id, email: email.trim().toLowerCase(), firstName, lastName, role: 'business_admin' },
        device: { _id: deviceRef.id, business: businessRef.id, status: 'unassigned' },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  };

  updateBusinessStatus = async (req, res) => {
    try {
      const status = req.body?.status;
      if (!['active', 'suspended', 'offboarded'].includes(status)) return res.status(400).json({ error: 'Invalid business status.' });
      const ref = db.collection('businesses').doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'Business not found.' });
      await ref.update({ status, updatedAt: new Date() });
      if (status !== 'active') {
        const users = await db.collection('users').where('business', 'array-contains', req.params.id).get();
        const batch = db.batch();
        users.docs.forEach(user => batch.update(user.ref, { status: status === 'offboarded' ? 'offboarded' : 'suspended' }));
        if (!users.empty) await batch.commit();
      }
      res.json({ _id: req.params.id, status });
    } catch (err) { res.status(500).json({ error: err.message }); }
  };

  /**
   * Mark a device as a demo unit, or clear that flag.
   *
   * Demo devices mirror their scans into the demo dataset for sales
   * demonstrations. This must be an explicit, auditable decision — inferring it
   * from the serial number is how a real pilot device ends up writing into demo
   * collections.
   */
  setDeviceDemo = async (req, res) => {
    try {
      const demo = req.body?.demo;
      if (typeof demo !== 'boolean') return res.status(400).json({ error: 'demo must be true or false.' });

      const ref = db.collection('devices').doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'Device not found.' });

      await ref.update({ demo, updatedAt: new Date() });
      res.json({ _id: doc.id, ...doc.data(), demo });
    } catch (err) { res.status(500).json({ error: err.message }); }
  };

  assignDevice = async (req, res) => {
    try {
      const { businessId } = req.body || {};
      const deviceRef = db.collection('devices').doc(req.params.id);
      const [device, business] = await Promise.all([deviceRef.get(), db.collection('businesses').doc(businessId).get()]);
      if (!device.exists) return res.status(404).json({ error: 'Device not found.' });
      if (!business.exists) return res.status(404).json({ error: 'Business not found.' });
      await deviceRef.update({ business: businessId, status: 'assigned', updatedAt: new Date() });
      res.json({ _id: device.id, ...device.data(), business: { _id: business.id, ...business.data() }, status: 'assigned' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  };
}
