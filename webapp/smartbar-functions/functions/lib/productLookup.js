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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupProduct = lookupProduct;
const axios_1 = __importDefault(require("axios"));
const firebase_1 = require("./firebase");
const admin = __importStar(require("firebase-admin"));
const GEMINI_KEY = 'AIzaSyDOj7aSROml8Pk5eMndB3sXAN-rQ1aRX4M';
/**
 * Look up product by barcode in the trusted Firestore catalog only.
 * External enrichment is intentionally disabled until a verified barcode
 * provider is approved; guessed matches can put the wrong product in stock.
 */
async function lookupProduct(barcode) {
    // 1) Check Firestore cache
    const snapshot = await firebase_1.db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { product: Object.assign({ _id: doc.id }, doc.data()), bottleId: doc.id, fromCache: true };
    }
    return null;
}
function firstNonEmpty(...values) {
    for (const v of values) {
        if (v && v.trim())
            return v.trim();
    }
    return null;
}
function formatCategory(tags) {
    if (!tags || !tags.length)
        return null;
    return tags
        .filter(t => t.startsWith('en:'))
        .map(t => {
        const s = t.substring(3).replace(/-/g, ' ');
        return s.charAt(0).toUpperCase() + s.slice(1);
    })
        .slice(0, 3)
        .join(', ') || null;
}
async function fetchFromOpenFoodFacts(barcode) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const resp = await axios_1.default.get(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, { timeout: 10000 });
        if (((_a = resp.data) === null || _a === void 0 ? void 0 : _a.status) !== 1 || !((_b = resp.data) === null || _b === void 0 ? void 0 : _b.product))
            return null;
        const p = resp.data.product;
        const name = firstNonEmpty(p.product_name_en, p.product_name, p.generic_name_en);
        if (!name)
            return null;
        const n = p.nutriments || {};
        const qty = p.product_quantity;
        const qtyUnit = p.product_quantity_unit || 'g';
        return {
            barcode,
            name,
            brand: p.brands || null,
            description: null,
            category: formatCategory(p.categories_tags),
            image_url: p.image_front_url || p.image_url || null,
            quantity: p.quantity || null,
            weight: qty ? `${qty}${qtyUnit}` : null,
            country_of_origin: p.countries || null,
            ingredients: p.ingredients_text_en || p.ingredients_text || null,
            nutrition_per_100: {
                energy_kj: (_c = n['energy-kj_100g']) !== null && _c !== void 0 ? _c : null,
                fat_g: (_d = n['fat_100g']) !== null && _d !== void 0 ? _d : null,
                saturated_fat_g: (_e = n['saturated-fat_100g']) !== null && _e !== void 0 ? _e : null,
                carbohydrates_g: (_f = n['carbohydrates_100g']) !== null && _f !== void 0 ? _f : null,
                sugars_g: (_g = n['sugars_100g']) !== null && _g !== void 0 ? _g : null,
                proteins_g: (_h = n['proteins_100g']) !== null && _h !== void 0 ? _h : null,
                salt_g: (_j = n['salt_100g']) !== null && _j !== void 0 ? _j : null,
                fiber_g: (_k = n['fiber_100g']) !== null && _k !== void 0 ? _k : null,
            },
            source: 'openfoodfacts',
            last_updated: admin.firestore.Timestamp.now(),
        };
    }
    catch (e) {
        console.error('Open Food Facts lookup error:', e.message);
        return null;
    }
}
async function fetchFromGemini(barcode) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const resp = await axios_1.default.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{
                    parts: [{
                            text: `Look up the product with barcode ${barcode}. ` +
                                'Return a JSON object with: product_name, brand, description (1-2 sentences), ' +
                                'category, image_url (or null), quantity, weight (net weight or null), ' +
                                'country_of_origin (or null), ingredients (comma-separated or null), ' +
                                'nutrition_per_100 (object: energy_kj, fat_g, saturated_fat_g, carbohydrates_g, ' +
                                'sugars_g, proteins_g, salt_g, fiber_g). ' +
                                'If not found return {"product_name": null}.',
                        }]
                }],
            tools: [{ google_search: {} }],
        }, { timeout: 20000 });
        const candidates = (_a = resp.data) === null || _a === void 0 ? void 0 : _a.candidates;
        if (!(candidates === null || candidates === void 0 ? void 0 : candidates.length))
            return null;
        const parts = (_c = (_b = candidates[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts;
        if (!parts)
            return null;
        for (const part of parts) {
            const text = (_d = part.text) === null || _d === void 0 ? void 0 : _d.trim();
            if (!text)
                continue;
            const json = extractJson(text);
            if (!json)
                continue;
            const parsed = JSON.parse(json);
            if (!parsed.product_name)
                return null;
            const n = parsed.nutrition_per_100 || {};
            return {
                barcode,
                name: parsed.product_name,
                brand: parsed.brand || null,
                description: parsed.description || null,
                category: parsed.category || null,
                image_url: parsed.image_url || null,
                quantity: parsed.quantity || null,
                weight: parsed.weight || null,
                country_of_origin: parsed.country_of_origin || null,
                ingredients: parsed.ingredients || null,
                nutrition_per_100: {
                    energy_kj: (_e = n.energy_kj) !== null && _e !== void 0 ? _e : null,
                    fat_g: (_f = n.fat_g) !== null && _f !== void 0 ? _f : null,
                    saturated_fat_g: (_g = n.saturated_fat_g) !== null && _g !== void 0 ? _g : null,
                    carbohydrates_g: (_h = n.carbohydrates_g) !== null && _h !== void 0 ? _h : null,
                    sugars_g: (_j = n.sugars_g) !== null && _j !== void 0 ? _j : null,
                    proteins_g: (_k = n.proteins_g) !== null && _k !== void 0 ? _k : null,
                    salt_g: (_l = n.salt_g) !== null && _l !== void 0 ? _l : null,
                    fiber_g: (_m = n.fiber_g) !== null && _m !== void 0 ? _m : null,
                },
                source: 'gemini',
                last_updated: admin.firestore.Timestamp.now(),
            };
        }
        return null;
    }
    catch (e) {
        console.error('Gemini lookup error:', e.message);
        return null;
    }
}
function extractJson(text) {
    try {
        JSON.parse(text);
        return text;
    }
    catch (_) { }
    const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fence) {
        try {
            JSON.parse(fence[1]);
            return fence[1];
        }
        catch (_) { }
    }
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s >= 0 && e > s) {
        const c = text.substring(s, e + 1);
        try {
            JSON.parse(c);
            return c;
        }
        catch (_) { }
    }
    return null;
}
//# sourceMappingURL=productLookup.js.map