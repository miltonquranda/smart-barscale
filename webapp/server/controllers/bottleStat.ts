import { db } from '../firebase';
import BaseCtrl from './base';
import axios from 'axios';
import * as moment from 'moment';

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
        // Note: Firestore string comparison for dates works if format is ISO8601
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
      const bSnapshot = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();

      if (!bSnapshot.empty) {
        const bottleId = bSnapshot.docs[0].id;
        req.body.bottle = bottleId;
        await this.addBottleStat({
          ...req.body,
          business: req.user ? req.user.business : req.device.business
        }, res);
      } else {
        try {
          const response = await axios.get(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
          if (response.data.items.length) {
            const newBottle = {
              barcode,
              name: response.data.items[0].title,
              brand: response.data.items[0].brand
            };
            const bRef = await db.collection('bottles').add(newBottle);
            req.body.bottle = bRef.id;
            await this.addBottleStat({
              ...req.body,
              business: req.user ? req.user.business : req.device.business
            }, res);
          } else {
            res.sendStatus(400);
          }
        } catch (apiErr) {
          const newBottle = {
            barcode,
            name: 'unknown',
            brand: 'unknown',
            business: req.body.business
          };
          const bRef = await db.collection('bottles').add(newBottle);
          req.body.bottle = bRef.id;
          await this.addBottleStat(req.body, res);
        }
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
      res.status(200).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}
