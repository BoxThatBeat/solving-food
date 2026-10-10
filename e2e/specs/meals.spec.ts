// meals.spec.ts, M2 parts (TECHNICAL_SPECS §14.1): the saved meals list with edit, favourite, share; "Save as meal"
// from Create meal and from the plan; a saved meal picked in Create meal remembers which one. Recipe order while
// cooking and the review flow's "Save this meal?" and ratings are M3; here ratings only show from stats.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, planItems, seedPeriod, seedPlanItem } from "../pages/plan";

async function mealsNamed(name: string) {
  const snap = await adminDb.collection("meals").where("name", "==", name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; name: string; recipes: Array<{ recipeId: string; servingsMultiplier: number }>; createdBy: string });
}

const uniqueName = (base: string) => `${base} ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

test("Save as meal while creating it; then plan the saved meal again from the Saved meals tab (R5.8)", { tag: ["@R5.8", "@R5.2", "@R5.1", "@smoke"] }, async ({ page, household }) => {
  const a = await makePlanRecipe("Carnitas");
  const b = await makePlanRecipe("Pico", { lines: "Chop @tomato{400%g}." });
  const c = await makePlanRecipe("Tortillas", { lines: "Warm @corn tortilla{8}." });
  const name = uniqueName("Taco night");
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.createMeal({ recipes: [a.title, b.title, c.title], saveAs: name });
  await expect(plan.item(name)).toBeVisible();
  await expect(plan.item(name)).toContainText("Saved meal");

  const [meal] = await mealsNamed(name);
  expect(meal).toMatchObject({ name, createdBy: household.uid });
  expect(meal!.recipes.map((r) => r.recipeId)).toEqual([a.id, b.id, c.id]);
  const first = (await planItems(household.hid))[0]!;
  expect(first.savedMealId).toBe(meal!.id);

  // The saved meal is in the Meals list and can be picked in Create meal; the new item remembers it.
  await plan.createMeal({ savedMeal: name, mealType: "Dinner" });
  await expect(plan.item(name)).toHaveCount(2);
  const items = await planItems(household.hid);
  expect(items.every((i) => i.savedMealId === meal!.id)).toBe(true);
  await expect(plan.stripCount("dinner")).toHaveText("2/7");
});

test("Save as meal later, from a planned item (R5.8)", { tag: ["@R5.8"] }, async ({ page, household }) => {
  const a = await makePlanRecipe("Dal");
  const b = await makePlanRecipe("Rice", { lines: "Cook @white rice{300%g}." });
  const pid = await seedPeriod(household.hid);
  const id = await seedPlanItem(household.hid, pid, [a.id, b.id]);
  const name = uniqueName("Dal + rice");
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.item(`${a.title} + ${b.title}`).getByRole("button", { name: `${a.title} + ${b.title}`, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Meal name").fill(name);
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("notifications")).toContainText(`Saved “${name}” to Meals`);
  const [meal] = await mealsNamed(name);
  expect(meal!.recipes).toHaveLength(2);
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/planItems/${id}`).get()).data()?.savedMealId).toBe(meal!.id);
});

test("the Meals list: search, favourite, copy link, + Plan; the meal page edits name and recipes (R5.2)", { tag: ["@R5.2", "@R4.7", "@R4.6"] }, async ({ page, household, context, browserName }) => {
  const a = await makePlanRecipe("Shakshuka");
  const b = await makePlanRecipe("Granola bowl", { lines: "Top @plain greek yogurt{200%g} with @granola{60%g}.", tags: ["breakfast"] });
  const name = uniqueName("Sunday brunch");
  const ref = adminDb.collection("meals").doc();
  await ref.set({ name, recipes: [{ recipeId: a.id, servingsMultiplier: 1 }, { recipeId: b.id, servingsMultiplier: 1 }], createdBy: "someone", updatedBy: "someone", createdAt: new Date(), updatedAt: new Date() });

  await page.goto("/meals");
  await page.getByRole("searchbox", { name: "Search meals…" }).fill(name);
  const card = page.getByTestId("meal-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText(a.title);
  await expect(card).toContainText(b.title);

  await card.getByRole("button", { name: `Favourite ${name}` }).click();
  await expect(card.getByRole("button", { name: `Favourite ${name}` })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/favourites/meal_${ref.id}`).get()).exists).toBe(true);
  // Favourites filter in the shared filter sheet.
  await page.getByRole("button", { name: /^Filter and sort/ }).click();
  await page.getByRole("dialog", { name: "Filter & sort" }).getByRole("button", { name: /^★ Favourites/ }).click();
  await page.getByRole("button", { name: /^Show 1 meals/ }).click();
  await expect(card).toBeVisible();

  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await card.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByTestId("notifications")).toContainText(/Link copied|Copy this link/);
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/meals/${ref.id}`);

  // The meal page: rename, multiplier, remove a recipe.
  await card.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Meal name").fill(`${name} II`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} II` })).toBeVisible();
  await page.getByRole("group", { name: `Multiplier for ${a.title}` }).getByRole("button", { name: /^Increase/ }).click();
  await page.getByRole("button", { name: `Remove ${b.title} from this meal` }).click();
  await expect.poll(async () => (await ref.get()).data()!.recipes).toEqual([{ recipeId: a.id, servingsMultiplier: 1.5 }]);

  // + Add to plan opens Create meal with the meal selected.
  await page.getByRole("button", { name: "+ Add to plan" }).click();
  await expect(page.getByRole("dialog", { name: "Add to plan" }).getByTestId("create-meal-title")).toHaveText(`${name} II`);
});

test("a shared meal link opens without an account (R4.21)", { tag: ["@R5.2"] }, async ({ browser }) => {
  const a = await makePlanRecipe("Shared meal part");
  const name = uniqueName("Shared supper");
  const ref = adminDb.collection("meals").doc();
  await ref.set({ name, recipes: [{ recipeId: a.id, servingsMultiplier: 1 }], createdBy: "someone", updatedBy: "someone", createdAt: new Date(), updatedAt: new Date() });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/meals/${ref.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(a.title)).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await ctx.close();
});

test("saved meals show the household's rating, and recipes keep theirs (R5.3)", { tag: ["@R5.3"] }, async ({ page, household }) => {
  // Ratings are written by the review flow (M3) into stats; here they're seeded to check both are shown.
  const a = await makePlanRecipe("Rated recipe");
  const name = uniqueName("Rated meal");
  const ref = adminDb.collection("meals").doc();
  await ref.set({ name, recipes: [{ recipeId: a.id, servingsMultiplier: 1 }], createdBy: "someone", updatedBy: "someone", createdAt: new Date(), updatedAt: new Date() });
  await adminDb.doc(`households/${household.hid}/stats/meal_${ref.id}`).set({ timesCooked: 6, ratingSum: 54, ratingCount: 6 });
  await adminDb.doc(`households/${household.hid}/stats/recipe_${a.id}`).set({ timesCooked: 2, ratingSum: 15, ratingCount: 2 });
  await page.goto(`/meals?q=${encodeURIComponent(name)}`);
  const card = page.getByTestId("meal-card").filter({ hasText: name });
  await expect(card).toContainText("★ 9.0");
  await expect(card).toContainText("made 6×");
  await page.goto(`/recipes?q=${encodeURIComponent(a.title)}`);
  await expect(page.getByTestId("recipe-card").filter({ hasText: a.title })).toContainText("★ 7.5");
});
