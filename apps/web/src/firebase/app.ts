import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { EMULATORS, firebaseConfig } from "./config";

export const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline: persistent cache shared across tabs (TECHNICAL_SPECS §12 "Offline").
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulators) {
  connectAuthEmulator(auth, `http://${EMULATORS.host}:${EMULATORS.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATORS.host, EMULATORS.firestore);
  // Storage and Functions clients connect to their emulators where M1+ first create them.
}
