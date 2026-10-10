// Admin SDK against the emulators (never the live project): seeding and assertions about stored data.
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { AUTH_EMULATOR, FIRESTORE_EMULATOR, PROJECT_ID } from "./emulator";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR;

const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);

export async function allowlist(email: string): Promise<void> {
  await adminDb.doc(`allowlist/${email}`).set({ addedBy: "e2e", addedAt: FieldValue.serverTimestamp() });
}

export async function uidFor(email: string): Promise<string | null> {
  try {
    return (await adminAuth.getUserByEmail(email)).uid;
  } catch {
    return null;
  }
}

export interface SeededHousehold {
  hid: string;
  name: string;
}

/** Creates users/{uid} + directory/{uid} directly (bypassing the welcome page). */
export async function seedProfile(
  uid: string,
  email: string,
  displayName: string,
  opts: { theme?: { flavour: string; accent: string }; householdsCreated?: number } = {},
): Promise<void> {
  await adminDb.doc(`users/${uid}`).set({
    email,
    activeHouseholdId: null,
    householdsCreated: opts.householdsCreated ?? 0,
    theme: opts.theme ?? { flavour: "latte", accent: "green" },
    createdAt: FieldValue.serverTimestamp(),
  });
  await adminDb.doc(`directory/${uid}`).set({ displayName, displayNameLower: displayName.toLowerCase() });
}

/** Creates a household with `uid` as creator and member, and makes it their active one. */
export async function seedHousehold(uid: string, displayName: string, name = "Silbrass Pvt"): Promise<SeededHousehold> {
  const ref = adminDb.collection("households").doc();
  await ref.set({
    name,
    createdBy: uid,
    periodDays: 7,
    budgetCents: 20000,
    currency: "CAD",
    timezone: "America/Toronto",
    defaultServings: 4,
    plannedMealTypes: ["breakfast", "lunch", "dinner"],
    pcxStoreId: "loblaws-greenbank-road",
    currentPeriodId: null,
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} },
    createdAt: FieldValue.serverTimestamp(),
  });
  await addMember(ref.id, uid, displayName);
  await adminDb.doc(`users/${uid}`).update({ householdsCreated: FieldValue.increment(1), activeHouseholdId: ref.id });
  return { hid: ref.id, name };
}

export async function addMember(hid: string, uid: string, displayName: string): Promise<void> {
  await adminDb.doc(`households/${hid}/members/${uid}`).set({ uid, displayName, joinedAt: FieldValue.serverTimestamp() });
}

/** Writes every document in a seed file: `{ "path/to/doc": { …fields } }`. `$NOW` strings become server timestamps. */
export async function loadSeed(docs: Record<string, Record<string, unknown>>, vars: Record<string, string> = {}): Promise<void> {
  const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
  const conv = (v: unknown): unknown => {
    if (v === "$NOW") return FieldValue.serverTimestamp();
    if (typeof v === "string") return sub(v);
    if (Array.isArray(v)) return v.map(conv);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
    return v;
  };
  const batch = adminDb.batch();
  for (const [path, data] of Object.entries(docs)) batch.set(adminDb.doc(sub(path)), conv(data) as Record<string, unknown>);
  await batch.commit();
}
