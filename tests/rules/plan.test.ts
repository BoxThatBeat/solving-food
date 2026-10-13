// M2 rules (Planning/M2 "Tests → Rules"): saved meals are global (public get, allowlisted CRUD); periods, plan items,
// stores, sourcing rules, brand mappings, and grocery lists are member-only; the first period and the default stores
// are written in the household's creation batch.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, increment, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from "firebase/firestore";

const rules = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
let env: RulesTestEnvironment;

const ALICE = { uid: "alice", email: "alice@example.com" };
const BOB = { uid: "bob", email: "bob@example.com" };
const EVE = { uid: "eve", email: "eve@example.com" }; // not allowlisted

const dbAs = (u: { uid: string; email: string }) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

async function seed(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

function household(createdBy: string, extra: Record<string, unknown> = {}) {
  return {
    name: "Silbrass Pvt",
    createdBy,
    periodDays: 7,
    budgetCents: 20000,
    currency: "CAD",
    timezone: "America/Toronto",
    defaultServings: 4,
    plannedMealTypes: ["breakfast", "lunch", "dinner"],
    pcxStoreId: "loblaws-greenbank-road",
    currentPeriodId: "2026-10-05",
    defaultStoreId: "pc-express",
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} },
    ...extra,
  };
}

const period = { start: Timestamp.fromMillis(Date.parse("2026-10-05T04:00:00Z")), end: Timestamp.fromMillis(Date.parse("2026-10-12T04:00:00Z")), budgetCents: 20000 };

function planItem(extra: Record<string, unknown> = {}) {
  return {
    periodId: "2026-10-05",
    kind: "meal",
    mealType: "dinner",
    servings: 4,
    recipes: [{ recipeId: "r1", servingsMultiplier: 1 }],
    coverage: { dinner: 1 },
    status: "planned",
    addedBy: ALICE.uid,
    addedAt: serverTimestamp(),
    ...extra,
  };
}

const meal = (uid: string, extra: Record<string, unknown> = {}) => ({
  name: "Taco night",
  recipes: [{ recipeId: "r1", servingsMultiplier: 1 }, { recipeId: "r2", servingsMultiplier: 1 }],
  createdBy: uid,
  updatedBy: uid,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

const groceryItem = { ingredientId: "tomato", amount: 796, measure: "g", packs: 1, productName: "Tomatoes", storeId: "pc-express", estPriceCents: 299, source: "plan", checked: false };

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
      await setDoc(doc(db, "users", u.uid), { email: u.email, activeHouseholdId: null, householdsCreated: 1, theme: { flavour: "latte", accent: "green" } });
      await setDoc(doc(db, "households", `h-${u.uid}`), household(u.uid));
      await setDoc(doc(db, "households", `h-${u.uid}`, "members", u.uid), { uid: u.uid, displayName: u.uid, joinedAt: new Date() });
    }
  });
});

describe("household creation writes the first period and default stores (Planning/M2 §1, §5)", () => {
  it("one batch: household, member, counter, period, stores", async () => {
    const db = dbAs(ALICE);
    const b = writeBatch(db);
    b.set(doc(db, "households", "new"), { ...household(ALICE.uid), createdAt: serverTimestamp() });
    b.set(doc(db, "households", "new", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: serverTimestamp() });
    b.update(doc(db, "users", ALICE.uid), { householdsCreated: increment(1), activeHouseholdId: "new" });
    b.set(doc(db, "households", "new", "periods", "2026-10-05"), period);
    b.set(doc(db, "households", "new", "stores", "pc-express"), { name: "PC Express", kind: "pcExpress", bulk: false });
    b.set(doc(db, "households", "new", "stores", "costco"), { name: "Costco", kind: "inStore", bulk: true });
    await assertSucceeds(b.commit());
  });

  it("nobody else can add periods or stores to a household they aren't in", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households", "h-alice", "periods", "x"), period));
    await assertFails(setDoc(doc(dbAs(BOB), "households", "h-alice", "stores", "x"), { name: "S", kind: "inStore", bulk: false }));
  });
});

describe("household collections are member-only (R2.8)", () => {
  const paths = ["periods/p", "planItems/i", "stores/s", "sourcingRules/r", "brandMappings/tomato", "groceryLists/draft"];
  it("members read; others and signed-out visitors don't", async () => {
    await seed(async (db) => {
      for (const p of paths) await setDoc(doc(db, `households/h-alice/${p}`), { x: 1 });
    });
    for (const p of paths) {
      await assertSucceeds(getDoc(doc(dbAs(ALICE), `households/h-alice/${p}`)));
      await assertFails(getDoc(doc(dbAs(BOB), `households/h-alice/${p}`)));
      await assertFails(getDoc(doc(dbAs(EVE), `households/h-alice/${p}`)));
      await assertFails(getDoc(doc(anon(), `households/h-alice/${p}`)));
    }
    await assertSucceeds(getDocs(collection(dbAs(ALICE), "households", "h-alice", "planItems")));
    await assertFails(getDocs(collection(dbAs(BOB), "households", "h-alice", "planItems")));
  });

  it("periods: valid shape only", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "households/h-alice/periods/2026-10-12"), period));
    await assertFails(setDoc(doc(db, "households/h-alice/periods/bad"), { ...period, end: period.start }));
    await assertFails(setDoc(doc(db, "households/h-alice/periods/bad"), { ...period, budgetCents: -1 }));
    await assertFails(setDoc(doc(db, "households/h-alice/periods/bad"), { ...period, extra: true }));
  });

  it("plan items: members add, edit, remove; cooking states are left to commands (M3)", async () => {
    const db = dbAs(ALICE);
    const ref = doc(db, "households/h-alice/planItems/i1");
    await assertSucceeds(setDoc(ref, planItem({ savedMealId: "m1", name: "Taco night" })));
    await assertSucceeds(updateDoc(ref, { servings: 6, mealType: "lunch", coverage: { lunch: 1 } }));
    await assertFails(updateDoc(ref, { status: "cooked" }));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/i2"), planItem({ status: "cooked" })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/i3"), planItem({ recipes: [] })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/i4"), planItem({ mealType: "brunch" })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/i5"), planItem({ coverage: { snack: 1 } })));
    await assertFails(setDoc(doc(dbAs(BOB), "households/h-alice/planItems/i6"), planItem()));
    await assertSucceeds(deleteDoc(ref));
  });

  it("plan items with sides (R5.9): meals only, at most 12; household side settings", async () => {
    const db = dbAs(ALICE);
    const fries = { ingredientId: "fries", portion: 150 };
    await assertSucceeds(setDoc(doc(db, "households/h-alice/planItems/s1"), planItem({ sides: [fries] })));
    await assertSucceeds(updateDoc(doc(db, "households/h-alice/planItems/s1"), { sides: [fries, { ingredientId: "peas", portion: 80 }] }));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/s2"), planItem({ sides: Array.from({ length: 13 }, () => fries) })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/s3"), planItem({ kind: "leftover", recipes: [], sides: [fries] })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/s4"), planItem({ sides: "fries" })));
    await assertSucceeds(updateDoc(doc(db, "households/h-alice"), { "settings.sides": { fries: { portion: 200 } } }));
  });

  it("eating out (M9, R6.23): no recipes, no sides", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "households/h-alice/planItems/o1"), planItem({ kind: "out", recipes: [], servings: 1, name: "Pizza night" })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/o2"), planItem({ kind: "out" })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/o3"), planItem({ kind: "out", recipes: [], sides: [{ ingredientId: "fries", portion: 150 }] })));
    await assertFails(setDoc(doc(db, "households/h-alice/planItems/o4"), planItem({ kind: "takeaway", recipes: [] })));
  });

  it("stores, sourcing rules, brand mappings", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "households/h-alice/stores/farm"), { name: "Farmers' market", kind: "inStore", bulk: false }));
    await assertFails(setDoc(doc(db, "households/h-alice/stores/bad"), { name: "X", kind: "online", bulk: false }));
    await assertSucceeds(setDoc(doc(db, "households/h-alice/sourcingRules/r1"), { match: { category: "meat" }, storeId: "costco" }));
    await assertSucceeds(setDoc(doc(db, "households/h-alice/sourcingRules/r2"), { match: { ingredientId: "spinach" }, storeId: "costco" }));
    await assertFails(setDoc(doc(db, "households/h-alice/sourcingRules/r3"), { match: { category: "meat", ingredientId: "x" }, storeId: "costco" }));
    await assertSucceeds(setDoc(doc(db, "households/h-alice/brandMappings/tomato"), { productName: "Mutti Polpa", packAmount: 400, packMeasure: "weight", storeId: "pc-express", updatedBy: ALICE.uid, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "households/h-alice/brandMappings/milk"), { productName: "Milk", packAmount: 0, packMeasure: "volume", storeId: "pc-express" }));
    await assertFails(setDoc(doc(dbAs(BOB), "households/h-alice/stores/x"), { name: "X", kind: "inStore", bulk: false }));
  });

  it("grocery lists: draft, ticks, ordered with who and when; received is for the command function (M3)", async () => {
    const db = dbAs(ALICE);
    const ref = doc(db, "households/h-alice/groceryLists/draft");
    await assertSucceeds(setDoc(ref, { periodId: "2026-10-05", status: "draft", createdAt: serverTimestamp(), items: { tomato: groceryItem } }));
    await assertSucceeds(updateDoc(ref, { "items.tomato.checked": true, "items.tomato.checkedBy": ALICE.uid }));
    // M10 (R7.12): a removed staple is remembered on the draft until a time.
    await assertSucceeds(updateDoc(ref, { "dismissedStaples.milk": Date.now() + 86_400_000 }));
    await assertFails(updateDoc(ref, { dismissedStaples: "milk" }));
    await assertFails(updateDoc(ref, { somethingElse: 1 }));
    const ordered = doc(db, "households/h-alice/groceryLists/o1");
    await assertFails(setDoc(ordered, { periodId: "2026-10-05", status: "ordered", createdAt: serverTimestamp(), items: {} }));
    await assertSucceeds(setDoc(ordered, { periodId: "2026-10-05", status: "ordered", createdAt: serverTimestamp(), orderedAt: serverTimestamp(), orderedBy: ALICE.uid, items: { tomato: groceryItem } }));
    await assertFails(updateDoc(ordered, { status: "received" }));
    await assertSucceeds(deleteDoc(ordered)); // Undo
  });

  it("members change the current period and default store on the household", async () => {
    await assertSucceeds(updateDoc(doc(dbAs(ALICE), "households/h-alice"), { currentPeriodId: "2026-10-12", defaultStoreId: "costco" }));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/h-alice"), { defaultStoreId: "" }));
  });
});

describe("saved meals (R5.2): global, public get for share links", () => {
  it("allowlisted users create, list, edit, delete; anyone with the link reads one", async () => {
    const ref = doc(dbAs(ALICE), "meals/m1");
    await assertSucceeds(setDoc(ref, meal(ALICE.uid)));
    await assertSucceeds(getDoc(doc(anon(), "meals/m1")));
    await assertFails(getDocs(collection(anon(), "meals")));
    await assertSucceeds(getDocs(collection(dbAs(BOB), "meals")));
    await assertSucceeds(updateDoc(doc(dbAs(BOB), "meals/m1"), { name: "Taco Tuesday", updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbAs(BOB), "meals/m1"), { createdBy: BOB.uid, updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbAs(BOB), "meals/m1"), { recipes: [], updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(doc(dbAs(BOB), "meals/m1")));
  });
  it("meals keep sides (R5.9): at most 12", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "meals/s1"), meal(ALICE.uid, { sides: [{ ingredientId: "fries", portion: 150 }] })));
    await assertFails(setDoc(doc(dbAs(ALICE), "meals/s2"), meal(ALICE.uid, { sides: Array.from({ length: 13 }, () => ({ ingredientId: "fries", portion: 1 })) })));
  });
  it("rejects bad meals and non-allowlisted writers", async () => {
    await assertFails(setDoc(doc(dbAs(ALICE), "meals/m2"), meal(BOB.uid)));
    await assertFails(setDoc(doc(dbAs(ALICE), "meals/m3"), meal(ALICE.uid, { name: "" })));
    await assertFails(setDoc(doc(dbAs(ALICE), "meals/m4"), meal(ALICE.uid, { recipes: [] })));
    await assertFails(setDoc(doc(dbAs(EVE), "meals/m5"), meal(EVE.uid)));
  });
});
