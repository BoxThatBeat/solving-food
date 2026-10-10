// Tests run inside `firebase emulators:exec` (functions, firestore, storage). Modules under src/ are imported directly
// for the pieces that are plain functions (maintenance, notify); triggers are exercised by writing to the emulators.
process.env.GCLOUD_PROJECT ??= "solvingfood";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: "solvingfood", storageBucket: "solvingfood.firebasestorage.app" });
