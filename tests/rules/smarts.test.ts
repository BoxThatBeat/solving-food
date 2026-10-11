// M5 rules (Planning/M5 "Data & rules introduced"): prices are readable by allowlisted users and written by functions
// only; the snoozeCadence command; dismissed expiry alerts on the period; preferences, weights, protein goals, and the
// PC Express store on the household; the PC Express session and rate-limit docs are function-only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, Timestamp, type Firestore } from "firebase/firestore";

const rules = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
let env: RulesTestEnvironment;

const ALICE = { uid: "alice", email: "alice@example.com" };
const BOB = { uid: "bob", email: "bob@example.com" };

const dbAs = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore() as unknown as Firestore;

async function seed(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

const household = (uid: string) => ({ name: "H", createdBy: uid, periodDays: 7, budgetCents: 100, currency: "CAD", timezone: "America/Toronto", defaultServings: 4, plannedMealTypes: ["dinner"], pcxStoreId: "loblaws-greenbank-road", settings: {} });

const cmd = (type: string, payload: Record<string, unknown>, uid = ALICE.uid, extra: Record<string, unknown> = {}) => ({ type, payload, uid, createdAt: serverTimestamp(), status: "pending", ...extra });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "solvingfood", firestore: { rules, host: host ?? "127.0.0.1", port: Number(port ?? 8080) } });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    for (const e of [ALICE.email, BOB.email]) await setDoc(doc(db, "allowlist", e), { addedBy: "seed", addedAt: new Date() });
    for (const u of [ALICE, BOB]) {
      await setDoc(doc(db, "users", u.uid), { email: u.email, activeHouseholdId: `h-${u.uid}`, householdsCreated: 1, theme: { flavour: "latte", accent: "green" } });
      await setDoc(doc(db, "households", `h-${u.uid}`), household(u.uid));
      await setDoc(doc(db, "households", `h-${u.uid}`, "members", u.uid), { uid: u.uid, displayName: u.uid, joinedAt: new Date() });
    }
    await setDoc(doc(db, "prices/S1_p1"), { productName: "Mutti", priceCents: 349, packAmount: 400, packMeasure: "weight", pcxStoreId: "S1", productCode: "p1", fetchedAt: new Date() });
    await setDoc(doc(db, "pcxSession/state"), { token: "secret-ish" });
    await setDoc(doc(db, "households/h-alice/periods/2026-10-10"), { start: Timestamp.fromMillis(1), end: Timestamp.fromMillis(2), budgetCents: 100 });
  });
});

describe("prices (§8)", () => {
  it("allowlisted users read and query prices; nobody writes them", async () => {
    await assertSucceeds(getDoc(doc(dbAs(BOB), "prices/S1_p1")));
    await assertSucceeds(getDocs(query(collection(dbAs(ALICE), "prices"), where("pcxStoreId", "==", "S1"))));
    await assertFails(setDoc(doc(dbAs(ALICE), "prices/S1_p1"), { priceCents: 1 }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, "prices/S1_p1")));
  });
  it("the PC Express session and rate-limit docs are function-only", async () => {
    await assertFails(getDoc(doc(dbAs(ALICE), "pcxSession/state")));
    await assertFails(setDoc(doc(dbAs(ALICE), "pcxRate/alice"), { count: 0 }));
    await assertFails(getDoc(doc(dbAs(ALICE), "_stubPcx/config")));
  });
});

describe("snoozeCadence (R7.7)", () => {
  it("a member snoozes a staple with a command; the cadence doc itself stays function-only", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/h-alice/commands/s1"), cmd("snoozeCadence", { ingredientId: "milk", until: 123 })));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/h-alice/commands/s2"), cmd("snoozeCadence", { ingredientId: "milk", until: 123, extra: 1 })));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/h-alice/cadence/milk"), { snoozedUntil: new Date() }));
  });
});

describe("household settings and dismissed alerts (M5)", () => {
  it("members save preferences, weights, protein goals, and the PC Express store", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(updateDoc(doc(db, "households/h-alice"), { "settings.preferences": { likes: ["cuisine:thai"], dislikes: [], diets: ["vegetarian"] } }));
    await assertSucceeds(updateDoc(doc(db, "households/h-alice"), { "settings.scoreWeights": { cost: 5 } }));
    await assertSucceeds(updateDoc(doc(db, "households/h-alice"), { "settings.proteinGoals": { dinner: 35 } }));
    await assertSucceeds(updateDoc(doc(db, "households/h-alice"), { pcxStoreId: "1032", pcxStoreName: "Loblaws Greenbank Road" }));
    await assertFails(updateDoc(doc(db, "households/h-alice"), { pcxStoreName: "x".repeat(121) }));
    await assertFails(updateDoc(doc(dbAs(BOB), "households/h-alice"), { "settings.scoreWeights": { cost: 5 } }));
  });
  it("members dismiss expiry alerts on the period; other fields stay closed", async () => {
    await assertSucceeds(updateDoc(doc(dbAs(ALICE), "households/h-alice/periods/2026-10-10"), { dismissedLots: arrayUnion("lot1") }));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/h-alice/periods/2026-10-10"), { note: "x" }));
    await assertFails(updateDoc(doc(dbAs(BOB), "households/h-alice/periods/2026-10-10"), { dismissedLots: ["lot1"] }));
  });
});
