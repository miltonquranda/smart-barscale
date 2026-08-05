import { db, bucket } from '../firebase';
import * as admin from 'firebase-admin';
import BaseCtrl from './base';
import { lookupProduct } from '../productLookup';
import DemoCtrl from './demo';

const demoCtrl = new DemoCtrl();

export default class BottleCtrl extends BaseCtrl {
  collectionName = 'bottles';

  /**
   * Return a bounded catalog page. The legacy /bottles endpoint intentionally
   * remains unchanged for older clients; the Products page uses this cursor
   * endpoint so a large catalog is never transferred in one response.
   */
  getPage = async (req, res) => {
    try {
      const requested = Number.parseInt(String(req.query.limit || '25'), 10);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 25, 1), 50);
      const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim()
        ? req.query.cursor.trim()
        : null;

      let query: FirebaseFirestore.Query = db.collection(this.collectionName)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit + 1);
      if (cursor) query = query.startAfter(cursor);

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const pageDocs = snapshot.docs.slice(0, limit);
      const products = pageDocs.map(doc => ({ _id: doc.id, ...doc.data() }));

      res.status(200).json({
        products,
        nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : null,
        hasMore,
        limit,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  getByBarcode = async (req, res) => {
    try {
      const barcode = req.params.barcode;
      if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

      const result = await lookupProduct(barcode);
      if (result) {
        const product: any = { ...result.product };
        if (product.category) {
          const categoryDoc = await db.collection('categories').doc(product.category).get();
          if (categoryDoc.exists) {
            const category = categoryDoc.data() || {};
            product.category_name = category.path || category.name || null;
          }
        }
        res.status(200).json({ _id: result.bottleId, ...product, fromCache: result.fromCache });
      } else {
        res.status(404).json({ error: 'Product not found' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  upsertByBarcode = async (req, res) => {
    try {
      const barcode = req.params.barcode;
      if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

      const { name, brand, description, category, image_url, quantity,
              weight, pour_price, pour_volume_ml, country_of_origin, ingredients, nutrition_per_100,
              bottle_full_weight_g, bottle_empty_weight_g, bottle_volume_ml,
              cost_per_bottle, par_level } = req.body;

      if (!name) return res.status(400).json({ error: 'Product name is required' });

      const nutrition = nutrition_per_100 ? {
        energy_kj: nutrition_per_100.energy_kj ?? null,
        fat_g: nutrition_per_100.fat_g ?? null,
        saturated_fat_g: nutrition_per_100.saturated_fat_g ?? null,
        carbohydrates_g: nutrition_per_100.carbohydrates_g ?? null,
        sugars_g: nutrition_per_100.sugars_g ?? null,
        proteins_g: nutrition_per_100.proteins_g ?? null,
        salt_g: nutrition_per_100.salt_g ?? null,
        fiber_g: nutrition_per_100.fiber_g ?? null,
      } : null;

      // Categories are stored as document IDs. Resolve legacy clients that
      // still send a path/name, and never persist an invalid category value.
      let categoryId: string | null = null;
      if (typeof category === 'string' && category.trim()) {
        const candidate = category.trim();
        const byId = await db.collection('categories').doc(candidate).get();
        if (byId.exists) {
          categoryId = byId.id;
        } else {
          const byPath = await db.collection('categories').where('path', '==', candidate).limit(1).get();
          if (!byPath.empty) categoryId = byPath.docs[0].id;
          else {
            const byName = await db.collection('categories').where('name', '==', candidate).limit(1).get();
            if (!byName.empty) categoryId = byName.docs[0].id;
          }
        }
      }

      // Physical specs. Without full weight, empty weight and volume the
      // inventory engine cannot convert a scale reading into a liquid volume,
      // so every derived figure — on-hand value, consumption, pour cost —
      // silently comes out zero. These used to be dropped from the payload
      // entirely, which is why real-data dashboards rendered empty.
      const spec = (value: any) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const fullWeight = spec(bottle_full_weight_g);
      const emptyWeight = spec(bottle_empty_weight_g);
      const volumeMl = spec(bottle_volume_ml);

      // A bottle cannot weigh less full than empty. Catching it here beats
      // discovering it as a negative pour on the dashboard.
      if (fullWeight !== null && emptyWeight !== null && fullWeight > 0 && emptyWeight > 0
          && fullWeight <= emptyWeight) {
        return res.status(400).json({
          error: 'bottle_full_weight_g must be greater than bottle_empty_weight_g.',
        });
      }

      const productData: any = {
        barcode,
        name,
        brand: brand || null,
        description: description || null,
        category: categoryId,
        image_url: image_url || null,
        quantity: quantity || null,
        weight: weight || null,
        pour_price: Number.isFinite(Number(pour_price)) ? Number(pour_price) : null,
        pour_volume_ml: Number.isFinite(Number(pour_volume_ml)) ? Number(pour_volume_ml) : null,
        country_of_origin: country_of_origin || null,
        ingredients: ingredients || null,
        nutrition_per_100: nutrition,
        bottle_full_weight_g: fullWeight,
        bottle_empty_weight_g: emptyWeight,
        bottle_volume_ml: volumeMl,
        cost_per_bottle: spec(cost_per_bottle),
        par_level: spec(par_level),
        source: 'manual',
        last_updated: admin.firestore.Timestamp.now(),
      };

      const snapshot = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();

      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        // Don't let a client that omits the spec fields (an older mobile build,
        // say) wipe specs that were already set. Only overwrite what was sent.
        const existing = snapshot.docs[0].data();
        for (const key of ['bottle_full_weight_g', 'bottle_empty_weight_g', 'bottle_volume_ml', 'cost_per_bottle', 'par_level']) {
          if (productData[key] === null && existing[key] != null) productData[key] = existing[key];
        }
        await db.collection('bottles').doc(docId).update(productData);
        // Only resolve pending demo scans when the caller is actually working
        // on a demo device. This previously ran for every product save in
        // every tenant, writing into the demo collections unconditionally.
        if (req.device?.demo === true) await demoCtrl.claimUnknownScan(barcode, docId);
        res.status(200).json({ _id: docId, ...productData, updated: true });
      } else {
        const ref = await db.collection('bottles').add(productData);
        if (req.device?.demo === true) await demoCtrl.claimUnknownScan(barcode, ref.id);
        res.status(201).json({ _id: ref.id, ...productData, created: true });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  uploadImage = async (req, res) => {
    try {
      const barcode = req.params.barcode;
      if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

      const { image, contentType } = req.body;
      if (!image) return res.status(400).json({ error: 'Base64 image data is required' });

      const mime = contentType || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const fileName = `product-images/${barcode}_${Date.now()}.${ext}`;

      const buffer = Buffer.from(image, 'base64');
      const file = bucket.file(fileName);
      await file.save(buffer, {
        metadata: { contentType: mime, cacheControl: 'public, max-age=31536000' },
      });
      await file.makePublic();

      const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      // Update the bottle document if it exists
      const snapshot = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
      if (!snapshot.empty) {
        await db.collection('bottles').doc(snapshot.docs[0].id).update({
          image_url: imageUrl,
          last_updated: admin.firestore.Timestamp.now(),
        });
      }

      res.status(200).json({ image_url: imageUrl });
    } catch (err) {
      console.error('Image upload error:', err);
      res.status(500).json({ error: err.message });
    }
  };

  getAllInBusiness = async (req, res) => {
    try {
      const canAccessBusiness = req.user.business.some(
        biz => "" + biz._id === req.params.businessId
      );
      if (canAccessBusiness) {
        const snapshot = await db.collection('bottle-stats')
          .where('business', '==', req.params.businessId)
          .get();

        const bottleIds = new Set();
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.bottle) bottleIds.add(data.bottle);
        });

        const bottles = {};
        await Promise.all(Array.from(bottleIds).map(async (id: string) => {
          const bDoc = await db.collection('bottles').doc(id).get();
          if (bDoc.exists) {
            bottles[bDoc.id] = { _id: bDoc.id, ...bDoc.data() };
          }
        }));

        res.status(200).json(bottles);
      } else {
        res.status(400).json({ message: "not authorized to access that resource" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}
