"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../firebase");
const admin = __importStar(require("firebase-admin"));
const base_1 = __importDefault(require("./base"));
const productLookup_1 = require("../productLookup");
const demo_1 = __importDefault(require("./demo"));
const demoCtrl = new demo_1.default();
class BottleCtrl extends base_1.default {
    constructor() {
        super(...arguments);
        this.collectionName = 'bottles';
        this.getByBarcode = async (req, res) => {
            try {
                const barcode = req.params.barcode;
                if (!barcode)
                    return res.status(400).json({ error: 'Barcode is required' });
                const result = await (0, productLookup_1.lookupProduct)(barcode);
                if (result) {
                    const product = Object.assign({}, result.product);
                    if (product.category) {
                        const categoryDoc = await firebase_1.db.collection('categories').doc(product.category).get();
                        if (categoryDoc.exists) {
                            const category = categoryDoc.data() || {};
                            product.category_name = category.path || category.name || null;
                        }
                    }
                    res.status(200).json(Object.assign(Object.assign({ _id: result.bottleId }, product), { fromCache: result.fromCache }));
                }
                else {
                    res.status(404).json({ error: 'Product not found' });
                }
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.upsertByBarcode = async (req, res) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            try {
                const barcode = req.params.barcode;
                if (!barcode)
                    return res.status(400).json({ error: 'Barcode is required' });
                const { name, brand, description, category, image_url, quantity, weight, pour_price, pour_volume_ml, country_of_origin, ingredients, nutrition_per_100 } = req.body;
                if (!name)
                    return res.status(400).json({ error: 'Product name is required' });
                const nutrition = nutrition_per_100 ? {
                    energy_kj: (_a = nutrition_per_100.energy_kj) !== null && _a !== void 0 ? _a : null,
                    fat_g: (_b = nutrition_per_100.fat_g) !== null && _b !== void 0 ? _b : null,
                    saturated_fat_g: (_c = nutrition_per_100.saturated_fat_g) !== null && _c !== void 0 ? _c : null,
                    carbohydrates_g: (_d = nutrition_per_100.carbohydrates_g) !== null && _d !== void 0 ? _d : null,
                    sugars_g: (_e = nutrition_per_100.sugars_g) !== null && _e !== void 0 ? _e : null,
                    proteins_g: (_f = nutrition_per_100.proteins_g) !== null && _f !== void 0 ? _f : null,
                    salt_g: (_g = nutrition_per_100.salt_g) !== null && _g !== void 0 ? _g : null,
                    fiber_g: (_h = nutrition_per_100.fiber_g) !== null && _h !== void 0 ? _h : null,
                } : null;
                // Categories are stored as document IDs. Resolve legacy clients that
                // still send a path/name, and never persist an invalid category value.
                let categoryId = null;
                if (typeof category === 'string' && category.trim()) {
                    const candidate = category.trim();
                    const byId = await firebase_1.db.collection('categories').doc(candidate).get();
                    if (byId.exists) {
                        categoryId = byId.id;
                    }
                    else {
                        const byPath = await firebase_1.db.collection('categories').where('path', '==', candidate).limit(1).get();
                        if (!byPath.empty)
                            categoryId = byPath.docs[0].id;
                        else {
                            const byName = await firebase_1.db.collection('categories').where('name', '==', candidate).limit(1).get();
                            if (!byName.empty)
                                categoryId = byName.docs[0].id;
                        }
                    }
                }
                const productData = {
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
                    source: 'manual',
                    last_updated: admin.firestore.Timestamp.now(),
                };
                const snapshot = await firebase_1.db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
                if (!snapshot.empty) {
                    const docId = snapshot.docs[0].id;
                    await firebase_1.db.collection('bottles').doc(docId).update(productData);
                    await demoCtrl.claimUnknownScan(barcode, docId);
                    res.status(200).json(Object.assign(Object.assign({ _id: docId }, productData), { updated: true }));
                }
                else {
                    const ref = await firebase_1.db.collection('bottles').add(productData);
                    await demoCtrl.claimUnknownScan(barcode, ref.id);
                    res.status(201).json(Object.assign(Object.assign({ _id: ref.id }, productData), { created: true }));
                }
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.uploadImage = async (req, res) => {
            try {
                const barcode = req.params.barcode;
                if (!barcode)
                    return res.status(400).json({ error: 'Barcode is required' });
                const { image, contentType } = req.body;
                if (!image)
                    return res.status(400).json({ error: 'Base64 image data is required' });
                const mime = contentType || 'image/jpeg';
                const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
                const fileName = `product-images/${barcode}_${Date.now()}.${ext}`;
                const buffer = Buffer.from(image, 'base64');
                const file = firebase_1.bucket.file(fileName);
                await file.save(buffer, {
                    metadata: { contentType: mime, cacheControl: 'public, max-age=31536000' },
                });
                await file.makePublic();
                const imageUrl = `https://storage.googleapis.com/${firebase_1.bucket.name}/${fileName}`;
                // Update the bottle document if it exists
                const snapshot = await firebase_1.db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
                if (!snapshot.empty) {
                    await firebase_1.db.collection('bottles').doc(snapshot.docs[0].id).update({
                        image_url: imageUrl,
                        last_updated: admin.firestore.Timestamp.now(),
                    });
                }
                res.status(200).json({ image_url: imageUrl });
            }
            catch (err) {
                console.error('Image upload error:', err);
                res.status(500).json({ error: err.message });
            }
        };
        this.getAllInBusiness = async (req, res) => {
            try {
                const canAccessBusiness = req.user.business.some(biz => "" + biz._id === req.params.businessId);
                if (canAccessBusiness) {
                    const snapshot = await firebase_1.db.collection('bottle-stats')
                        .where('business', '==', req.params.businessId)
                        .get();
                    const bottleIds = new Set();
                    snapshot.docs.forEach(doc => {
                        const data = doc.data();
                        if (data.bottle)
                            bottleIds.add(data.bottle);
                    });
                    const bottles = {};
                    await Promise.all(Array.from(bottleIds).map(async (id) => {
                        const bDoc = await firebase_1.db.collection('bottles').doc(id).get();
                        if (bDoc.exists) {
                            bottles[bDoc.id] = Object.assign({ _id: bDoc.id }, bDoc.data());
                        }
                    }));
                    res.status(200).json(bottles);
                }
                else {
                    res.status(400).json({ message: "not authorized to access that resource" });
                }
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
    }
}
exports.default = BottleCtrl;
//# sourceMappingURL=bottle.js.map