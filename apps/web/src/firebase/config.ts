// Firebase web config for the `solvingfood` project (SETUP.md). Public by design; the gate is security rules.
export const firebaseConfig = {
  projectId: "solvingfood",
  appId: "1:28493041173:web:e0cc9aa85b861f4eb2481c",
  storageBucket: "solvingfood.firebasestorage.app",
  apiKey: "AIzaSyC90WnDVuO6zvN1wfW9WC1tPWZAr1OXDpI",
  authDomain: "solvingfood.firebaseapp.com",
  messagingSenderId: "28493041173",
  measurementId: "G-KNNS6VLVNB",
} as const;

/** Emulator Suite ports (firebase.json). */
export const EMULATORS = {
  host: "127.0.0.1",
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001,
} as const;
