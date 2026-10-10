// Emulator-only demo data for local development and visual checks: allowlists the owner and dev@example.com, creates
// dev@example.com in the Auth emulator with a profile and the "Silbrass Pvt" household, uploads the ingredient seed,
// and imports the 28 household recipes through the drop folder. Sign in at /sign-in as dev@example.com (the link is in
// the Auth emulator: http://127.0.0.1:4000/auth or GET /emulator/v1/projects/solvingfood/oobCodes).
//
//   pnpm dev:seed      (with the emulators running: `pnpm emulators` or `pnpm dev`)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
process.env.GCLOUD_PROJECT ??= "solvingfood";

const { getApps, initializeApp } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { FieldValue, getFirestore } = await import("firebase-admin/firestore");
const app = getApps()[0] ?? initializeApp({ projectId: "solvingfood" });
const db = getFirestore(app);
const auth = getAuth(app);
const root = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });

const EMAIL = "dev@example.com";
for (const e of ["buitenwerfa@gmail.com", EMAIL]) await db.doc(`allowlist/${e}`).set({ addedBy: "dev-seed", addedAt: FieldValue.serverTimestamp() });

let uid: string;
try {
  uid = (await auth.getUserByEmail(EMAIL)).uid;
} catch {
  uid = (await auth.createUser({ email: EMAIL, emailVerified: true, displayName: "Dev" })).uid;
}
if (!(await db.doc(`users/${uid}`).get()).exists) {
  const hid = db.collection("households").doc().id;
  await db.doc(`directory/${uid}`).set({ displayName: "Dev", displayNameLower: "dev" });
  await db.doc(`households/${hid}`).set({
    name: "Silbrass Pvt",
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
  await db.doc(`households/${hid}/members/${uid}`).set({ uid, displayName: "Dev", joinedAt: FieldValue.serverTimestamp() });
  await db.doc(`users/${uid}`).set({ email: EMAIL, activeHouseholdId: hid, householdsCreated: 1, theme: { flavour: "latte", accent: "green" }, createdAt: FieldValue.serverTimestamp() });
}
console.log(`dev user ${EMAIL} = ${uid}`);

run("npx", ["tsx", "data/scripts/upload.ts", "--emulator"]);
const existing = await db.collection("recipes").limit(1).get();
if (existing.empty) run("npx", ["tsx", "scripts/drop-recipes.ts", "--emulator", "--uid", uid]);
else console.log("recipes already present; skipping the drop");

// `pnpm dev:seed -- --supply`: demo supply for visual checks (M3): fresh, use-soon, expired, frozen, and multi-purchase
// lots, plus a leftover batch. Written directly (emulator only); the app's own changes go through commands.
if (process.argv.includes("--supply")) {
  const { Timestamp } = await import("firebase-admin/firestore");
  const hid = (await db.doc(`users/${uid}`).get()).data()!.activeHouseholdId as string;
  const DAY = 86_400_000;
  const now = Date.now();
  const t = (days: number) => Timestamp.fromMillis(now + days * DAY);
  const lot = (lotId: string, amount: number, location: string, boughtDaysAgo: number, expiresIn: number | null, extra: Record<string, unknown> = {}) => ({
    lotId,
    amount,
    location,
    acquiredAt: t(-boughtDaysAgo),
    ...(expiresIn === null ? {} : { expiresFresh: t(expiresIn) }),
    ...extra,
  });
  const items: Array<[string, string, string, Array<Record<string, unknown>>]> = [
    ["baby-spinach", "baby spinach", "g", [lot("d1", 140, "fridge", 3, 2)]],
    ["salmon-fillet", "salmon fillet", "g", [lot("d2", 640, "fridge", 2, 2)]],
    ["fresh-cilantro", "fresh cilantro", "g", [lot("d3", 30, "fridge", 9, -1)]],
    ["broccoli", "broccoli", "g", [lot("d4", 450, "fridge", 1, 4)]],
    ["egg", "egg", "count", [lot("d5", 300, "fridge", 10, 6), lot("d6", 600, "fridge", 2, 20)]],
    ["jasmine-rice", "jasmine rice", "g", [lot("d7", 3200, "pantry", 30, 300)]],
    ["pork-shoulder", "pork shoulder", "g", [lot("d8", 1200, "freezer", 60, -50, { frozenAt: t(-58), expiresFrozen: t(150) })]],
    ["dried-red-lentil", "dried red lentil", "g", [lot("d9", 900, "pantry", 40, null)]],
  ];
  const batch = db.batch();
  for (const [id, label, unit, lots] of items) {
    const ing = await db.doc(`ingredients/${id}`).get();
    if (!ing.exists) continue;
    const amount = lots.reduce((s, l) => s + (l.amount as number), 0);
    batch.set(db.doc(`households/${hid}/supply/${id}`), { ingredientId: id, label, canonicalUnit: ing.data()!.canonicalUnit ?? unit, canonicalAmount: amount, lots, nextExpiry: null });
    batch.set(db.doc(`households/${hid}/supply/${id}/transactions/seed`), { delta: amount, kind: "purchase", lotId: lots[0]!.lotId, uid, note: "demo", createdAt: FieldValue.serverTimestamp() });
  }
  batch.set(db.doc(`households/${hid}/supply/leftover_demo`), { label: "Chicken tikka traybake", canonicalUnit: "count", canonicalAmount: 2, lots: [lot("demo", 2, "fridge", 1, 3)], cookEventId: "demo", leftoverMealType: "lunch" });
  batch.set(db.doc(`households/${hid}/cadence/olive-oil`), { avgIntervalDays: 30, lastPurchasedAt: t(-12), purchaseCount: 3 });
  await batch.commit();
  console.log(`demo supply written to households/${hid}`);
}
