// plan.spec.ts, M2 parts (TECHNICAL_SPECS §14.1): Create meal with one recipe, with several, and from a saved meal;
// the Add to plan shortcut; remove; default servings; meal types; the coverage strip; the budget meter; landing.
// Expiry badges, protein goals, and receiving are later milestones.
import { adminDb } from "../fixtures/admin";
import { forgetIngredients, seedRecipeId } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { CHICKEN_LINES, cook, makePlanRecipe, PlanPage, planItems, seedPeriod, seedPlanItem } from "../pages/plan";

test.describe("Create meal (R5.7)", () => {
  test("one recipe: pick, set meal type and servings, add; the item shows in the plan", { tag: ["@R5.7", "@R5.5", "@R6.1", "@smoke"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Chicken spinach skillet");
    const plan = new PlanPage(page);
    await plan.goto();
    await expect(page.getByText("Nothing planned yet.")).toBeVisible();

    await plan.createMeal({ recipes: [r.title], mealType: "Lunch", servings: 2 });
    await expect(plan.item(r.title)).toBeVisible();
    await expect(page.getByRole("region", { name: "Lunch" })).toContainText(r.title);
    await expect(plan.item(r.title)).toContainText("2 servings");

    const [it] = await planItems(household.hid);
    expect(it).toMatchObject({ kind: "meal", mealType: "lunch", servings: 2, status: "planned", recipes: [{ recipeId: r.id, servingsMultiplier: 1 }], coverage: { lunch: 1 }, addedBy: household.uid });
    expect(it!.savedMealId).toBeUndefined();
  });

  test("several recipes become one meal (R5.1); a snack fills no strip cell", { tag: ["@R5.1", "@R5.5", "@R5.7"] }, async ({ page, household }) => {
    const a = await makePlanRecipe("Carnitas");
    const b = await makePlanRecipe("Pico de gallo", { lines: "Chop @tomato{400%g} and @onion{1}." });
    const plan = new PlanPage(page);
    await plan.goto();
    await plan.createMeal({ recipes: [a.title, b.title] });
    const item = plan.item(`${a.title} + ${b.title}`);
    await expect(item).toBeVisible();
    await expect(item.getByRole("link", { name: new RegExp(a.title) })).toBeVisible();
    await expect(item.getByRole("link", { name: new RegExp(b.title) })).toBeVisible();
    await expect(plan.stripCount("dinner")).toHaveText("1/7");

    await plan.createMeal({ recipes: [b.title], mealType: "Snack" });
    await expect(page.getByRole("region", { name: "Snack" })).toContainText(b.title);
    await expect(plan.stripCount("dinner")).toHaveText("1/7");
    const items = await planItems(household.hid);
    expect(items.find((i) => i.mealType === "snack")!.coverage).toEqual({});
    expect(items.find((i) => i.mealType === "dinner")!.recipes).toHaveLength(2);
  });

  test("servings default to the household's default servings (R11.12)", { tag: ["@R11.12"] }, async ({ page, household }) => {
    await adminDb.doc(`households/${household.hid}`).update({ defaultServings: 6 });
    const r = await makePlanRecipe("Six-serving stew");
    const plan = new PlanPage(page);
    await plan.goto();
    await plan.createMeal({ recipes: [r.title] });
    await expect(plan.item(r.title)).toContainText("6 servings");
  });

  test("Add to plan on a recipe page and on a recipe card opens Create meal with it selected (R5.7)", { tag: ["@R5.7"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Shortcut traybake");
    await page.goto(`/recipes/${r.id}`);
    await page.getByRole("button", { name: "+ Plan" }).click();
    const plan = new PlanPage(page);
    await expect(page.getByRole("dialog", { name: "Add to plan" }).getByTestId("create-meal-title")).toHaveText(r.title);
    await plan.finish({ mealType: "Dinner" });
    await expect(page.getByTestId("notifications")).toContainText("Added to plan · dinner");

    await page.goto(`/recipes?q=${encodeURIComponent(r.title)}`);
    await page.getByRole("button", { name: `Add ${r.title} to plan` }).click();
    await plan.finish({ mealType: "Lunch" });
    expect((await planItems(household.hid)).map((i) => i.mealType).sort()).toEqual(["dinner", "lunch"]);
  });

  test("a trashed recipe has no Add to plan, and existing items show it as in Trash (R4.26)", async ({ page, household }) => {
    const r = await makePlanRecipe("Soon trashed");
    const pid = await seedPeriod(household.hid);
    await seedPlanItem(household.hid, pid, [r.id]);
    await adminDb.doc(`recipes/${r.id}`).update({ status: "trashed", trashedAt: new Date(), trashedBy: "x" });
    await page.goto(`/recipes/${r.id}`);
    await expect(page.getByText(/Recipe in Trash/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Plan" })).toHaveCount(0);
    const plan = new PlanPage(page);
    await plan.goto();
    await expect(plan.item(r.title)).toContainText("Recipe in Trash");
  });
});

test.describe("the plan list", () => {
  test("edit servings and meal type in the item sheet; remove with undo", { tag: ["@R6.1", "@R5.5"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Editable bake");
    const pid = await seedPeriod(household.hid);
    const id = await seedPlanItem(household.hid, pid, [r.id]);
    const plan = new PlanPage(page);
    await plan.goto();
    await plan.item(r.title).getByRole("button", { name: r.title, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: r.title });
    await sheet.getByRole("button", { name: "Breakfast", exact: true }).click();
    await sheet.getByRole("button", { name: "More servings" }).click();
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Breakfast" })).toContainText(r.title);
    await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/planItems/${id}`).get()).data()).toMatchObject({ mealType: "breakfast", servings: 5, coverage: { breakfast: 1 } });

    await plan.item(r.title).getByRole("button", { name: `Remove ${r.title} from the plan` }).click();
    await expect(plan.item(r.title)).toHaveCount(0);
    await page.getByTestId("notifications").getByRole("button", { name: "Undo" }).click();
    await expect(plan.item(r.title)).toBeVisible();
  });

  test("the plan list uses the shared filter and sort component (R4.7)", { tag: ["@R4.7", "@R6.1"] }, async ({ page, household }) => {
    const a = await makePlanRecipe("Filter lunch");
    const b = await makePlanRecipe("Filter dinner");
    const pid = await seedPeriod(household.hid);
    await seedPlanItem(household.hid, pid, [a.id], { mealType: "lunch", coverage: { lunch: 1 } });
    await seedPlanItem(household.hid, pid, [b.id]);
    const plan = new PlanPage(page);
    await plan.goto();
    await expect(plan.item(a.title)).toBeVisible();
    await page.getByRole("button", { name: /^Filter and sort/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filter & sort" });
    await sheet.getByRole("group", { name: "Meal type", exact: true }).getByRole("button", { name: /^Lunch/ }).click();
    await sheet.getByRole("button", { name: /^Show 1 planned meals/ }).click();
    await expect(page).toHaveURL(/meal=lunch/);
    await expect(plan.item(a.title)).toBeVisible();
    await expect(plan.item(b.title)).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Search this period's meals…" }).fill("Filter dinner");
    await expect(page.getByText("No planned meals match.")).toBeVisible();
  });
});

test.describe("coverage strip (R6.2)", () => {
  test("one row per planned meal type, cells fill left to right, n/N, overflow, not clickable; meals aren't tied to days (R5.4)", { tag: ["@R6.2", "@R5.4", "@R11.13"] }, async ({ page, household }) => {
    await adminDb.doc(`households/${household.hid}`).update({ plannedMealTypes: ["lunch", "dinner"] });
    const r = await makePlanRecipe("Strip filler");
    const prep = await makePlanRecipe("Prep batch", { lines: CHICKEN_LINES, leftovers: 4 });
    const pid = await seedPeriod(household.hid, { days: 3 });
    for (let i = 0; i < 3; i++) await seedPlanItem(household.hid, pid, [r.id]);
    await seedPlanItem(household.hid, pid, [r.id], { mealType: "breakfast", coverage: { breakfast: 1 } });
    const plan = new PlanPage(page);
    await plan.goto();
    const strip = page.getByTestId("coverage-strip");
    await expect(strip.getByRole("row")).toHaveCount(3); // header + lunch + dinner; breakfast isn't planned
    await expect(strip.getByRole("rowheader", { name: "Breakfast" })).toHaveCount(0);
    await expect(plan.stripCount("dinner")).toHaveText("3/3");
    await expect(page.getByTestId("strip-dinner").locator("td[data-state=planned]")).toHaveCount(3);
    // Day cells are labelled with weekday and date for orientation, and none is interactive.
    await expect(strip.getByRole("columnheader")).toHaveCount(5);
    await expect(strip.getByRole("button")).toHaveCount(0);
    await expect(strip.getByRole("link")).toHaveCount(0);

    // A fourth dinner overflows; a meal-prep recipe fills lunch cells as soon as it's planned.
    await plan.createMeal({ recipes: [prep.title] });
    await expect(plan.stripCount("dinner")).toHaveText("4/3 · +1");
    await expect(plan.stripCount("lunch")).toHaveText("4/3 · +1");
    // The Create meal sheet never asks for a day.
    const sheet = await plan.openCreateMeal();
    await expect(sheet.getByText(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)).toHaveCount(0);
  });

  test("cooked meals are solid, planned ones outlined", { tag: ["@R6.2"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Solid or outlined");
    const pid = await seedPeriod(household.hid);
    await seedPlanItem(household.hid, pid, [r.id], { status: "cooked" });
    await seedPlanItem(household.hid, pid, [r.id]);
    const plan = new PlanPage(page);
    await plan.goto();
    const row = page.getByTestId("strip-dinner");
    await expect(row.locator("td").nth(0)).toHaveAttribute("data-state", "cooked");
    await expect(row.locator("td").nth(1)).toHaveAttribute("data-state", "planned");
    await expect(row.locator("td").nth(2)).toHaveAttribute("data-state", "open");
  });
});

test.describe("budget meter (R6.3–R6.5)", () => {
  test("starts at the budget and goes down by what the next order costs", { tag: ["@R6.3", "@smoke"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Budget chicken");
    await seedPeriod(household.hid, { budgetCents: 10000 });
    const plan = new PlanPage(page);
    await plan.goto();
    await expect(plan.budgetLeft()).toHaveText("$100.00");
    await plan.createMeal({ recipes: [r.title] });
    // 1 kg chicken thighs $12.99 + 312 g baby spinach $4.99; olive oil is free-use.
    await expect(plan.budgetLeft()).toHaveText("$82.02");
    await expect(plan.item(r.title)).toContainText("+$17.98 TO BUY");
    // The same recipe again: still inside the packs already bought, so it costs nothing extra.
    await plan.createMeal({ recipes: [r.title], servings: 2 });
    await expect(plan.budgetLeft()).toHaveText("$82.02");
  });

  test("ingredients on an ordered list cost nothing extra (R6.3)", { tag: ["@R6.3"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Already ordered");
    const pid = await seedPeriod(household.hid, { budgetCents: 10000 });
    await adminDb.doc(`households/${household.hid}/groceryLists/o1`).set({
      periodId: pid,
      status: "ordered",
      createdAt: new Date(),
      orderedAt: new Date(),
      orderedBy: household.uid,
      items: { "chicken-thigh": { ingredientId: "chicken-thigh", amount: 1000, measure: "g", packs: 1, productName: "Chicken thigh", storeId: "pc-express", estPriceCents: 1299, source: "plan", checked: false } },
    });
    await seedPlanItem(household.hid, pid, [r.id]);
    const plan = new PlanPage(page);
    await plan.goto();
    await expect(plan.budgetLeft()).toHaveText("$95.01"); // only the spinach is left to buy
  });

  test("going over turns the meter red and negative, and never blocks adding (R6.5)", { tag: ["@R6.5"] }, async ({ page, household }) => {
    const r = await makePlanRecipe("Over budget");
    await seedPeriod(household.hid, { budgetCents: 1000 });
    const plan = new PlanPage(page);
    await plan.goto();
    await plan.createMeal({ recipes: [r.title] });
    await expect(plan.budgetLeft()).toHaveText("−$7.98");
    await expect(plan.meter()).toHaveAttribute("data-over", "true");
    await plan.createMeal({ recipes: [r.title], servings: 12 });
    await expect(plan.item(r.title)).toHaveCount(2);
    await expect(plan.budgetLeft()).toHaveText(/^−\$/);
  });

  test("unknown prices are counted as $0 and flagged", { tag: ["@R6.3"] }, async ({ page, household }) => {
    const ing = `e2e-unpriced-${Math.random().toString(36).slice(2, 8)}`;
    await adminDb.doc(`ingredients/${ing}`).set({ name: ing.replace(/-/g, " "), aliases: [], category: "pantry", defaultLocation: "pantry", allowedMeasures: ["weight"], canonicalUnit: "g", proteinPer100g: 1, shelfLifeDays: {}, freezable: false, isStaple: false, freeUse: false, needsReview: false });
    forgetIngredients();
    const r = await makePlanRecipe("Mystery stew", { lines: `Simmer @${ing.replace(/-/g, " ")}{200%g}.` });
    await seedPeriod(household.hid);
    const plan = new PlanPage(page);
    await plan.goto();
    await plan.createMeal({ recipes: [r.title] });
    await expect(plan.meter()).toContainText("1 price unknown");
  });
});

test.describe("landing page (R12)", () => {
  test("lands on Plan when the current period has meals, else on Recipes", async ({ page, household }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/recipes$/);
    const id = await seedRecipeId("Greek Salad");
    const pid = await seedPeriod(household.hid);
    await seedPlanItem(household.hid, pid, [id]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/plan$/);
  });
});

void cook;
