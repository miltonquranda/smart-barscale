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
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Force project ID for this migration
const PROJECT_ID = 'smartbar-7418f';
const STORAGE_BUCKET = 'smartbar-7418f.firebasestorage.app';
if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: PROJECT_ID,
        storageBucket: STORAGE_BUCKET
    });
}
const db = admin.firestore();
const COLLECTION_BOTTLES = 'bottles';
const COLLECTION_CATEGORIES = 'categories';
async function importCatalog() {
    try {
        const jsonPath = path.join(process.cwd(), '../../cleaned_catalog.json');
        console.log(`Reading catalog from ${jsonPath}...`);
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const { categories, products } = data;
        // 1. Process Categories
        console.log(`Importing ${categories.length} categories...`);
        const categoryMap = new Map(); // path -> id
        // Sort categories by level (inferred by path depth) to import parents first
        const sortedCats = categories.sort((a, b) => a.path.split(' > ').length - b.path.split(' > ').length);
        for (const cat of sortedCats) {
            const pathStr = cat.path;
            const parentPath = cat.parent_name;
            const parentId = parentPath ? categoryMap.get(parentPath) : null;
            // Check if exists
            const existing = await db.collection(COLLECTION_CATEGORIES)
                .where('path', '==', pathStr)
                .limit(1)
                .get();
            if (!existing.empty) {
                categoryMap.set(pathStr, existing.docs[0].id);
                console.log(`Found existing category: ${pathStr}`);
            }
            else {
                const level = pathStr.split(' > ').length;
                const newCat = {
                    name: cat.name,
                    parent: parentId || null,
                    level,
                    path: pathStr
                };
                const ref = await db.collection(COLLECTION_CATEGORIES).add(newCat);
                categoryMap.set(pathStr, ref.id);
                console.log(`Created category: ${pathStr}`);
            }
        }
        // 2. Process Products (in batches of 500)
        console.log(`Importing ${products.length} products...`);
        const BATCH_SIZE = 500;
        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            const chunk = products.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            for (const p of chunk) {
                const catId = categoryMap.get(p.category_path) || null;
                const barcode = p.barcode || `NO_BARCODE_${Math.random()}`;
                const productData = {
                    name: p.name,
                    brand: p.brand,
                    category: catId,
                    quantity: p.quantity,
                    cost_per_bottle: p.cost_per_bottle,
                    barcode: barcode,
                    country_of_origin: p.country_of_origin,
                    source: p.source,
                    last_updated: admin.firestore.Timestamp.now()
                };
                // Upsert logic (lookup by barcode)
                // Note: WriteBatch doesn't support "where" queries. 
                // We'll use doc IDs if we can, but since we don't know them, 
                // we'll use the barcode as the doc ID for these imported ones 
                // to make it easier, OR query first. 
                // Given the volume, using barcode as doc ID is safest for bulk import.
                const docRef = db.collection(COLLECTION_BOTTLES).doc(barcode);
                batch.set(docRef, productData, { merge: true });
            }
            await batch.commit();
            console.log(`Committed batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(products.length / BATCH_SIZE)}`);
        }
        console.log('Import completed successfully.');
    }
    catch (error) {
        console.error('Import failed:', error);
    }
}
importCatalog();
//# sourceMappingURL=import_catalog.js.map