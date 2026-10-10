// M3 rules (Planning/M3 "Tests → Rules"): function-only collections (supply, transactions, stats, cookEvents, ratings,
// cadence) are readable by members and writable by nobody; commands are created by a member as themselves, pending,
// with a known type and that type's payload keys; nobody edits or deletes a command; device tokens are private;
// received grocery lists are history.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from "firebase/firestore";

const rules = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
let env: RulesTestEnvironment;

const ALICE = { uid: "alice", email: "alice@example.com" };
const BOB = { uid: "bob", email: "bob@example.com" };

const dbAs = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore() as unknown as Firestore;

async function seed(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

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
      await setDoc(doc(db, "households", `h-${u.uid}`), { name: "H", createdBy: u.uid });
      await setDoc(doc(db, "households", `h-${u.uid}`, "members", u.uid), { uid: u.uid, displayName: u.uid, joinedAt: new Date() });
    }
    await setDoc(doc(db, "households/h-alice/supply/rice"), { ingredientId: "rice", label: "rice", canonicalAmount: 500, canonicalUnit: "g", lots: [] });
    await setDoc(doc(db, "households/h-alice/supply/rice/transactions/t1"), { delta: 500, kind: "purchase", lotId: "l1", uid: "alice", createdAt: new Date() });
    await setDoc(doc(db, "households/h-alice/cookEvents/e1"), { recipeIds: [], titles: [], cookedBy: "alice", cookedAt: new Date(), used: [], leftoverPortions: 0, reviewStatus: "pending", ratedBy: [] });
    await setDoc(doc(db, "households/h-alice/groceryLists/old"), { periodId: "p", status: "received", createdAt: new Date(), items: {} });
    await setDoc(doc(db, "households/h-alice/commands/c0"), cmd("addSupply", { ingredientId: "rice", amount: 1, location: "pantry" }, "alice", { createdAt: new Date() }));
  });
});

describe("function-only collections (§10)", () => {
  it("members read supply, its transactions, cook events, ratings, stats, cadence", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(getDoc(doc(db, "households/h-alice/supply/rice")));
    await assertSucceeds(getDoc(doc(db, "households/h-alice/supply/rice/transactions/t1")));
    await assertSucceeds(getDoc(doc(db, "households/h-alice/cookEvents/e1")));
    await assertSucceeds(getDoc(doc(db, "households/h-alice/ratings/x")));
    await assertSucceeds(getDoc(doc(db, "households/h-alice/cadence/milk")));
  });
  it("nobody outside the household reads them (NFR4)", async () => {
    await assertFails(getDoc(doc(dbAs(BOB), "households/h-alice/supply/rice")));
    await assertFails(getDoc(doc(dbAs(BOB), "households/h-alice/cookEvents/e1")));
  });
  it("clients never write them, not even members", async () => {
    const db = dbAs(ALICE);
    await assertFails(setDoc(doc(db, "households/h-alice/supply/rice"), { ingredientId: "rice", label: "rice", canonicalAmount: 9999, canonicalUnit: "g", lots: [] }));
    await assertFails(updateDoc(doc(db, "households/h-alice/supply/rice"), { canonicalAmount: 1 }));
    await assertFails(setDoc(doc(db, "households/h-alice/supply/rice/transactions/t2"), { delta: 1 }));
    await assertFails(setDoc(doc(db, "households/h-alice/stats/recipe_r1"), { timesCooked: 99, ratingSum: 0, ratingCount: 0 }));
    await assertFails(setDoc(doc(db, "households/h-alice/cookEvents/e2"), { recipeIds: [] }));
    await assertFails(setDoc(doc(db, "households/h-alice/ratings/r1"), { uid: "alice", score: 10 }));
    await assertFails(setDoc(doc(db, "households/h-alice/cadence/milk"), { avgIntervalDays: 1 }));
    await assertFails(deleteDoc(doc(db, "households/h-alice/supply/rice")));
  });
});

describe("commands (§6, validCommand)", () => {
  it("a member creates a pending command as themselves", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/h-alice/commands/c1"), cmd("addSupply", { ingredientId: "rice", amount: 500, location: "pantry" })));
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/h-alice/commands/c2"), cmd("finishCooking", { cookEventId: "e9", planItemId: "p1", recipes: [{ recipeId: "r", servingsMultiplier: 1 }], servings: 4 })));
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/h-alice/commands/c3"), cmd("submitReview", { cookEventId: "e1", ratings: [], used: [], leftoverPortions: 2 })));
  });
  it("refuses another uid, a non-pending status, unknown types, extra payload keys, extra fields, or a client time", async () => {
    const db = dbAs(ALICE);
    await assertFails(setDoc(doc(db, "households/h-alice/commands/x1"), cmd("addSupply", { ingredientId: "rice", amount: 1, location: "pantry" }, BOB.uid)));
    await assertFails(setDoc(doc(db, "households/h-alice/commands/x2"), cmd("addSupply", { ingredientId: "rice", amount: 1, location: "pantry" }, ALICE.uid, { status: "applied" })));
    await assertFails(setDoc(doc(db, "households/h-alice/commands/x3"), cmd("setSupply", { ingredientId: "rice" })));
    await assertFails(setDoc(doc(db, "households/h-alice/commands/x4"), cmd("addSupply", { ingredientId: "rice", amount: 1, location: "pantry", canonicalAmount: 9 })));
    await assertFails(setDoc(doc(db, "households/h-alice/commands/x5"), cmd("discard", { supplyId: "rice", lotId: "l1" }, ALICE.uid, { error: "" })));
    await assertFails(setDoc(doc(db, "households/h-alice/commands/x6"), cmd("discard", { supplyId: "rice", lotId: "l1" }, ALICE.uid, { createdAt: new Date(0) })));
  });
  it("outsiders can't command another household; nobody edits or deletes commands", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households/h-alice/commands/x7"), cmd("addSupply", { ingredientId: "rice", amount: 1, location: "pantry" }, BOB.uid)));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/h-alice/commands/c0"), { status: "applied" }));
    await assertFails(deleteDoc(doc(dbAs(ALICE), "households/h-alice/commands/c0")));
    await assertSucceeds(getDoc(doc(dbAs(ALICE), "households/h-alice/commands/c0")));
  });
});

describe("devices, timers, received lists", () => {
  it("device tokens are the user's own", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "users/alice/devices/tok"), { platform: "web", createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() }));
    await assertFails(setDoc(doc(dbAs(BOB), "users/alice/devices/tok2"), { platform: "web", createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() }));
    await assertFails(getDoc(doc(dbAs(BOB), "users/alice/devices/tok")));
    await assertSucceeds(getDoc(doc(dbAs(ALICE), "users/alice/timers/t")));
    await assertFails(setDoc(doc(dbAs(ALICE), "users/alice/timers/t"), { endsAt: 1 }));
  });
  it("a received list can't be edited or deleted, and clients can't mark one received", async () => {
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/h-alice/groceryLists/old"), { status: "draft" }));
    await assertFails(deleteDoc(doc(dbAs(ALICE), "households/h-alice/groceryLists/old")));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/h-alice/groceryLists/new"), { periodId: "p", status: "received", createdAt: serverTimestamp(), items: {} }));
  });
});
