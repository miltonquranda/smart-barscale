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
exports.bucket = exports.db = void 0;
const admin = __importStar(require("firebase-admin"));
const STORAGE_BUCKET = 'smartbar-7418f.firebasestorage.app';
// Force emulator connection
const projectId = process.env.FUNCTIONS_EMULATOR ? 'demo-project' : undefined;
if (projectId) {
    admin.initializeApp({ projectId, storageBucket: STORAGE_BUCKET });
}
else {
    admin.initializeApp({ storageBucket: STORAGE_BUCKET });
}
exports.db = admin.firestore();
exports.bucket = admin.storage().bucket();
//# sourceMappingURL=firebase.js.map