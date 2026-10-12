// M1 rules (Planning/M1 "Tests → Rules"): recipes public get / allowlisted list; version bump enforced; versions
// create matches; hard delete only for pendingDuplicateReview; ingredients; notes/favourites per household;
// notifications private; the index is function-only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

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

function recipe(uid: string, extra: Record<string, unknown> = {}) {
  return {
    title: "Baked Feta Pasta",
    slug: "baked-feta-pasta",
    servings: 6,
    prepMin: 5,
    cookMin: 35,
    cuisine: "mediterranean",
    mainProtein: "dairy",
    tags: ["dinner"],
    tools: ["oven"],
    ingredients: [{ id: "l1", ingredientId: "feta", amount: 8, measure: "oz", canonicalAmount: 227, displayText: "feta", optional: false }],
    steps: [{ text: "Bake {{ing:l1}}.", ingredientRefs: ["l1"] }],
    prepTasks: [],
    defaultLeftoverPortions: 2,
    fingerprint: "abc123",
    ingredientIds: ["feta"],
    imagePaths: [],
    status: "active",
    createdBy: uid,
    updatedBy: uid,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

/** The client's save batch: the recipe plus its version snapshot. */
function saveBatch(db: Firestore, id: string, data: Record<string, unknown>, uid: string, opts: { snapshot?: number | null; merge?: boolean } = {}) {
  const b = writeBatch(db);
  if (opts.merge) b.set(doc(db, "recipes", id), data, { merge: true });
  else b.set(doc(db, "recipes", id), data);
  const v = opts.snapshot === undefined ? (data.version as number) : opts.snapshot;
  // The snapshot is the whole recipe; deleteField() sentinels only make sense in the merge.
  const snapshot = Object.fromEntries(Object.entries(data).filter(([, x]) => (x as { _methodName?: string } | null)?._methodName !== "deleteField"));
  if (v !== null) b.set(doc(db, "recipes", id, "versions", String(v)), { ...snapshot, editedBy: uid, editedAt: serverTimestamp() });
  return b;
}

async function existingRecipe(id: string, extra: Record<string, unknown> = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, "recipes", id), { ...recipe(ALICE.uid), createdAt: new Date(1000), updatedAt: new Date(1000), indexChunk: 0, ...extra });
  });
}

const now = () => ({ updatedAt: serverTimestamp() });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "solvingfood", firestore: { rules, host: host ?? "127.0.0.1", port: Number(port ?? 8080) } });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    for (const e of [ALICE.email, BOB.email]) await setDoc(doc(db, "allowlist", e), { addedBy: "seed", addedAt: new Date() });
  });
});

describe("recipes: reading (R4.21, R2.9)", () => {
  beforeEach(() => existingRecipe("r1"));

  it("anyone can get a single recipe, even signed out (share links)", async () => {
    await assertSucceeds(getDoc(doc(anon(), "recipes", "r1")));
    await assertSucceeds(getDoc(doc(dbAs(EVE), "recipes", "r1")));
  });

  it("only allowlisted users can list or query", async () => {
    await assertSucceeds(getDocs(collection(dbAs(ALICE), "recipes")));
    await assertSucceeds(getDocs(query(collection(dbAs(ALICE), "recipes"), where("status", "==", "trashed"))));
    await assertFails(getDocs(collection(anon(), "recipes")));
    await assertFails(getDocs(collection(dbAs(EVE), "recipes")));
  });

  it("versions are readable by allowlisted users only", async () => {
    await seed(async (db) => setDoc(doc(db, "recipes", "r1", "versions", "1"), { title: "x" }));
    await assertSucceeds(getDoc(doc(dbAs(BOB), "recipes", "r1", "versions", "1")));
    await assertFails(getDoc(doc(anon(), "recipes", "r1", "versions", "1")));
  });
});

describe("recipes: create", () => {
  it("version 1 with its snapshot, by an allowlisted user", async () => {
    await assertSucceeds(saveBatch(dbAs(ALICE), "r2", recipe(ALICE.uid), ALICE.uid).commit());
  });

  it("refuses: no snapshot, wrong version, someone else as creator, non-allowlisted, invalid fields", async () => {
    const db = dbAs(ALICE);
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid), ALICE.uid, { snapshot: null }).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { version: 2 }), ALICE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(BOB.uid, { updatedBy: ALICE.uid }), ALICE.uid).commit());
    await assertFails(saveBatch(dbAs(EVE), "r2", recipe(EVE.uid), EVE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { cuisine: "martian" }), ALICE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { mainProtein: "vegetarian" }), ALICE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { title: "" }), ALICE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { owner: "me" }), ALICE.uid).commit());
  });

  it("clients can't assign the index chunk or create pending/trashed recipes", async () => {
    const db = dbAs(ALICE);
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { indexChunk: 0 }), ALICE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { status: "pendingDuplicateReview" }), ALICE.uid).commit());
    await assertFails(saveBatch(db, "r2", recipe(ALICE.uid, { status: "trashed", trashedAt: serverTimestamp(), trashedBy: ALICE.uid }), ALICE.uid).commit());
  });

  it("the snapshot's number must match the new version", async () => {
    const db = dbAs(ALICE);
    const b = writeBatch(db);
    b.set(doc(db, "recipes", "r2"), recipe(ALICE.uid));
    b.set(doc(db, "recipes", "r2", "versions", "1"), { ...recipe(ALICE.uid), editedBy: ALICE.uid, editedAt: serverTimestamp() });
    b.set(doc(db, "recipes", "r2", "versions", "2"), { ...recipe(ALICE.uid), editedBy: ALICE.uid, editedAt: serverTimestamp() });
    await assertFails(b.commit());
  });
});

describe("recipes: update and versioning (R4.19)", () => {
  beforeEach(() => existingRecipe("r1"));

  it("anyone allowlisted edits any recipe with version + 1 and a snapshot", async () => {
    await assertSucceeds(saveBatch(dbAs(BOB), "r1", { title: "Better Feta Pasta", version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
  });

  it("refuses: same version, skipped version, no snapshot, changed creator, changed index chunk", async () => {
    const db = dbAs(BOB);
    await assertFails(saveBatch(db, "r1", { title: "x", version: 1, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertFails(saveBatch(db, "r1", { title: "x", version: 3, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertFails(saveBatch(db, "r1", { title: "x", version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true, snapshot: null }).commit());
    await assertFails(saveBatch(db, "r1", { createdBy: BOB.uid, version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertFails(saveBatch(db, "r1", { indexChunk: 3, version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertFails(saveBatch(db, "r1", { title: "x", version: 2, updatedBy: ALICE.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertFails(updateDoc(doc(db, "recipes", "r1"), { title: "x" }));
  });

  it("trash stamps who and when (R4.26); restore clears them", async () => {
    const db = dbAs(BOB);
    await assertFails(saveBatch(db, "r1", { status: "trashed", version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertFails(
      saveBatch(db, "r1", { status: "trashed", trashedAt: serverTimestamp(), trashedBy: ALICE.uid, version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit(),
    );
    await assertSucceeds(
      saveBatch(db, "r1", { status: "trashed", trashedAt: serverTimestamp(), trashedBy: BOB.uid, version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit(),
    );
    // Restoring must drop the trash fields.
    await assertFails(saveBatch(db, "r1", { status: "active", version: 3, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await assertSucceeds(
      saveBatch(db, "r1", { status: "active", trashedAt: deleteField(), trashedBy: deleteField(), version: 3, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit(),
    );
  });

  it("clients can't put a recipe into duplicate review, but can resolve one (keep both)", async () => {
    await assertFails(saveBatch(dbAs(BOB), "r1", { status: "pendingDuplicateReview", version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
    await existingRecipe("imp", { status: "pendingDuplicateReview", possibleDuplicateOf: "r1" });
    await assertSucceeds(saveBatch(dbAs(BOB), "imp", { status: "active", possibleDuplicateOf: deleteField(), version: 2, updatedBy: BOB.uid, ...now() }, BOB.uid, { merge: true }).commit());
  });

  it("non-allowlisted users and signed-out visitors can't edit", async () => {
    await assertFails(saveBatch(dbAs(EVE), "r1", { title: "x", version: 2, updatedBy: EVE.uid, ...now() }, EVE.uid, { merge: true }).commit());
  });
});

describe("recipes: hard delete only for pendingDuplicateReview (§9)", () => {
  it("active and trashed recipes can't be deleted; a pending import can", async () => {
    await existingRecipe("a");
    await existingRecipe("t", { status: "trashed", trashedAt: new Date(), trashedBy: ALICE.uid });
    await existingRecipe("p", { status: "pendingDuplicateReview", possibleDuplicateOf: "a" });
    await assertFails(deleteDoc(doc(dbAs(ALICE), "recipes", "a")));
    await assertFails(deleteDoc(doc(dbAs(ALICE), "recipes", "t")));
    await assertFails(deleteDoc(doc(dbAs(EVE), "recipes", "p")));
    await assertSucceeds(deleteDoc(doc(dbAs(BOB), "recipes", "p")));
  });

  it("versions can't be deleted or rewritten by clients", async () => {
    await existingRecipe("a");
    await seed(async (db) => setDoc(doc(db, "recipes", "a", "versions", "1"), { title: "x" }));
    await assertFails(deleteDoc(doc(dbAs(ALICE), "recipes", "a", "versions", "1")));
    await assertFails(setDoc(doc(dbAs(ALICE), "recipes", "a", "versions", "1"), { title: "y", editedBy: ALICE.uid, editedAt: serverTimestamp() }));
  });
});

describe("recipeIndex (function-only writes)", () => {
  it("allowlisted users read; nobody writes", async () => {
    await seed(async (db) => setDoc(doc(db, "recipeIndex", "0"), { count: 0, recipes: {} }));
    await assertSucceeds(getDoc(doc(dbAs(ALICE), "recipeIndex", "0")));
    await assertFails(getDoc(doc(anon(), "recipeIndex", "0")));
    await assertFails(getDoc(doc(dbAs(EVE), "recipeIndex", "0")));
    await assertFails(setDoc(doc(dbAs(ALICE), "recipeIndex", "0"), { count: 1, recipes: {} }));
  });
});

describe("ingredients (§5, R8.3)", () => {
  const ing = (uid: string, extra: Record<string, unknown> = {}) => ({
    name: "smoked gouda",
    aliases: [],
    category: "dairy",
    defaultLocation: "fridge",
    allowedMeasures: ["weight"],
    canonicalUnit: "g",
    shelfLifeDays: { fridge: 30 },
    freezable: true,
    isStaple: false,
    freeUse: false,
    needsReview: true,
    createdBy: uid,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...extra,
  });
  beforeEach(async () => {
    await seed(async (db) => {
      const { createdBy: _c, updatedBy: _u, updatedAt: _a, ...seedDoc } = ing("x");
      await setDoc(doc(db, "ingredients", "garlic"), { ...seedDoc, name: "garlic" });
    });
  });

  it("public get, allowlisted list", async () => {
    await assertSucceeds(getDoc(doc(anon(), "ingredients", "garlic")));
    await assertSucceeds(getDocs(collection(dbAs(ALICE), "ingredients")));
    await assertFails(getDocs(collection(anon(), "ingredients")));
    await assertFails(getDocs(collection(dbAs(EVE), "ingredients")));
  });

  it("allowlisted users create and edit with valid fields", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "ingredients", "smoked-gouda"), ing(ALICE.uid)));
    await assertSucceeds(updateDoc(doc(dbAs(BOB), "ingredients", "garlic"), { unitWeightG: 5, allowedMeasures: ["weight", "count"], updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(dbAs(EVE), "ingredients", "x"), ing(EVE.uid)));
    await assertFails(setDoc(doc(dbAs(ALICE), "ingredients", "y"), ing(ALICE.uid, { allowedMeasures: ["handfuls"] })));
    await assertFails(setDoc(doc(dbAs(ALICE), "ingredients", "z"), ing(ALICE.uid, { densityGPerMl: -1 })));
    await assertFails(setDoc(doc(dbAs(ALICE), "ingredients", "w"), ing(BOB.uid, { updatedBy: ALICE.uid })));
    await assertFails(updateDoc(doc(dbAs(BOB), "ingredients", "garlic"), { createdBy: BOB.uid, updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(dbAs(ALICE), "ingredients", "garlic")));
    // Sides (R5.9): a positive portion only.
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "ingredients", "fries"), ing(ALICE.uid, { side: { portion: 150 } })));
    await assertFails(setDoc(doc(dbAs(ALICE), "ingredients", "fries2"), ing(ALICE.uid, { side: { portion: 0 } })));
    await assertFails(setDoc(doc(dbAs(ALICE), "ingredients", "fries3"), ing(ALICE.uid, { side: { portion: 150, extra: 1 } })));
    // M8: only the mergeIngredient function marks a merged duplicate; clients can't set or keep `mergedInto`.
    await assertFails(setDoc(doc(dbAs(ALICE), "ingredients", "dup"), ing(ALICE.uid, { mergedInto: "garlic" })));
    await assertFails(updateDoc(doc(dbAs(BOB), "ingredients", "garlic"), { mergedInto: "onion", updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await seed(async (db) => {
      const { createdBy: _c, updatedBy: _u, updatedAt: _a, ...plain } = ing("x");
      await setDoc(doc(db, "ingredients", "merged"), { ...plain, name: "merged", mergedInto: "garlic" });
    });
    await assertFails(updateDoc(doc(dbAs(ALICE), "ingredients", "merged"), { name: "revived", updatedBy: ALICE.uid, updatedAt: serverTimestamp() }));
  });
});

describe("favourites and notes are per household (R4.6, R4.8, R2.8)", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      for (const [hid, u] of [["hA", ALICE], ["hB", BOB]] as const) {
        await setDoc(doc(db, "households", hid), { name: hid, createdBy: u.uid });
        await setDoc(doc(db, "households", hid, "members", u.uid), { uid: u.uid, displayName: u.uid, joinedAt: new Date() });
      }
    });
  });

  it("members favourite and unfavourite; the key must match", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "households", "hA", "favourites", "recipe_r1"), { type: "recipe", targetId: "r1" }));
    await assertSucceeds(getDocs(collection(db, "households", "hA", "favourites")));
    await assertSucceeds(deleteDoc(doc(db, "households", "hA", "favourites", "recipe_r1")));
    await assertFails(setDoc(doc(db, "households", "hA", "favourites", "recipe_r2"), { type: "recipe", targetId: "r1" }));
    await assertFails(setDoc(doc(db, "households", "hA", "favourites", "plan_r1"), { type: "plan", targetId: "r1" }));
  });

  it("other households can't see or write them", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households", "hA", "favourites", "recipe_r1"), { type: "recipe", targetId: "r1" }));
    await assertFails(getDocs(collection(dbAs(BOB), "households", "hA", "favourites")));
    await assertFails(getDoc(doc(dbAs(BOB), "households", "hA", "notes", "r1")));
    await assertFails(getDoc(doc(anon(), "households", "hA", "notes", "r1")));
  });

  it("notes: members write text as themselves", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "households", "hA", "notes", "r1"), { text: "Double the glaze.", updatedBy: ALICE.uid, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "households", "hA", "notes", "r1"), { text: "x", updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "households", "hA", "notes", "r1"), { text: "x".repeat(5001), updatedBy: ALICE.uid, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(dbAs(BOB), "households", "hA", "notes", "r1"), { text: "x", updatedBy: BOB.uid, updatedAt: serverTimestamp() }));
  });

  it("stats are readable by members and written by nobody", async () => {
    await assertSucceeds(getDocs(collection(dbAs(ALICE), "households", "hA", "stats")));
    await assertFails(setDoc(doc(dbAs(ALICE), "households", "hA", "stats", "recipe_r1"), { timesCooked: 9 }));
  });
});

describe("notifications are private (R12.1)", () => {
  beforeEach(async () => {
    await seed(async (db) => setDoc(doc(db, "users", ALICE.uid, "notifications", "n1"), { kind: "success", message: "Imported", createdAt: new Date() }));
  });

  it("the owner reads, dismisses, and deletes; nobody else reads", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(getDocs(collection(db, "users", ALICE.uid, "notifications")));
    await assertSucceeds(updateDoc(doc(db, "users", ALICE.uid, "notifications", "n1"), { dismissedAt: serverTimestamp() }));
    await assertFails(getDocs(collection(dbAs(BOB), "users", ALICE.uid, "notifications")));
    await assertFails(getDoc(doc(anon(), "users", ALICE.uid, "notifications", "n1")));
    await assertSucceeds(deleteDoc(doc(db, "users", ALICE.uid, "notifications", "n1")));
  });

  it("clients don't create notifications or change their text", async () => {
    const db = dbAs(ALICE);
    await assertFails(setDoc(doc(db, "users", ALICE.uid, "notifications", "n2"), { kind: "error", message: "x", createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, "users", ALICE.uid, "notifications", "n1"), { message: "changed" }));
  });
});
