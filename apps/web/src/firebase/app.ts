import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { EMULATORS, firebaseConfig } from "./config";

export const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline: persistent cache shared across tabs (TECHNICAL_SPECS §12 "Offline").
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // E2E builds only (VITE_FIRESTORE_LONG_POLLING): Playwright's Linux WebKit stalls the Listen stream to the
  // emulator, so the e2e build forces long polling. Production keeps the SDK's automatic detection.
  ...(import.meta.env.VITE_FIRESTORE_LONG_POLLING === "true" ? { experimentalForceLongPolling: true } : {}),
});

export const storage = getStorage(app);

/**
 * Public URL of a Storage object. Recipe images are publicly readable (storage.rules), so no download token or
 * extra round trip is needed: the URL is built directly and the service worker can cache it.
 */
export function publicUrl(path: string): string {
  const origin = useEmulators ? `http://${EMULATORS.host}:${EMULATORS.storage}` : "https://firebasestorage.googleapis.com";
  return `${origin}/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
}

if (useEmulators) {
  connectAuthEmulator(auth, `http://${EMULATORS.host}:${EMULATORS.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATORS.host, EMULATORS.firestore);
  connectStorageEmulator(storage, EMULATORS.host, EMULATORS.storage);

  // E2E hook (emulator builds only; the branch is compiled out of production): lets specs make direct Firestore
  // calls from the page, e.g. to prove the rules refuse a 4th household (R2.3) or another household's data (NFR4).
  void import("firebase/firestore").then((fs) => {
    (window as unknown as { __sfTest: unknown }).__sfTest = { db, auth, fs, storage };
  });
}
