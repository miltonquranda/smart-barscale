import axios from 'axios';
import { db } from './firebase';
import * as admin from 'firebase-admin';

// Server-side only. Never expose this to the web or mobile clients — barcode
// enrichment must stay behind the API so the key is not shipped in a bundle.
//
// Read lazily: `dotenv.config()` runs in index.ts *after* the import graph is
// evaluated, so a module-level read would always see undefined.
const geminiKey = () => process.env.GEMINI_API_KEY || '';

export interface ProductData {
  barcode: string;
  name: string;
  brand: string | null;
  description: string | null;
  category: string | null;
  image_url: string | null;
  quantity: string | null;
  weight: string | null;
  pour_price?: number | null;
  pour_volume_ml?: number | null;
  country_of_origin: string | null;
  ingredients: string | null;
  nutrition_per_100: {
    energy_kj: number | null;
    fat_g: number | null;
    saturated_fat_g: number | null;
    carbohydrates_g: number | null;
    sugars_g: number | null;
    proteins_g: number | null;
    salt_g: number | null;
    fiber_g: number | null;
  } | null;
  source: 'openfoodfacts' | 'gemini' | 'manual';
  last_updated: admin.firestore.Timestamp;
}

/**
 * Look up product by barcode in the trusted Firestore catalog only.
 * External enrichment is intentionally disabled until a verified barcode
 * provider is approved; guessed matches can put the wrong product in stock.
 */
export async function lookupProduct(barcode: string): Promise<{ product: ProductData; bottleId: string; fromCache: boolean } | null> {
  // 1) Check Firestore cache
  const snapshot = await db.collection('bottles').where('barcode', '==', barcode).limit(1).get();
  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    return { product: { _id: doc.id, ...doc.data() } as any, bottleId: doc.id, fromCache: true };
  }

  return null;
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function formatCategory(tags: string[] | undefined): string | null {
  if (!tags || !tags.length) return null;
  return tags
    .filter(t => t.startsWith('en:'))
    .map(t => {
      const s = t.substring(3).replace(/-/g, ' ');
      return s.charAt(0).toUpperCase() + s.slice(1);
    })
    .slice(0, 3)
    .join(', ') || null;
}

async function fetchFromOpenFoodFacts(barcode: string): Promise<ProductData | null> {
  try {
    const resp = await axios.get(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, { timeout: 10000 });
    if (resp.data?.status !== 1 || !resp.data?.product) return null;

    const p = resp.data.product;
    const name = firstNonEmpty(p.product_name_en, p.product_name, p.generic_name_en);
    if (!name) return null;

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
        energy_kj: n['energy-kj_100g'] ?? null,
        fat_g: n['fat_100g'] ?? null,
        saturated_fat_g: n['saturated-fat_100g'] ?? null,
        carbohydrates_g: n['carbohydrates_100g'] ?? null,
        sugars_g: n['sugars_100g'] ?? null,
        proteins_g: n['proteins_100g'] ?? null,
        salt_g: n['salt_100g'] ?? null,
        fiber_g: n['fiber_100g'] ?? null,
      },
      source: 'openfoodfacts',
      last_updated: admin.firestore.Timestamp.now(),
    };
  } catch (e) {
    console.error('Open Food Facts lookup error:', e.message);
    return null;
  }
}

async function fetchFromGemini(barcode: string): Promise<ProductData | null> {
  const key = geminiKey();
  if (!key) {
    console.error('Gemini lookup skipped: GEMINI_API_KEY is not configured.');
    return null;
  }
  try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        contents: [{
          parts: [{
            text:
              `Look up the product with barcode ${barcode}. ` +
              'Return a JSON object with: product_name, brand, description (1-2 sentences), ' +
              'category, image_url (or null), quantity, weight (net weight or null), ' +
              'country_of_origin (or null), ingredients (comma-separated or null), ' +
              'nutrition_per_100 (object: energy_kj, fat_g, saturated_fat_g, carbohydrates_g, ' +
              'sugars_g, proteins_g, salt_g, fiber_g). ' +
              'If not found return {"product_name": null}.',
          }]
        }],
        tools: [{ google_search: {} }],
      },
      { timeout: 20000 }
    );

    const candidates = resp.data?.candidates;
    if (!candidates?.length) return null;

    const parts = candidates[0]?.content?.parts;
    if (!parts) return null;

    for (const part of parts) {
      const text = part.text?.trim();
      if (!text) continue;
      const json = extractJson(text);
      if (!json) continue;

      const parsed = JSON.parse(json);
      if (!parsed.product_name) return null;

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
          energy_kj: n.energy_kj ?? null,
          fat_g: n.fat_g ?? null,
          saturated_fat_g: n.saturated_fat_g ?? null,
          carbohydrates_g: n.carbohydrates_g ?? null,
          sugars_g: n.sugars_g ?? null,
          proteins_g: n.proteins_g ?? null,
          salt_g: n.salt_g ?? null,
          fiber_g: n.fiber_g ?? null,
        },
        source: 'gemini',
        last_updated: admin.firestore.Timestamp.now(),
      };
    }
    return null;
  } catch (e) {
    console.error('Gemini lookup error:', e.message);
    return null;
  }
}

function extractJson(text: string): string | null {
  try { JSON.parse(text); return text; } catch (_) {}

  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) {
    try { JSON.parse(fence[1]); return fence[1]; } catch (_) {}
  }

  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    const c = text.substring(s, e + 1);
    try { JSON.parse(c); return c; } catch (_) {}
  }
  return null;
}
