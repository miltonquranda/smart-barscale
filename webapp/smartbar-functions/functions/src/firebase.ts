import * as admin from 'firebase-admin';

const STORAGE_BUCKET = 'smartbar-7418f.firebasestorage.app';

// Force emulator connection
const projectId = process.env.FUNCTIONS_EMULATOR ? 'demo-project' : undefined;

if (projectId) {
    admin.initializeApp({ projectId, storageBucket: STORAGE_BUCKET });
} else {
    admin.initializeApp({ storageBucket: STORAGE_BUCKET });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
