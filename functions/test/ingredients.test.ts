// "Merge into…" on the emulators (Planning/M8 item 2, PRD R4.27, R8.16): recipes and their versions repointed, saved
// meals, every household's Supply moved with Σ transactions == amount on both rows, plan sides, grocery lines, keyed
// household docs, alias learning and the tombstone; a dry run changes nothing; re-running is a no-op; refusals; and the
// next import of the duplicate's wording resolves to the target.
import { beforeAll, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { clearFirestore, db } from "./helpers";
import { mergeIngredient, MergeError, requireAllowed } from "../src/ingredients";
import { prepareCookRecipe, resetIngredientCache } from "../src/dropFolder";

const UID = "merger";
const DAY = 86_400_000;
const NOW = Date.now();

const base = { category: "frozen", defaultLocation: "freezer", allowedMeasures: ["weight"], canonicalUnit: "g", shelfLifeDays: { freezer: 240 }, freezable: true, isStaple: false, freeUse: false };
const ING: Record<string, Record<string, unknown>> = {
  // Shipped catalogue (no createdBy).
  "tater-tot": { ...base, name: "tater tots", aliases: ["potato tots"], proteinPer100g: 2.5, needsReview: false },
  // Created by a drop import.
  "frozen-tater-tot": { ...base, name: "frozen tater tots", aliases: ["tot bites"], needsReview: true, createdBy: "importer" },
  "m-and-m-s": { ...base, category: "pantry", defaultLocation: "pantry", name: "m&m's", aliases: [], needsReview: true, createdBy: "importer" },
  "m-and-ms": { ...base, category: "pantry", defaultLocation: "pantry", name: "m&ms", aliases: [], needsReview: true, createdBy: "importer" },
  ketchup: { ...base, category: "condiments", defaultLocation: "fridge", name: "ketchup", aliases: [], proteinPer100g: 1, needsReview: false },
  egg: { ...base, category: "dairy", defaultLocation: "fridge", name: "egg", aliases: [], allowedMeasures: ["count"], canonicalUnit: "count", unitWeightG: 50, proteinPer100g: 12, needsReview: false },
  "egg-new": { ...base, category: "dairy", defaultLocation: "fridge", name: "eggs by weight", aliases: [], needsReview: true, createdBy: "importer" },
};

function recipe(title: string, lines: Array<[string, number]>, version = 1) {
  return {
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    servings: 4,
    prepMin: 10,
    cookMin: 20,
    cuisine: "american",
    mainProtein: "none",
    tags: ["dinner"],
    tools: [],
    ingredients: lines.map(([ingredientId, amount], i) => ({ id: `l${i + 1}`, ingredientId, amount, measure: "g", canonicalAmount: amount, displayText: ingredientId.replace(/-/g, " "), optional: false })),
    steps: [{ text: "Bake.", ingredientRefs: [] }],
    prepTasks: [],
    defaultLeftoverPortions: 0,
    fingerprint: title,
    ingredientIds: lines.map(([id]) => id),
    imagePaths: [],
    status: "active",
    createdBy: "x",
    updatedBy: "x",
    version,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const lot = (lotId: string, amount: number) => ({ lotId, amount, location: "freezer", acquiredAt: Timestamp.fromMillis(NOW - DAY), expiresFrozen: Timestamp.fromMillis(NOW + 100 * DAY), frozenAt: Timestamp.fromMillis(NOW - DAY) });

async function supplyRow(hid: string, id: string, lots: Array<ReturnType<typeof lot>>) {
  const ref = db.doc(`households/${hid}/supply/${id}`);
  await ref.set({ ingredientId: id, label: String(ING[id]!.name), canonicalUnit: "g", canonicalAmount: lots.reduce((s, l) => s + l.amount, 0), lots, nextExpiry: null });
  for (const l of lots) await ref.collection("transactions").doc(`p-${l.lotId}`).set({ delta: l.amount, kind: "purchase", lotId: l.lotId, uid: "u", createdAt: Timestamp.fromMillis(NOW - DAY) });
}

async function ledger(hid: string, id: string) {
  const ref = db.doc(`households/${hid}/supply/${id}`);
  const doc = (await ref.get()).data()!;
  const txs = (await ref.collection("transactions").get()).docs.map((d) => d.data());
  return { doc, txs, sum: Math.round(txs.reduce((s, t) => s + Number(t.delta), 0) * 1e6) / 1e6 };
}

const read = async (path: string) => (await db.doc(path).get()).data();

describe("mergeIngredient", () => {
  beforeAll(async () => {
    await clearFirestore();
    const b = db.batch();
    for (const [id, d] of Object.entries(ING)) b.set(db.doc(`ingredients/${id}`), d);
    b.set(db.doc("recipes/tots"), recipe("Tot casserole", [["frozen-tater-tot", 500], ["ketchup", 50]], 2));
    b.set(db.doc("recipes/tots/versions/1"), { ...recipe("Tot casserole", [["frozen-tater-tot", 400]], 1), editedBy: "x" });
    b.set(db.doc("recipes/tots/versions/2"), { ...recipe("Tot casserole", [["frozen-tater-tot", 500], ["ketchup", 50]], 2), editedBy: "x" });
    b.set(db.doc("recipes/both"), recipe("Both tots", [["frozen-tater-tot", 100], ["tater-tot", 200]]));
    b.set(db.doc("recipes/plain"), recipe("Ketchup only", [["ketchup", 10]]));
    b.set(db.doc("meals/m1"), { name: "Tot night", recipes: [{ recipeId: "plain", servingsMultiplier: 1 }], sides: [{ ingredientId: "frozen-tater-tot", portion: 150 }], createdBy: "x", updatedBy: "x" });
    // Household 1 has both rows, a plan side, a draft list with both lines, a brand mapping, cadence and a side setting.
    b.set(db.doc("households/h1"), { name: "One", settings: { sides: { "frozen-tater-tot": { portion: 120 } }, preferences: { likes: ["ingredient:frozen-tater-tot", "pizza"], dislikes: [], diets: [] } } });
    b.set(db.doc("households/h1/planItems/p1"), { periodId: "x", kind: "meal", status: "planned", recipes: [], sides: [{ ingredientId: "frozen-tater-tot", portion: 150 }] });
    b.set(db.doc("households/h1/planItems/p2"), { periodId: "x", kind: "meal", status: "cooked", recipes: [], sides: [{ ingredientId: "frozen-tater-tot", portion: 150 }] });
    const line = (ingredientId: string, amount: number) => ({ ingredientId, amount, measure: "g", need: amount, packs: 1, productName: ingredientId, storeId: "pc-express", estPriceCents: 400, source: "plan", checked: false });
    b.set(db.doc("households/h1/groceryLists/draft"), { periodId: "x", status: "draft", createdAt: new Date(), items: { "frozen-tater-tot": line("frozen-tater-tot", 900), "tater-tot": line("tater-tot", 900) } });
    b.set(db.doc("households/h1/groceryLists/old"), { periodId: "x", status: "received", createdAt: new Date(), items: { "frozen-tater-tot": line("frozen-tater-tot", 900) } });
    b.set(db.doc("households/h1/brandMappings/frozen-tater-tot"), { productName: "PC tots", packAmount: 900, packMeasure: "weight", storeId: "pc-express" });
    b.set(db.doc("households/h1/cadence/frozen-tater-tot"), { avgIntervalDays: null, lastPurchasedAt: new Date(), purchaseCount: 1 });
    // Household 2 has only the duplicate's row.
    b.set(db.doc("households/h2"), { name: "Two" });
    await b.commit();
    await supplyRow("h1", "frozen-tater-tot", [lot("a", 400), lot("b", 250)]);
    await supplyRow("h1", "tater-tot", [lot("a", 900)]);
    await supplyRow("h2", "frozen-tater-tot", [lot("c", 300)]);
  });

  it("only allowlisted, verified callers", async () => {
    await expect(requireAllowed(undefined)).rejects.toThrow(MergeError);
    await expect(requireAllowed({ uid: "x", token: { email: "x@example.com", email_verified: true } })).rejects.toThrow(/allowlist/);
    await db.doc("allowlist/ok@example.com").set({ addedBy: "test" });
    await expect(requireAllowed({ uid: "y", token: { email: "OK@example.com", email_verified: false } })).rejects.toThrow(/Sign in/);
    await expect(requireAllowed({ uid: "y", token: { email: "OK@example.com", email_verified: true } })).resolves.toBe("y");
  });

  it("refuses a catalogue ingredient into a new one, itself, unknown IDs, and unconvertible units", async () => {
    await expect(mergeIngredient(UID, { fromId: "tater-tot", intoId: "frozen-tater-tot" })).rejects.toThrow(/shipped catalogue/);
    await expect(mergeIngredient(UID, { fromId: "ketchup", intoId: "ketchup" })).rejects.toThrow(/itself/);
    await expect(mergeIngredient(UID, { fromId: "nope", intoId: "ketchup" })).rejects.toThrow(/No ingredient nope/);
    await expect(mergeIngredient(UID, { fromId: "x/y", intoId: "ketchup" })).rejects.toThrow(/ingredient IDs/);
    await db.doc("ingredients/egg-new").update({ canonicalUnit: "count" });
    await expect(mergeIngredient(UID, { fromId: "egg-new", intoId: "ketchup" })).rejects.toThrow(/weight per piece/);
    await db.doc("ingredients/egg-new").update({ canonicalUnit: "g" });
  });

  it("a dry run counts what moves and changes nothing", async () => {
    const r = await mergeIngredient(UID, { fromId: "frozen-tater-tot", intoId: "tater-tot", dryRun: true });
    expect(r).toMatchObject({ dryRun: true, recipes: 2, versions: 2, meals: 1, households: 2, supplyRows: 2, planItems: 1, groceryLists: 1, householdDocs: 4, aliasesAdded: ["frozen tater tots", "tot bites"] });
    expect((await read("ingredients/frozen-tater-tot"))!.mergedInto).toBeUndefined();
    expect((await ledger("h1", "frozen-tater-tot")).doc.canonicalAmount).toBe(650);
    expect((await read("recipes/tots"))!.ingredientIds).toContain("frozen-tater-tot");
  });

  it("moves everything onto the target, keeps both ledgers consistent, learns aliases, leaves a tombstone", async () => {
    const r = await mergeIngredient(UID, { fromId: "frozen-tater-tot", intoId: "tater-tot" });
    expect(r).toMatchObject({ dryRun: false, alreadyMerged: false, recipes: 2, versions: 2, supplyRows: 2 });

    // Recipes: lines and ingredientIds repointed, no version bump; a recipe using both lists the target once.
    const tots = (await read("recipes/tots"))!;
    expect(tots.version).toBe(2);
    expect([...tots.ingredientIds].sort()).toEqual(["ketchup", "tater-tot"]);
    expect(tots.ingredients.map((l: { ingredientId: string; displayText: string }) => [l.ingredientId, l.displayText])).toEqual([["tater-tot", "frozen tater tot"], ["ketchup", "ketchup"]]);
    expect(typeof tots.proteinPerServingG).toBe("number");
    expect((await read("recipes/both"))!.ingredientIds).toEqual(["tater-tot"]);
    // Versions: repointed, numbers unchanged.
    expect((await read("recipes/tots/versions/1"))!).toMatchObject({ version: 1, ingredientIds: ["tater-tot"] });
    expect((await read("recipes/tots/versions/2"))!.ingredients[0].ingredientId).toBe("tater-tot");
    // Saved meal and the planned (not the cooked) plan item.
    expect((await read("meals/m1"))!.sides).toEqual([{ ingredientId: "tater-tot", portion: 150 }]);
    expect((await read("households/h1/planItems/p1"))!.sides[0].ingredientId).toBe("tater-tot");
    expect((await read("households/h1/planItems/p2"))!.sides[0].ingredientId).toBe("frozen-tater-tot");

    // Supply, household 1: lots appended (clash renamed), Σ transactions == amount on both rows.
    const into = await ledger("h1", "tater-tot");
    expect(into.doc.canonicalAmount).toBe(1550);
    expect(into.doc.lots.map((l: { lotId: string; amount: number }) => [l.lotId, l.amount])).toEqual([["a", 900], ["a-m1", 400], ["b", 250]]);
    expect(into.sum).toBe(1550);
    expect(into.txs.filter((t) => t.mergedFrom === "frozen-tater-tot").map((t) => t.lotId).sort()).toEqual(["a-m1", "b"]);
    expect(into.txs.find((t) => t.kind === "merge")).toMatchObject({ delta: 0, note: "merged from frozen tater tots" });
    const from = await ledger("h1", "frozen-tater-tot");
    expect(from.doc).toMatchObject({ canonicalAmount: 0, lots: [], mergedInto: "tater-tot" });
    expect(from.sum).toBe(0);
    // Household 2: the target's row is created.
    const h2 = await ledger("h2", "tater-tot");
    expect(h2.doc).toMatchObject({ ingredientId: "tater-tot", label: "tater tots", canonicalAmount: 300 });
    expect(h2.sum).toBe(300);
    expect((await ledger("h2", "frozen-tater-tot")).sum).toBe(0);

    // Grocery: the draft's lines joined; the received list untouched.
    const draft = (await read("households/h1/groceryLists/draft"))!.items;
    expect(Object.keys(draft)).toEqual(["tater-tot"]);
    expect(draft["tater-tot"]).toMatchObject({ amount: 1800, packs: 2, estPriceCents: 800 });
    expect(Object.keys((await read("households/h1/groceryLists/old"))!.items)).toEqual(["frozen-tater-tot"]);
    // Keyed docs moved; the side setting moved.
    expect(await read("households/h1/brandMappings/tater-tot")).toMatchObject({ productName: "PC tots" });
    expect(await read("households/h1/brandMappings/frozen-tater-tot")).toBeUndefined();
    expect(await read("households/h1/cadence/tater-tot")).toMatchObject({ purchaseCount: 1 });
    expect((await read("households/h1"))!.settings.sides).toEqual({ "tater-tot": { portion: 120 } });
    expect((await read("households/h1"))!.settings.preferences.likes).toEqual(["ingredient:tater-tot", "pizza"]);

    // Ingredients: aliases learned, tombstone.
    expect((await read("ingredients/tater-tot"))!).toMatchObject({ aliases: ["potato tots", "frozen tater tots", "tot bites"], needsReview: false, updatedBy: UID });
    expect((await read("ingredients/frozen-tater-tot"))!).toMatchObject({ mergedInto: "tater-tot", needsReview: false });
  });

  it("re-running is a no-op", async () => {
    const before = await ledger("h1", "tater-tot");
    const r = await mergeIngredient(UID, { fromId: "frozen-tater-tot", intoId: "tater-tot" });
    expect(r).toMatchObject({ alreadyMerged: true, recipes: 0, versions: 0, supplyRows: 0, aliasesAdded: [] });
    const after = await ledger("h1", "tater-tot");
    expect(after.doc.canonicalAmount).toBe(before.doc.canonicalAmount);
    expect(after.txs.length).toBe(before.txs.length);
    await expect(mergeIngredient(UID, { fromId: "frozen-tater-tot", intoId: "ketchup" })).rejects.toThrow(/already merged/);
    await expect(mergeIngredient(UID, { fromId: "m-and-ms", intoId: "frozen-tater-tot" })).rejects.toThrow(/merge into that one/);
  });

  it("spelling variants between two new ingredients, and the next import resolves to the target", async () => {
    await mergeIngredient(UID, { fromId: "m-and-m-s", intoId: "m-and-ms" });
    expect((await read("ingredients/m-and-ms"))!.aliases).toEqual(["m&m's"]);
    resetIngredientCache();
    const cook = "---\ntitle: Merge check\nservings: 2\ncuisine: american\nmain_protein: none\nprep_time: 5 minutes\ncook_time: 10 minutes\ntags: [snack]\n---\nBake @frozen tater tots{450%g} and top with @M&M's{50%g}.\n";
    const { content, warnings } = await prepareCookRecipe(UID, cook);
    expect(content.ingredients.map((l) => l.ingredientId)).toEqual(["tater-tot", "m-and-ms"]);
    expect(warnings.join(" ")).not.toMatch(/new ingredient/);
  });
});
