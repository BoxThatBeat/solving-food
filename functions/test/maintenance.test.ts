// Weekly maintenance + purge cleanup (TECHNICAL_SPECS §4.4, §14): recipes trashed > 30 days are deleted; the
// onDocumentDeleted cleanup removes versions, images, meal and plan references, favourites, notes and stats in every
// household; cook events keep their titles. Plus the notification helper and ingredient-driven recomputation.
import { beforeAll, describe, expect, it } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { bucket, clearFirestore, db, fileExists, poll, seedIngredients } from "./helpers";
import { MAINTENANCE_DOC, pruneNotifications, runMaintenance, runScheduledMaintenance, sweepCommands, sweepOrphanUploads } from "../src/maintenance";
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
    await db.doc("recipes/old").set(recipe("Old", { status: "trashed", trashedAt: new Date(now - 31 * DAY), trashedBy: "u1", defaultLeftoverPortions: 4, leftoverMealType: "lunch" }));
    await db.doc("recipes/recent").set(recipe("Recent", { status: "trashed", trashedAt: new Date(now - 5 * DAY), trashedBy: "u1", imagePaths: [] }));
    await db.doc("recipes/keep").set(recipe("Keep", { imagePaths: [], defaultLeftoverPortions: 2, leftoverMealType: "breakfast" })); // an image shared with a live recipe would be kept
    await db.doc("recipes/old/versions/1").set({ title: "Old" });
    for (const size of [480, 960, 1920]) await bucket().file(`recipes/old/img1/${size}.webp`).save(Buffer.from("x"), { contentType: "image/webp" });
    // Two households reference it.
    for (const hid of ["h1", "h2"]) {
      await db.doc(`households/${hid}`).set({ name: hid });
      await db.doc(`households/${hid}/favourites/recipe_old`).set({ type: "recipe", targetId: "old" });
      await db.doc(`households/${hid}/notes/old`).set({ text: "n", updatedBy: "u1", updatedAt: new Date() });
      await db.doc(`households/${hid}/stats/recipe_old`).set({ timesCooked: 3, ratingSum: 0, ratingCount: 0 });
      await db.doc(`households/${hid}/planItems/solo`).set({ status: "planned", recipes: [{ recipeId: "old", servingsMultiplier: 1 }] });
      // M2 plan items: a saved taco night of both recipes, with the meal-prep lunches the old one covered.
      await db.doc(`households/${hid}/planItems/pair`).set({ periodId: "p1", kind: "meal", mealType: "dinner", servings: 4, savedMealId: "m2", name: "Mixed", status: "planned", coverage: { dinner: 1, lunch: 4, breakfast: 2 }, addedBy: "u1", recipes: [{ recipeId: "old", servingsMultiplier: 1 }, { recipeId: "keep", servingsMultiplier: 1 }] });
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
    // Meals are rewritten one by one: wait for m2 too (the full suite runs slower than this file alone).
    await poll(async () => (await db.doc("meals/m2").get()).data()?.recipes?.length === 1, 30_000, "mixed meal cleanup");
    expect((await db.doc("meals/m2").get()).data()!.recipes).toEqual([{ recipeId: "keep", servingsMultiplier: 1 }]);
    await poll(async () => !(await db.doc("households/h2/favourites/recipe_old").get()).exists, 30_000, "household cleanup");
    for (const hid of ["h1", "h2"]) {
      expect((await db.doc(`households/${hid}/notes/old`).get()).exists).toBe(false);
      expect((await db.doc(`households/${hid}/stats/recipe_old`).get()).exists).toBe(false);
      expect((await db.doc(`households/${hid}/planItems/solo`).get()).exists).toBe(false);
      const pair = (await db.doc(`households/${hid}/planItems/pair`).get()).data()!;
      expect(pair.recipes).toEqual([{ recipeId: "keep", servingsMultiplier: 1 }]);
      expect(pair.coverage).toEqual({ dinner: 1, breakfast: 2 }); // the old recipe's lunches no longer fill slots
      expect(pair.savedMealId).toBe("m2");
      expect((await db.doc(`households/${hid}/planItems/done`).get()).exists).toBe(true); // history is kept
      expect((await db.doc(`households/${hid}/cookEvents/e1`).get()).data()!.titles).toEqual(["Old"]);
    }
    expect((await db.doc("recipes/old/versions/1").get()).exists).toBe(false);
    await poll(async () => !(await fileExists("recipes/old/img1/480.webp")), 30_000, "image cleanup");
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

describe("maintenance refreshes stale index summaries (M2: tools and cost lines)", () => {
  it("rewrites summaries that lack the M2 fields and leaves current ones alone", async () => {
    await db.doc("recipes/fresh").set(recipe("Fresh", { imagePaths: [], tools: ["Wok"] }));
    const chunk = await poll(async () => {
      const r = (await db.doc("recipes/fresh").get()).data();
      return typeof r?.indexChunk === "number" ? String(r.indexChunk) : null;
    }, 30_000, "index chunk");
    // Simulate a summary written before M2.
    await poll(async () => (await db.doc(`recipeIndex/${chunk}`).get()).data()?.recipes?.fresh, 30_000, "summary");
    await db.doc(`recipeIndex/${chunk}`).update({ "recipes.fresh.tools": FieldValue.delete(), "recipes.fresh.lines": FieldValue.delete() });
    const report = await runMaintenance(Date.now());
    expect(report.summariesRefreshed).toBeGreaterThanOrEqual(1);
    const s = (await db.doc(`recipeIndex/${chunk}`).get()).data()!.recipes.fresh;
    expect(s.tools).toEqual(["Wok"]);
    expect(s.lines).toEqual({ egg: 50 });
    expect((await runMaintenance(Date.now())).summariesRefreshed).toBe(0);
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
    // M10 (R4.30): new nutrition facts on an ingredient (pnpm ingredients:upload) give recipes their panel.
    await db.doc("ingredients/mystery-paste").update({ nutrients: { kcal: 300, fatG: 10, sodiumMg: 400 }, nutrientSource: "test", updatedAt: FieldValue.serverTimestamp() });
    const n = await poll(async () => {
      const d = (await db.doc("recipes/paste").get()).data()!;
      return d.nutrition ? d : null;
    }, 30_000, "nutrition");
    expect(n.nutrition).toEqual({ kcal: 150, fatG: 5, sodiumMg: 200 });
    expect(n.version).toBe(1);
  });
});

describe("maintenance M22: stuck commands, retention, orphaned uploads, failure alert", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("fails stuck commands and prunes applied or failed ones older than 30 days, in every household", async () => {
    const now = Date.now();
    const at = (ms: number) => Timestamp.fromMillis(ms);
    await db.doc("households/hm").set({ name: "M" });
    const cmd = (status: string, extra: Record<string, unknown>) => ({ type: "addSupply", payload: { ingredientId: "rice", amount: 1, location: "pantry" }, uid: "m-user", status, ...extra });
    // Written as "held" so the emulator's trigger skips them, then given their real state.
    await db.doc("households/hm/commands/stuck").set(cmd("held", { createdAt: at(now - 5 * 3_600_000) }));
    await db.doc("households/hm/commands/old-applied").set(cmd("held", { createdAt: at(now - 40 * DAY), appliedAt: at(now - 40 * DAY) }));
    await db.doc("households/hm/commands/old-failed").set(cmd("held", { createdAt: at(now - 40 * DAY), appliedAt: at(now - 31 * DAY), error: "x" }));
    await db.doc("households/hm/commands/recent").set(cmd("held", { createdAt: at(now - 2 * DAY), appliedAt: at(now - 2 * DAY) }));
    await new Promise((r) => setTimeout(r, 3000));
    await db.doc("households/hm/commands/stuck").update({ status: "pending" });
    await db.doc("households/hm/commands/old-applied").update({ status: "applied" });
    await db.doc("households/hm/commands/old-failed").update({ status: "failed" });
    await db.doc("households/hm/commands/recent").update({ status: "applied" });

    expect(await sweepCommands(now)).toEqual({ stuck: 1, pruned: 2 });
    expect((await db.doc("households/hm/commands/stuck").get()).data()).toMatchObject({ status: "failed", error: expect.stringMatching(/didn't finish/) });
    expect((await db.doc("households/hm/commands/old-applied").get()).exists).toBe(false);
    expect((await db.doc("households/hm/commands/old-failed").get()).exists).toBe(false);
    expect((await db.doc("households/hm/commands/recent").get()).exists).toBe(true);
    const notes = await db.collection("users/m-user/notifications").get();
    expect(notes.docs.some((d) => /^Couldn't add to supply: it didn't finish/.test(d.data().message))).toBe(true);
  });

  it("prunes notifications dismissed more than 30 days ago, never undismissed ones", async () => {
    const now = Date.now();
    const n = (dismissedAt: unknown) => ({ kind: "info", message: "m", createdAt: Timestamp.fromMillis(now - 60 * DAY), dismissedAt });
    await db.doc("users/n-user/notifications/old").set(n(Timestamp.fromMillis(now - 31 * DAY)));
    await db.doc("users/n-user/notifications/recent").set(n(Timestamp.fromMillis(now - DAY)));
    await db.doc("users/n-user/notifications/open").set(n(null));
    expect(await pruneNotifications(now)).toBeGreaterThanOrEqual(1);
    const left = (await db.collection("users/n-user/notifications").get()).docs.map((d) => d.id).sort();
    expect(left).toEqual(["open", "recent"]);
  });

  it("sweeps recipe-photos/, imports/ and images of recipes that don't exist, after 3 days", async () => {
    const files = ["recipe-photos/u1/p.jpg", "imports/h1/x.zip", "recipes/ghost-recipe/img/480.webp", "recipes/real-recipe/img/480.webp"];
    for (const f of files) await bucket().file(f).save(Buffer.from("x"), { contentType: f.endsWith(".zip") ? "application/zip" : "image/webp" });
    await db.doc("recipes/real-recipe").set({ title: "Real" });
    // Just uploaded: kept.
    await sweepOrphanUploads(Date.now());
    for (const f of files) expect(await fileExists(f), f).toBe(true);
    // Four days on: everything unclaimed goes, a live recipe's image stays.
    await sweepOrphanUploads(Date.now() + 4 * DAY);
    expect(await fileExists("recipe-photos/u1/p.jpg")).toBe(false);
    expect(await fileExists("imports/h1/x.zip")).toBe(false);
    expect(await fileExists("recipes/ghost-recipe/img/480.webp")).toBe(false);
    expect(await fileExists("recipes/real-recipe/img/480.webp")).toBe(true);
  });

  it("records each run; the second failure in a row tells the owner, a success resets the count", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("boom");
    };
    const ok = async () => ({ purged: [], dropFilesSwept: 0, importLogsDeleted: 0, summariesRefreshed: 0, stuckCommandsFailed: 0, commandsPruned: 0, notificationsPruned: 0, orphanFilesSwept: 0 });
    const ownerNotes = async () => (await db.collection("users/maint-owner/notifications").get()).docs.map((d) => String(d.data().message));
    await expect(runScheduledMaintenance(Date.now(), { ownerUid: "maint-owner", run: boom })).rejects.toThrow("boom");
    expect((await db.doc(MAINTENANCE_DOC).get()).data()).toMatchObject({ lastStatus: "failed", consecutiveFailures: 1, lastError: "boom" });
    expect(await ownerNotes()).toEqual([]);
    await expect(runScheduledMaintenance(Date.now(), { ownerUid: "maint-owner", run: boom })).rejects.toThrow("boom");
    expect((await db.doc(MAINTENANCE_DOC).get()).data()?.consecutiveFailures).toBe(2);
    expect(await ownerNotes()).toEqual([expect.stringMatching(/maintenance failed 2 weeks in a row \(boom\)/)]);
    await runScheduledMaintenance(Date.now(), { ownerUid: "maint-owner", run: ok });
    const d = (await db.doc(MAINTENANCE_DOC).get()).data()!;
    expect(d).toMatchObject({ lastStatus: "ok", consecutiveFailures: 0 });
    expect(d.lastError).toBeUndefined();
  });
});
