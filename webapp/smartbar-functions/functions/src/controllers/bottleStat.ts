import { db } from '../firebase';
import BaseCtrl from './base';
import { lookupProduct } from '../productLookup';
import InventoryCtrl from './inventory';
import DemoCtrl from './demo';

const inventoryCtrl = new InventoryCtrl();
const demoCtrl = new DemoCtrl();

export default class BottleStatCtrl extends BaseCtrl {
  collectionName = 'bottle-stats';

  getAll = async (req, res) => {
    try {
      const snapshot = await db.collection(this.collectionName).get();
      const docs = await Promise.all(snapshot.docs.map(async doc => {
        const data = doc.data();
        let bottle = null;
        let business = null;
        if (data.bottle) {
          const bDoc = await db.collection('bottles').doc(data.bottle).get();
          if (bDoc.exists) bottle = { _id: bDoc.id, ...bDoc.data() };
        }
        if (data.business) {
          const bizDoc = await db.collection('businesses').doc(data.business).get();
          if (bizDoc.exists) business = { _id: bizDoc.id, ...bizDoc.data() };
        }
        return { _id: doc.id, ...data, bottle, business };
      }));
      res.status(200).json(docs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  getAllInBusiness = async (req, res) => {
    try {
      if (!req.user) return res.status(403).json({ message: 'not authorized' });

      let query = db.collection(this.collectionName).where('business', '==', req.user.business[0]._id || req.user.business[0]);

      if (req.query.start && req.query.end) {
        query = query.where('date', '>', req.query.start).where('date', '<', req.query.end);
      }

      const snapshot = await query.get();
      const docs = await Promise.all(snapshot.docs.map(async doc => {
        const data = doc.data();
        let bottle = null;
        if (data.bottle) {
          const bDoc = await db.collection('bottles').doc(data.bottle).get();
          if (bDoc.exists) bottle = { _id: bDoc.id, ...bDoc.data() };
        }
        return { _id: doc.id, ...data, bottle };
      }));
      res.status(200).json(docs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  insert = async (req, res) => {
    const barcode = req.body.barcode;
    
    // Always use the server's current time for accuracy instead of the ESP32's uptime seconds
    req.body.date = new Date().toISOString();
    
    try {
      const result = await lookupProduct(barcode);

      if (result) {
        req.body.bottle = result.bottleId;
        const business = req.user
          ? (req.user.business?.[0]?._id || req.user.business?.[0] || null)
          : (req.device?.business || null);
        const stat: any = { ...req.body };
        if (business) stat.business = business;
        if (req.device?.demo || req.device?.business === 'demo-bar') {
          await demoCtrl.recordDeviceScan(barcode, parseFloat(req.body.weight) || 0, result.bottleId);
        }
        await this.addBottleStat(stat, res);
      } else {
        if (req.device?.demo || req.device?.business === 'demo-bar') {
          const scan = await demoCtrl.recordUnknownDeviceScan(barcode, parseFloat(req.body.weight) || 0);
          return res.status(201).json({ ...scan, message: 'Barcode recorded for Demo Bar; product needs to be added.' });
        }
        res.status(404).json({ error: 'Product not found for barcode: ' + barcode });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  addBottleStat = async (newStat, res) => {
    try {
      const ref = await db.collection(this.collectionName).add(newStat);
      const doc = await ref.get();
      const statData = { _id: doc.id, ...doc.data() };

      // Auto-create inventory reading from device scan
      if (newStat.business && newStat.barcode && newStat.weight != null) {
        try {
          await inventoryCtrl.createReading(
            newStat.business,
            newStat.barcode,
            parseFloat(newStat.weight) || 0,
            {
              product_id: newStat.bottle || undefined,
              device_id: newStat.device_id || undefined,
            }
          );
        } catch (invErr) {
          console.error('Inventory reading auto-create failed (non-blocking):', invErr);
        }
      }

      res.status(200).json(statData);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}
