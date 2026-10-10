// Admin SDK handles shared by every function. Initialised once per instance.
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { STORAGE_BUCKET } from "@solving-food/core";

const app = getApps()[0] ?? initializeApp();

export const db = getFirestore(app);
// Optional recipe fields are left out rather than written as undefined.
db.settings({ ignoreUndefinedProperties: true });
export const storage = getStorage(app);
export const bucket = () => storage.bucket(STORAGE_BUCKET);
