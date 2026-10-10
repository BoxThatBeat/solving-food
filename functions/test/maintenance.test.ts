// Weekly maintenance + purge cleanup (TECHNICAL_SPECS §4.4, §14): recipes trashed > 30 days are deleted; the
// onDocumentDeleted cleanup removes versions, images, meal and plan references, favourites, notes and stats in every
// household; cook events keep their titles. Plus the notification helper and ingredient-driven recomputation.
import { beforeAll, describe, expect, it } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { bucket, clearFirestore, db, fileExists, poll, seedIngredients } from "./helpers";
import { runMaintenance } from "../src/maintenance";
import { notify } from "../src/notify";

const DAY = 86_400_000;

function recipe(title: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    slug: "x",
    servings: 2,
    prepMin: 5,
    cookMin: 5,
    cuisine: "other",
    mainProtein: "none",
    tags: [],
    tools: [],
    ingredients: [{ id: "l1", ingredientId: "egg", amount: 2, measure: "count", canonicalAmount: 100, displayText: "eggs", optional: false }],
    steps: [{ text: "Boil {{ing:l1}}.", ingredientRefs: ["l1"] }],
    prepTasks: [],
    defaultLeftoverPortions: 0,
    fingerprint: "fp",
    ingredientIds: ["egg"],
    imagePaths: ["recipes/old/img1"],
    status: "active",
    createdBy: "u1",
    updatedBy: "u1",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

describe("maintenance: 30-day trash purge and cleanup", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedIngredients();
  });

  it("purges only recipes trashed more than 30 days ago, and the cleanup follows everywhere", async () => {
    const now = Date.now();
    await db.doc("recipes/old").set(recipe("Old", { status: "trashed", trashedAt: new Date(now - 31 * DAY), trashedBy: "u1" }));
    await db.doc("recipes/recent").set(recipe("Recent", { status: "trashed", trashedAt: new Date(now - 5 * DAY), trashedBy: "u1" }));
    await db.doc("recipes/keep").set(recipe("Keep"));
    await db.doc("recipes/old/versions/1").set({ title: "Old" });
    for (const size of [480, 960, 1920]) await bucket().file(`recipes/old/img1/${size}.webp`).save(Buffer.from("x"), { contentType: "image/webp" });
    // Two households reference it.
    for (const hid of ["h1", "h2"]) {
      await db.doc(`households/${hid}`).set({ name: hid });
      await db.doc(`households/${hid}/favourites/recipe_old`).set({ type: "recipe", targetId: "old" });
      await db.doc(`households/${hid}/notes/old`).set({ text: "n", updatedBy: "u1", updatedAt: new Date() });
      await db.doc(`households/${hid}/stats/recipe_old`).set({ timesCooked: 3, ratingSum: 0, ratingCount: 0 });
      await db.doc(`households/${hid}/planItems/solo`).set({ status: "planned", recipes: [{ recipeId: "old", servingsMultiplier: 1 }] });
      await db.doc(`households/${hid}/planItems/pair`).set({ status: "planned", recipes: [{ recipeId: "old", servingsMultiplier: 1 }, { recipeId: "keep", servingsMultiplier: 1 }] });
      await db.doc(`households/${hid}/planItems/done`).set({ status: "cooked", recipes: [{ recipeId: "old", servingsMultiplier: 1 }] });
      await db.doc(`households/${hid}/cookEvents/e1`).set({ recipeIds: ["old"], titles: ["Old"] });
    }
    await db.doc("meals/m1").set({ name: "Only old", recipes: [{ recipeId: "old", servingsMultiplier: 1 }] });
    await db.doc("meals/m2").set({ name: "Mixed", recipes: [{ recipeId: "old", servingsMultiplier: 1 }, { recipeId: "keep", servingsMultiplier: 1 }] });

    const report = await runMaintenance(now);
    expect(report.purged).toEqual(["old"]);
    expect((await db.doc("recipes/old").get()).exists).toBe(false);
    expect((await db.doc("recipes/recent").get()).exists).toBe(true);

    // The onDocumentDeleted cleanup (running in the emulator).
    await poll(async () => !(await db.doc("meals/m1").get()).exists, 30_000, "meal cleanup");
    expect((await db.doc("meals/m2").get()).data()!.recipes).toEqual([{ recipeId: "keep", servingsMultiplier: 1 }]);
    await poll(async () => !(await db.doc("households/h2/favourites/recipe_old").get()).exists, 30_000, "household cleanup");
    for (const hid of ["h1", "h2"]) {
      expect((await db.doc(`households/${hid}/notes/old`).get()).exists).toBe(false);
      expect((await db.doc(`households/${hid}/stats/recipe_old`).get()).exists).toBe(false);
      expect((await db.doc(`households/${hid}/planItems/solo`).get()).exists).toBe(false);
      expect((await db.doc(`households/${hid}/planItems/pair`).get()).data()!.recipes).toEqual([{ recipeId: "keep", servingsMultiplier: 1 }]);
      expect((await db.doc(`households/${hid}/planItems/done`).get()).exists).toBe(true); // history is kept
      expect((await db.doc(`households/${hid}/cookEvents/e1`).get()).data()!.titles).toEqual(["Old"]);
    }
    expect((await db.doc("recipes/old/versions/1").get()).exists).toBe(false);
    expect(await fileExists("recipes/old/img1/480.webp")).toBe(false);
  });

  it("sweeps drop-folder leftovers older than a day", async () => {
    await bucket().file("recipe-drop/u1/stray.jpg").save(Buffer.from("x"), { contentType: "image/jpeg" });
    const r1 = await runMaintenance(Date.now());
    expect(r1.dropFilesSwept).toBe(0);
    const r2 = await runMaintenance(Date.now() + 2 * DAY);
    expect(r2.dropFilesSwept).toBe(1);
    expect(await fileExists("recipe-drop/u1/stray.jpg")).toBe(false);
  });
});

describe("notification helper (R12.1)", () => {
  it("writes an undismissed notification for the user", async () => {
    const id = await notify("u9", { kind: "error", message: "x.cook: missing title", link: "/drop" });
    const d = (await db.doc(`users/u9/notifications/${id}`).get()).data()!;
    expect(d).toMatchObject({ kind: "error", message: "x.cook: missing title", link: "/drop", dismissedAt: null });
    expect(d.createdAt).toBeTruthy();
  });
  it("truncates very long messages", async () => {
    const id = await notify("u9", { kind: "info", message: "y".repeat(2000) });
    expect(((await db.doc(`users/u9/notifications/${id}`).get()).data()!.message as string).length).toBe(500);
  });
});

describe("ingredient edits recompute recipe protein (§5)", () => {
  it("adding protein to an ingredient updates the recipes that use it", async () => {
    await db.doc("ingredients/mystery-paste").set({
      name: "mystery paste",
      aliases: [],
      category: "pantry",
      defaultLocation: "pantry",
      allowedMeasures: ["weight"],
      canonicalUnit: "g",
      shelfLifeDays: { pantry: 30 },
      freezable: false,
      isStaple: false,
      freeUse: false,
      needsReview: true,
    });
    await db.doc("recipes/paste").set(
      recipe("Paste Toast", {
        ingredients: [{ id: "l1", ingredientId: "mystery-paste", amount: 100, measure: "g", canonicalAmount: 100, displayText: "paste", optional: false }],
        ingredientIds: ["mystery-paste"],
        proteinApproximate: true,
        imagePaths: [],
      }),
    );
    await db.doc("ingredients/mystery-paste").update({ proteinPer100g: 20, needsReview: false, updatedAt: FieldValue.serverTimestamp() });
    const r = await poll(async () => {
      const d = (await db.doc("recipes/paste").get()).data()!;
      return d.proteinApproximate === false ? d : null;
    }, 30_000, "recompute");
    expect(r.proteinPerServingG).toBe(10);
    expect(r.version).toBe(1);
  });
});
