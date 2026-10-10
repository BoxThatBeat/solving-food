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
