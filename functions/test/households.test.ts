// M4 on the emulators (Planning/M4 "Tests → Functions"): the empty-household cleanup (last leave, concurrent leaves,
// counter floor, kept while members remain) and importHousehold (a real M3 household's data round-trips: supply with
// transactions, cook events, ratings, stats, cadence, received lists; recipes matched by ID or fingerprint, missing
// ones recreated; members untouched; bad files fail).
import { beforeAll, describe, expect, it } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildExport,
  encodeValue,
  EXPORT_COLLECTIONS,
  gatherExport,
  readExportZip,
  zipExport,
  type ExportReader,
} from "@solving-food/core";
import { clearFirestore, db, bucket, fileExists, poll, readRecipe } from "./helpers";
import { cleanupIfEmpty } from "../src/households";

const DAY = 86_400_000;

function household(createdBy: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    name, createdBy, timezone: "America/Toronto", currentPeriodId: "2026-10-05", periodDays: 7, budgetCents: 20000, currency: "CAD",
    defaultServings: 4, plannedMealTypes: ["breakfast", "lunch", "dinner"], pcxStoreId: "x",
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} }, ...extra,
  };
}
const member = (uid: string, name = uid) => ({ uid, displayName: name, joinedAt: FieldValue.serverTimestamp() });

describe("empty-household cleanup (R2.13)", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("keeps a household while anyone is left; the last leave deletes everything and drops the counter", async () => {
    const hid = "hh-clean-1";
    await db.doc("users/owner1").set({ email: "o@x.com", activeHouseholdId: hid, householdsCreated: 2, theme: { flavour: "latte", accent: "green" } });
    await db.doc(`households/${hid}`).set(household("owner1", "Cottage"));
    await db.doc(`households/${hid}/members/owner1`).set(member("owner1"));
    await db.doc(`households/${hid}/members/spouse`).set(member("spouse"));
    await db.doc(`households/${hid}/planItems/p1`).set({ status: "planned" });
    await db.doc(`households/${hid}/supply/rice`).set({ canonicalAmount: 10, lots: [] });
    await db.doc(`households/${hid}/supply/rice/transactions/t1`).set({ delta: 10 });
    await db.doc(`households/${hid}/invites/someone`).set({ inviteeUid: "someone" });
    await bucket().file(`imports/${hid}/left.zip`).save(Buffer.from("x"));

    await db.doc(`households/${hid}/members/owner1`).delete(); // the creator leaves; the spouse stays
    expect(await cleanupIfEmpty(hid)).toEqual({ status: "kept" });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await db.doc(`households/${hid}`).get()).exists).toBe(true);
    expect((await db.doc("users/owner1").get()).data()!.householdsCreated).toBe(2);

    await db.doc(`households/${hid}/members/spouse`).delete(); // the last member leaves
    await poll(async () => !(await db.doc(`households/${hid}`).get()).exists, 30_000, "household deleted");
    await poll(async () => (await db.doc(`households/${hid}/supply/rice/transactions/t1`).get()).exists === false, 30_000, "subcollections deleted");
    for (const c of ["planItems", "supply", "invites", "members"]) expect((await db.collection(`households/${hid}/${c}`).get()).size).toBe(0);
    // The creator's counter drops even though they left first (R2.3: it no longer counts toward their limit).
    await poll(async () => (await db.doc("users/owner1").get()).data()!.householdsCreated === 1, 15_000, "counter decremented");
    await poll(async () => !(await fileExists(`imports/${hid}/left.zip`)), 15_000, "import uploads deleted");
    // Running it again is harmless.
    expect((await cleanupIfEmpty(hid)).status).toBe("gone");
    expect((await db.doc("users/owner1").get()).data()!.householdsCreated).toBe(1);
  });

  it("two members leaving at the same moment decrement the counter once", async () => {
    const hid = "hh-clean-2";
    await db.doc("users/owner2").set({ email: "o2@x.com", activeHouseholdId: hid, householdsCreated: 3, theme: { flavour: "latte", accent: "green" } });
    await db.doc(`households/${hid}`).set(household("owner2", "Parents"));
    await db.doc(`households/${hid}/members/owner2`).set(member("owner2"));
    await db.doc(`households/${hid}/members/sib`).set(member("sib"));
    await db.doc(`households/${hid}/stats/recipe_x`).set({ timesCooked: 1 });
    await Promise.all([db.doc(`households/${hid}/members/owner2`).delete(), db.doc(`households/${hid}/members/sib`).delete()]);
    await Promise.all([cleanupIfEmpty(hid), cleanupIfEmpty(hid)]); // racing the two triggers as well
    await poll(async () => !(await db.doc(`households/${hid}`).get()).exists, 30_000, "household deleted");
    await new Promise((r) => setTimeout(r, 2500)); // let both triggers finish
    expect((await db.doc("users/owner2").get()).data()!.householdsCreated).toBe(2);
    expect((await db.collection(`households/${hid}/stats`).get()).size).toBe(0);
  });

  it("the counter never goes below zero, and a missing creator doc is fine", async () => {
    await db.doc("users/owner3").set({ email: "o3@x.com", activeHouseholdId: null, householdsCreated: 0, theme: { flavour: "latte", accent: "green" } });
    await db.doc("households/hh-clean-3").set(household("owner3", "Odd"));
    expect(await cleanupIfEmpty("hh-clean-3")).toEqual({ status: "deleted", decremented: true });
    expect((await db.doc("users/owner3").get()).data()!.householdsCreated).toBe(0);
    await db.doc("households/hh-clean-4").set(household("nobody", "Orphan"));
    expect(await cleanupIfEmpty("hh-clean-4")).toEqual({ status: "deleted", decremented: false });
  });
});

// ---------- import

const UID = "importer";
const A = "hh-exp-a";
const B = "hh-imp-b";

const ING = {
  rice: { name: "rice", aliases: [], category: "grains", defaultLocation: "pantry", allowedMeasures: ["weight"], canonicalUnit: "g", shelfLifeDays: { pantry: 365 }, freezable: false, isStaple: true, freeUse: false, needsReview: false },
  chicken: { name: "chicken thigh", aliases: [], category: "meat", defaultLocation: "fridge", allowedMeasures: ["weight"], canonicalUnit: "g", shelfLifeDays: { fridge: 2, freezer: 180 }, freezable: true, isStaple: false, freeUse: false, needsReview: false },
};

function recipe(title: string, lines: Array<[string, number]>, extra: Record<string, unknown> = {}) {
  return {
    title, slug: title.toLowerCase().replace(/\s+/g, "-"), servings: 4, prepMin: 10, cookMin: 20, cuisine: "other", mainProtein: "chicken",
    tags: ["dinner"], tools: [],
    ingredients: lines.map(([ingredientId, canonicalAmount], i) => ({ id: `l${i}`, ingredientId, amount: canonicalAmount, measure: "g", canonicalAmount, displayText: ingredientId, optional: false })),
    steps: [{ text: "Cook.", ingredientRefs: [] }], prepTasks: [], defaultLeftoverPortions: 2, leftoverMealType: "lunch",
    fingerprint: `fp-${title}`, ingredientIds: lines.map(([id]) => id), imagePaths: [], status: "active", createdBy: "x", updatedBy: "x",
    version: 1, createdAt: new Date(), updatedAt: new Date(), ...extra,
  };
}

let n = 0;
async function command(hid: string, type: string, payload: Record<string, unknown>, uid = UID) {
  const id = `c${++n}-${Date.now()}`;
  await db.doc(`households/${hid}/commands/${id}`).set({ type, payload, uid, createdAt: FieldValue.serverTimestamp(), status: "pending" });
  const done = await poll(
    async () => {
      const d = (await db.doc(`households/${hid}/commands/${id}`).get()).data();
      return d && d.status !== "pending" && d.status !== "running" ? d : null;
    },
    90_000,
    `command ${type}`,
  );
  return { id, status: done.status as string, error: done.error as string | undefined, result: done.result as string | undefined };
}

function adminReader(hid: string): ExportReader {
  const all = async (path: string) => (await db.collection(path).get()).docs.map((d) => ({ id: d.id, data: d.data() }));
  return {
    household: async () => (await db.doc(`households/${hid}`).get()).data() ?? null,
    list: (c) => all(`households/${hid}/${c}`),
    transactions: (id) => all(`households/${hid}/supply/${id}/transactions`),
    recipe: async (id) => (await db.doc(`recipes/${id}`).get()).data() ?? null,
    meal: async (id) => (await db.doc(`meals/${id}`).get()).data() ?? null,
  };
}

async function snapshot(hid: string) {
  const out: Record<string, unknown> = {};
  for (const c of EXPORT_COLLECTIONS) {
    const docs = (await db.collection(`households/${hid}/${c}`).get()).docs;
    out[c] = Object.fromEntries(docs.map((d) => [d.id, encodeValue(d.data())]));
  }
  const supply = (await db.collection(`households/${hid}/supply`).get()).docs;
  for (const s of supply) {
    const txs = (await s.ref.collection("transactions").get()).docs;
    out[`supply/${s.id}`] = { data: encodeValue(s.data()), txs: Object.fromEntries(txs.map((t) => [t.id, encodeValue(t.data())])) };
  }
  return out;
}

async function upload(hid: string, name: string, bytes: Uint8Array) {
  const path = `imports/${hid}/${name}.zip`;
  await bucket().file(path).save(Buffer.from(bytes), { contentType: "application/zip" });
  return path;
}

describe("importHousehold (R11.10)", () => {
  beforeAll(async () => {
    await clearFirestore();
    const b = db.batch();
    for (const [id, d] of Object.entries(ING)) b.set(db.doc(`ingredients/${id}`), d);
    b.set(db.doc(`households/${A}`), household(UID, "Silbrass Pvt", { budgetCents: 15000, settings: { scoreWeights: { expiring: 3 }, tools: ["Wok"], preferences: { likes: ["thai"], dislikes: [], diets: [] }, proteinGoals: {} } }));
    b.set(db.doc(`households/${A}/members/${UID}`), member(UID, "Aaron"));
    b.set(db.doc(`households/${A}/periods/2026-10-05`), { start: new Date(Date.now() - DAY), end: new Date(Date.now() + 6 * DAY), budgetCents: 15000 });
    b.set(db.doc(`households/${A}/stores/costco`), { name: "Costco", kind: "inStore", bulk: true });
    b.set(db.doc(`households/${A}/favourites/recipe_r-chicken`), { type: "recipe", targetId: "r-chicken" });
    b.set(db.doc(`households/${A}/notes/r-rice`), { text: "Rinse twice", updatedBy: UID, updatedAt: new Date() });
    b.set(db.doc("recipes/r-chicken"), recipe("Chicken rice", [["chicken", 600], ["rice", 300]]));
    b.set(db.doc("recipes/r-rice"), recipe("Plain rice", [["rice", 400]]));
    b.set(db.doc("meals/m-dinner"), { name: "Chicken dinner", recipes: [{ recipeId: "r-chicken", servingsMultiplier: 1 }], createdBy: UID, updatedBy: UID, createdAt: new Date(), updatedAt: new Date() });
    // Household B already has data, and two members, before the import.
    b.set(db.doc(`households/${B}`), household("other", "Cottage", { budgetCents: 99900 }));
    b.set(db.doc(`households/${B}/members/other`), member("other", "Pat"));
    b.set(db.doc(`households/${B}/members/${UID}`), member(UID, "Aaron"));
    b.set(db.doc(`households/${B}/invites/friend`), { inviteeUid: "friend", householdName: "Cottage", invitedBy: "other", createdAt: new Date() });
    b.set(db.doc(`households/${B}/planItems/old`), { periodId: "x", status: "planned" });
    b.set(db.doc(`households/${B}/supply/old`), { canonicalAmount: 5, lots: [] });
    b.set(db.doc(`households/${B}/supply/old/transactions/t`), { delta: 5 });
    await b.commit();

    // Real M3 data in A, made by the command function: purchases, a received list with a freeze split, a cooked meal
    // with leftovers, a review with ratings and corrections, a correction.
    expect((await command(A, "addSupply", { ingredientId: "rice", amount: 2000, location: "pantry" })).status).toBe("applied");
    await db.doc(`households/${A}/groceryLists/ord1`).set({
      periodId: "2026-10-05", status: "ordered", createdAt: new Date(), orderedAt: new Date(), orderedBy: UID,
      items: { chicken: { ingredientId: "chicken", amount: 2000, measure: "g", packs: 1, productName: "Kirkland thighs", storeId: "costco", estPriceCents: 2000, source: "plan", checked: false } },
    });
    expect((await command(A, "receiveGroceries", { listId: "ord1", items: [{ itemId: "chicken", ingredientId: "chicken", amount: 2000, freezeAmount: 1500 }] })).status).toBe("applied");
    await db.doc(`households/${A}/planItems/p1`).set({ periodId: "2026-10-05", kind: "meal", mealType: "dinner", servings: 4, recipes: [{ recipeId: "r-chicken", servingsMultiplier: 1 }], savedMealId: "m-dinner", coverage: { dinner: 1, lunch: 2 }, status: "planned", addedBy: UID });
    expect((await command(A, "finishCooking", { cookEventId: "ev1", planItemId: "p1", savedMealId: "m-dinner", recipes: [{ recipeId: "r-chicken", servingsMultiplier: 1 }], servings: 4 })).status).toBe("applied");
    expect((await command(A, "submitReview", { cookEventId: "ev1", ratings: [{ targetType: "recipe", targetId: "r-chicken", score: 9 }, { targetType: "meal", targetId: "m-dinner", score: 8 }], used: [{ ingredientId: "chicken", canonicalAmount: 500 }, { ingredientId: "rice", canonicalAmount: 300 }], leftoverPortions: 3 })).status).toBe("applied");
    expect((await command(A, "correctSupply", { supplyId: "rice", target: 1500 })).status).toBe("applied");
  });

  it("export from A, import into B: plan, supply (Σ transactions == amount), history, ratings, stats, cadence, received lists match; members untouched", async () => {
    const before = await snapshot(A);
    expect(Object.keys(before.cookEvents as object)).toEqual(["ev1"]);
    expect(Object.keys(before.ratings as object)).toHaveLength(2);
    expect(Object.keys(before.cadence as object)).toEqual(["chicken"]); // received groceries update cadence
    expect((before.groceryLists as Record<string, { status: string }>).ord1!.status).toBe("received");

    const input = await gatherExport(A, adminReader(A), Date.now());
    const bytes = zipExport(buildExport(input));
    const parsed = readExportZip(bytes);
    expect(parsed.export.recipes.map((r) => r.id).sort()).toEqual(["r-chicken", "r-rice"]);
    expect(parsed.meals.map((m) => m.id)).toEqual(["m-dinner"]);

    const path = await upload(B, "round-trip", bytes);
    const r = await command(B, "importHousehold", { path });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe("applied");
    expect(r.result).toMatch(/plan items/);

    expect(await snapshot(B)).toEqual(before);
    for (const s of (await db.collection(`households/${B}/supply`).get()).docs) {
      const sum = (await s.ref.collection("transactions").get()).docs.reduce((t, d) => t + (d.data().delta as number), 0);
      expect(sum).toBeCloseTo(s.data().canonicalAmount as number, 6);
    }
    // Old data is gone; members, invites, name and creator stay; settings come from the export.
    expect((await db.doc(`households/${B}/planItems/old`).get()).exists).toBe(false);
    expect((await db.doc(`households/${B}/supply/old/transactions/t`).get()).exists).toBe(false);
    expect((await db.collection(`households/${B}/members`).get()).docs.map((d) => d.id).sort()).toEqual([UID, "other"].sort());
    expect((await db.doc(`households/${B}/invites/friend`).get()).exists).toBe(true);
    const hb = (await db.doc(`households/${B}`).get()).data()!;
    expect(hb).toMatchObject({ name: "Cottage", createdBy: "other", budgetCents: 15000, currentPeriodId: "2026-10-05" });
    expect(hb.settings.tools).toEqual(["Wok"]);
    // Only the import command is left in B; the upload is deleted; the importer is told.
    expect((await db.collection(`households/${B}/commands`).get()).docs.map((d) => d.id)).toEqual([r.id]);
    expect(await fileExists(path)).toBe(false);
    const notes = await db.collection(`users/${UID}/notifications`).where("kind", "==", "success").get();
    expect(notes.docs.some((d) => /Household data imported/.test(d.data().message))).toBe(true);
    // A still has its own data.
    expect(await snapshot(A)).toEqual(before);
  });

  it("matches a missing recipe by fingerprint, recreates one that's gone from its .cook file, and recreates a missing meal", async () => {
    const input = await gatherExport(A, adminReader(A), Date.now());
    const built = buildExport(input);
    // "r-old" was purged here, but a recipe with its fingerprint exists; "r-new" exists nowhere.
    await db.doc("recipes/r-match").set(recipe("Same rice", [["rice", 400]], { fingerprint: "fp-shared" }));
    built.export.recipes.push({ id: "r-old", title: "Old rice", fingerprint: "fp-shared", file: "recipes/old-rice-r-old.cook" });
    built.cook.set("recipes/old-rice-r-old.cook", "---\ntitle: Old rice\n---\nCook.");
    const cook = readRecipe("baked-feta-pasta.cook");
    built.export.recipes.push({ id: "r-new", title: "Baked feta pasta", fingerprint: "fp-nowhere", file: "recipes/baked-feta-pasta-r-new.cook" });
    built.cook.set("recipes/baked-feta-pasta-r-new.cook", cook);
    built.export.collections.favourites.push({ id: "recipe_r-old", data: { type: "recipe", targetId: "r-old" } });
    built.export.collections.notes.push({ id: "r-new", data: { text: "Extra feta" } });
    built.meals.push({ id: "m-gone", name: "Pasta night", recipes: [{ recipeId: "r-new", servingsMultiplier: 1 }] });
    built.export.collections.favourites.push({ id: "meal_m-gone", data: { type: "meal", targetId: "m-gone" } });

    const path = await upload(B, "match", zipExport(built));
    const r = await command(B, "importHousehold", { path });
    expect(r.status).toBe("applied");
    expect(r.result).toMatch(/1 recipe and 1 meal recreated/);
    expect((await db.doc(`households/${B}/favourites/recipe_r-match`).get()).data()).toEqual({ type: "recipe", targetId: "r-match" });
    expect((await db.doc(`households/${B}/favourites/recipe_r-old`).get()).exists).toBe(false);
    expect((await db.doc("recipes/r-old").get()).exists).toBe(false);
    const created = (await db.doc("recipes/r-new").get()).data()!;
    expect(created).toMatchObject({ title: "Baked Feta Pasta", status: "active", createdBy: UID, version: 1 });
    expect((await db.doc("recipes/r-new/versions/1").get()).exists).toBe(true);
    expect((await db.doc(`households/${B}/notes/r-new`).get()).data()!.text).toBe("Extra feta");
    expect((await db.doc("meals/m-gone").get()).data()).toMatchObject({ name: "Pasta night", recipes: [{ recipeId: "r-new", servingsMultiplier: 1 }] });
  });

  it("a hand-edited export whose history doesn't add up gets a reconciling correction", async () => {
    const built = buildExport(await gatherExport(A, adminReader(A), Date.now()));
    const rice = built.export.supply.find((s) => s.id === "rice")!;
    rice.transactions = rice.transactions.slice(1); // drop the first purchase
    const r = await command(B, "importHousehold", { path: await upload(B, "edited", zipExport(built)) });
    expect(r.status).toBe("applied");
    const s = (await db.doc(`households/${B}/supply/rice`).get()).data()!;
    const txs = (await db.collection(`households/${B}/supply/rice/transactions`).get()).docs;
    expect(txs.some((t) => t.id === "import-reconcile")).toBe(true);
    expect(txs.reduce((t, d) => t + (d.data().delta as number), 0)).toBeCloseTo(s.canonicalAmount, 6);
  });

  it("a bad file fails with a reason and a banner, and changes nothing", async () => {
    const planBefore = (await db.collection(`households/${B}/planItems`).get()).size;
    const bad = await upload(B, "bad", new TextEncoder().encode("not a zip"));
    const r = await command(B, "importHousehold", { path: bad });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/not a zip/);
    expect(await fileExists(bad)).toBe(false);
    const banners = await db.collection(`users/${UID}/notifications`).where("kind", "==", "error").get();
    expect(banners.docs.some((d) => /Couldn't import household data/.test(d.data().message))).toBe(true);
    expect((await db.collection(`households/${B}/planItems`).get()).size).toBe(planBefore);

    // Another household's upload can't be imported, nor a missing one.
    const theirs = await upload(A, "theirs", zipExport(buildExport(await gatherExport(A, adminReader(A), Date.now()))));
    expect((await command(B, "importHousehold", { path: theirs })).error).toMatch(/this household's import folder/);
    expect((await command(B, "importHousehold", { path: `imports/${B}/nothing.zip` })).error).toMatch(/gone/);
  });
});
