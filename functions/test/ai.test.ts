// The LLM ingredient judge against the stub (M15; PRD R4.27, R4.36, R8.16): an import asks before creating anything
// (same → existing ingredient + alias, new, unsure, Gemini down), Check names merges waiting names (Supply moves) and
// marks the rest, the owner-only key and status callables.
process.env.PCX_STUB = "1";
import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { clearFirestore, db } from "./helpers";
import { prepareCookRecipe, resetIngredientCache } from "../src/dropFolder";
import { aiSetKey, aiStatus, checkIngredientNames, isWaiting } from "../src/ai";
import { STUB_GEMINI_KEY } from "../src/ai/gemini";

const OWNER = "ai-owner";
const MEMBER = "ai-member";
const HID = "ai-home";

const base = { category: "condiments", defaultLocation: "fridge", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 1.3, shelfLifeDays: { fridge: 180 }, freezable: false, isStaple: false, freeUse: false, needsReview: false };
const read = async (path: string) => (await db.doc(path).get()).data();

async function stub(answers: Record<string, string>, mode?: string) {
  await db.doc("_stubLlm/config").set({ answers, ...(mode ? { mode } : {}) });
}

const cook = (title: string, body: string) => `---\ntitle: ${title}\nservings: 2\ncuisine: other\nmain_protein: none\nprep_time: 5 minutes\ncook_time: 0 minutes\ntags: [snack]\n---\n${body}`;

beforeEach(async () => {
  await clearFirestore();
  resetIngredientCache();
  await db.doc("ingredients/strawberry-jam").set({ ...base, name: "strawberry jam", aliases: [] });
  await db.doc("ingredients/toast").set({ ...base, category: "bakery", name: "toast", aliases: [] });
  await db.doc(`households/${HID}`).set({ name: "Home", pcxStoreId: "x" });
  for (const uid of [OWNER, MEMBER]) await db.doc(`households/${HID}/members/${uid}`).set({ uid, displayName: uid, joinedAt: new Date() });
  await db.doc(`_stubPcx/${HID}`).set({ ownerUid: OWNER });
});

describe("on import (R4.27)", () => {
  it("a wording Gemini places uses that ingredient and becomes its name; new and unsure ones are created and marked", async () => {
    await stub({ "strawberry spread": "strawberry-jam", "dragonfruit": "new" });
    const r = await prepareCookRecipe(OWNER, cook("Jam Toast", "Spread @strawberry spread{2%tbsp} on @toast{2}, top with @dragonfruit{1} and @mystery dust{1%tsp}."));
    expect(r.content.ingredients.map((l) => l.ingredientId)).toEqual(["strawberry-jam", "toast", "dragonfruit", "mystery-dust"]);
    expect((await read("ingredients/strawberry-jam"))!.aliases).toEqual(["strawberry spread"]);
    expect(await read("ingredients/strawberry-spread")).toBeUndefined();
    expect(await read("ingredients/dragonfruit")).toMatchObject({ nameCheck: "new", createdBy: OWNER });
    expect(await read("ingredients/mystery-dust")).toMatchObject({ nameCheck: "unsure" });
    expect(r.warnings.join("; ")).toMatch(/matched by Gemini: strawberry spread → strawberry jam/);
    expect(r.warnings.join("; ")).toMatch(/new ingredient: dragonfruit/);
    expect(r.warnings.join("; ")).toMatch(/not sure whether mystery dust/);

    // The next import of that wording matches without asking.
    resetIngredientCache();
    await stub({});
    const again = await prepareCookRecipe(OWNER, cook("Jam Again", "Spread @strawberry spread{1%tbsp}."));
    expect(again.content.ingredients[0]!.ingredientId).toBe("strawberry-jam");
  });

  it("Gemini down or not set up: created as unsure, and the notification says the names weren't checked", async () => {
    await stub({}, "down");
    const r = await prepareCookRecipe(OWNER, cook("Down", "Add @kumquat{3}."));
    expect(await read("ingredients/kumquat")).toMatchObject({ nameCheck: "unsure" });
    expect(r.warnings.join("; ")).toMatch(/names not checked \(Gemini answered 503\)/);
  });

  it("an answer naming something that wasn't a candidate is ignored", async () => {
    await stub({ "blue raspberry": "toast-that-does-not-exist" });
    await prepareCookRecipe(OWNER, cook("Odd", "Add @blue raspberry{3}."));
    expect(await read("ingredients/blue-raspberry")).toMatchObject({ nameCheck: "unsure" });
  });
});

describe("Check names (R4.27, R8.16)", () => {
  it("merges the waiting names Gemini is sure about (Supply moves), keeps new ones, leaves the rest; owner only", async () => {
    const waiting = { ...base, needsReview: true, createdBy: "importer" };
    await db.doc("ingredients/strawberry-preserve").set({ ...waiting, name: "strawberry preserve", aliases: [] });
    await db.doc("ingredients/yuzu").set({ ...waiting, name: "yuzu", aliases: [] });
    await db.doc("ingredients/odd-thing").set({ ...waiting, name: "odd thing", aliases: [], nameCheck: "unsure" });
    await db.doc("ingredients/done").set({ ...waiting, name: "done thing", aliases: [], nameCheck: "new" });
    const lot = { lotId: "l1", amount: 300, location: "fridge", acquiredAt: Timestamp.now(), expiresFrozen: null, frozenAt: null };
    await db.doc(`households/${HID}/supply/strawberry-preserve`).set({ ingredientId: "strawberry-preserve", label: "strawberry preserve", canonicalUnit: "g", canonicalAmount: 300, lots: [lot], nextExpiry: null });
    await db.doc(`households/${HID}/supply/strawberry-preserve/transactions/p1`).set({ delta: 300, kind: "purchase", lotId: "l1", uid: "u", createdAt: Timestamp.now() });
    await stub({ "strawberry preserve": "strawberry-jam", yuzu: "new" });

    expect((await aiStatus(MEMBER, { hid: HID }, OWNER)).waiting).toBe(3);
    await expect(checkIngredientNames(MEMBER, { hid: HID }, OWNER)).rejects.toMatchObject({ code: "permission-denied" });

    const r = await checkIngredientNames(OWNER, { hid: HID }, OWNER);
    expect(r).toMatchObject({ checked: 3, merged: [{ from: "strawberry preserve", into: "strawberry jam" }], kept: ["yuzu"], unsure: ["odd thing"], remaining: 0 });
    expect(await read("ingredients/strawberry-preserve")).toMatchObject({ mergedInto: "strawberry-jam" });
    expect((await read("ingredients/strawberry-jam"))!.aliases).toContain("strawberry preserve");
    expect((await read(`households/${HID}/supply/strawberry-jam`))!.canonicalAmount).toBe(300);
    expect(await read("ingredients/yuzu")).toMatchObject({ nameCheck: "new" });
    expect(isWaiting((await read("ingredients/odd-thing")) as never)).toBe(true);
    expect((await aiStatus(OWNER, { hid: HID }, OWNER)).waiting).toBe(1);
  });

  it("Gemini down: nothing changes and the report says why", async () => {
    await db.doc("ingredients/yuzu").set({ ...base, needsReview: true, createdBy: "importer", name: "yuzu", aliases: [] });
    await stub({}, "down");
    const r = await checkIngredientNames(OWNER, { hid: HID }, OWNER);
    expect(r).toMatchObject({ checked: 0, remaining: 1, message: "Gemini answered 503" });
    expect((await read("ingredients/yuzu"))!.nameCheck).toBeUndefined();
  });
});

describe("Gemini key (R4.36)", () => {
  it("owner only; saving tries it; a wrong one is kept but reported; empty clears it", async () => {
    await stub({});
    expect((await aiStatus(MEMBER, { hid: HID }, OWNER)).canEditKey).toBeUndefined();
    await expect(aiSetKey(MEMBER, { hid: HID, apiKey: STUB_GEMINI_KEY }, OWNER)).rejects.toMatchObject({ code: "permission-denied" });
    const bad = await aiSetKey(OWNER, { hid: HID, apiKey: "AIza-wrong" }, OWNER);
    expect(bad).toMatchObject({ connected: false, canEditKey: true, keyHint: "…rong" });
    expect(bad.message).toMatch(/didn't accept it.*400/);
    expect(await aiSetKey(OWNER, { hid: HID, apiKey: ` ${STUB_GEMINI_KEY} ` }, OWNER)).toEqual({ connected: true, canEditKey: true, keyHint: "…-key" });
    expect(await aiStatus(OWNER, { hid: HID }, OWNER)).toMatchObject({ connected: true, canEditKey: true, keyHint: "…-key" });
    expect(await aiSetKey(OWNER, { hid: HID, apiKey: "" }, OWNER)).toMatchObject({ connected: false, canEditKey: true });
    expect((await read("aiSession/config"))!.apiKey).toBeUndefined();
  });
});
