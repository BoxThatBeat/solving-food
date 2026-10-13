// recipeIndex (TECHNICAL_SPECS §9 "Search"): add, update, remove, trashed recipes leaving and re-entering, chunk
// assignment on create, deletes.
import { beforeAll, describe, expect, it } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { clearFirestore, db, poll } from "./helpers";
import { CHUNK_CAPACITY, indexUnchanged, type IndexChunk } from "../src/recipeIndex";

function recipe(title: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    servings: 4,
    prepMin: 10,
    cookMin: 20,
    cuisine: "italian",
    mainProtein: "chicken",
    tags: ["dinner"],
    tools: [],
    ingredients: [{ id: "l1", ingredientId: "garlic", amount: 2, measure: "clove", canonicalAmount: 10, displayText: "garlic", optional: false }],
    steps: [{ text: "Cook {{ing:l1}}.", ingredientRefs: ["l1"] }],
    prepTasks: [],
    defaultLeftoverPortions: 0,
    fingerprint: "fp",
    ingredientIds: ["garlic"],
    imagePaths: [],
    status: "active",
    createdBy: "u1",
    updatedBy: "u1",
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  };
}

const chunk = async (n: number) => (await db.doc(`recipeIndex/${n}`).get()).data() as IndexChunk | undefined;

describe("recipe index function", () => {
  beforeAll(clearFirestore);

  it("adds a summary on create and assigns the lowest chunk", async () => {
    const ref = db.collection("recipes").doc("idx-a");
    await ref.set(recipe("Chicken Piccata"));
    const s = await poll(async () => (await chunk(0))?.recipes?.["idx-a"], 20_000, "summary");
    expect(s).toMatchObject({ id: "idx-a", title: "Chicken Piccata", totalMin: 30, activeMin: 10, cuisine: "italian", ingredientNames: ["garlic"] });
    await poll(async () => (await ref.get()).data()?.indexChunk === 0, 20_000, "indexChunk");
    expect((await chunk(0))!.count).toBe(1);
  });

  it("updates the summary on edit", async () => {
    await db.doc("recipes/idx-a").update({ title: "Lemon Chicken Piccata", version: 2 });
    await poll(async () => (await chunk(0))?.recipes?.["idx-a"]?.title === "Lemon Chicken Piccata", 20_000, "title update");
  });

  it("trashed recipes leave the index and come back on restore, keeping their chunk", async () => {
    await db.doc("recipes/idx-a").update({ status: "trashed", trashedAt: new Date(), trashedBy: "u1", version: 3 });
    await poll(async () => !(await chunk(0))?.recipes?.["idx-a"], 20_000, "removal");
    expect((await chunk(0))!.count).toBe(1);
    await db.doc("recipes/idx-a").update({ status: "active", trashedAt: FieldValue.delete(), trashedBy: FieldValue.delete(), version: 4 });
    await poll(async () => (await chunk(0))?.recipes?.["idx-a"], 20_000, "re-entry");
  });

  it("pending duplicate imports are not indexed but get a chunk", async () => {
    await db.doc("recipes/idx-p").set(recipe("Pending Import", { status: "pendingDuplicateReview", possibleDuplicateOf: "idx-a" }));
    await poll(async () => (await db.doc("recipes/idx-p").get()).data()?.indexChunk === 0, 20_000, "chunk for pending");
    expect((await chunk(0))!.recipes["idx-p"]).toBeUndefined();
    expect((await chunk(0))!.count).toBe(2);
  });

  it("a write that can't change the index (stats, timestamps, the indexChunk echo) leaves the chunk alone", async () => {
    const before = (await db.doc("recipes/idx-a").get()).data()!;
    expect(indexUnchanged("idx-a", before, { ...before, cookCount: 3, updatedAt: new Date() })).toBe(true);
    expect(indexUnchanged("idx-a", { ...before, indexChunk: undefined }, before)).toBe(true);
    expect(indexUnchanged("idx-a", before, { ...before, title: "Other" })).toBe(false);
    expect(indexUnchanged("idx-a", before, { ...before, status: "trashed" })).toBe(false);
    expect(indexUnchanged("idx-a", null, before)).toBe(false);
    expect(indexUnchanged("idx-a", before, null)).toBe(false);
    const t0 = (await db.doc("recipeIndex/0").get()).updateTime!;
    await db.doc("recipes/idx-a").update({ cookCount: 3, updatedAt: FieldValue.serverTimestamp() });
    await new Promise((r) => setTimeout(r, 2500));
    expect((await db.doc("recipeIndex/0").get()).updateTime!.isEqual(t0)).toBe(true);
  });

  it("a full chunk sends new recipes to the next one", async () => {
    await db.doc("recipeIndex/0").update({ count: CHUNK_CAPACITY });
    await db.doc("recipes/idx-b").set(recipe("Beef Stew", { mainProtein: "beef" }));
    await poll(async () => (await chunk(1))?.recipes?.["idx-b"], 20_000, "chunk 1");
    expect((await db.doc("recipes/idx-b").get()).data()!.indexChunk).toBe(1);
  });

  it("deleting a recipe removes its summary and frees its place", async () => {
    await db.doc("recipes/idx-b").delete();
    await poll(async () => {
      const c = await chunk(1);
      return c && !c.recipes["idx-b"] && c.count === 0;
    }, 20_000, "delete");
  });
});
