// optimiser.spec.ts (TECHNICAL_SPECS §14.1, Planning/M5): "n dinners under $x" proposes a whole set under budget;
// Next shows a different good set, Back returns instantly; Accept adds every recipe; the protein toggle only uses
// recipes that meet the goal; when good sets run out it says "No more good combinations".
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, planItems, seedPeriod } from "../pages/plan";

/** Cheap dinners of different cuisines and proteins (lentils, rice, eggs, pasta): a set of four fits in $60. */
async function cheapDinners() {
  const lines = [
    ["indian", "legumes", "Simmer @dried red lentil{300%g} with @white rice{300%g}."],
    ["italian", "none", "Boil @spaghetti{400%g} and toss with @garlic{3%clove}."],
    ["korean", "eggs", "Fry @egg{4} over @white rice{300%g}."],
    ["mexican", "legumes", "Warm @canned black bean{540%ml} with @white rice{200%g}."],
    ["chinese", "tofu", "Fry @firm tofu{400%g} with @white rice{300%g}."],
    ["greek", "legumes", "Toss @canned chickpea{540%ml} with @cucumber{1}."],
    ["japanese", "eggs", "Steam @egg{3} with @white rice{200%g}."],
    ["thai", "tofu", "Stir-fry @firm tofu{300%g} with @spaghetti{200%g}."],
  ] as const;
  for (const [cuisine, protein, l] of lines) await makePlanRecipe(`Cheap ${cuisine}`, { lines: l, cuisine, protein });
}

test("4 dinners under $60: a set under budget, Next / Back, Accept adds all four (R6.18, R6.19, R6.20)", { tag: ["@R6.18", "@R6.19", "@R6.20"] }, async ({ page, household }) => {
  await cheapDinners();
  await seedPeriod(household.hid);
  const plan = new PlanPage(page);
  await plan.goto();
  const card = page.getByTestId("optimiser");
  await expect(card.getByRole("group", { name: "How many meals" })).toContainText("4");
  await expect(card.getByRole("group", { name: "Budget for the set" })).toContainText("$60");
  await card.getByRole("button", { name: "Find sets" }).click();
  const set = card.getByTestId("optimiser-set");
  await expect(set).toBeVisible({ timeout: 30_000 });
  await expect(set).toContainText("SET 1");
  const recipes = set.getByRole("list", { name: "Recipes in this set" }).getByRole("listitem");
  await expect(recipes).toHaveCount(4);
  const cost = Number(/\$(\d+\.\d\d) TO BUY/.exec((await set.innerText()) ?? "")?.[1]);
  expect(cost).toBeLessThanOrEqual(60);
  const first = await recipes.allInnerTexts();

  await card.getByRole("button", { name: "Next →" }).click();
  await expect(set).toContainText("SET 2", { timeout: 30_000 });
  const second = await recipes.allInnerTexts();
  expect(second).not.toEqual(first);
  await card.getByRole("button", { name: "← Back" }).click();
  await expect(set).toContainText("SET 1");
  expect(await recipes.allInnerTexts()).toEqual(first);

  await card.getByRole("button", { name: "Accept · add 4" }).click();
  await expect(page.getByText("Added 4 dinners to the plan")).toBeVisible();
  await expect.poll(async () => (await planItems(household.hid)).length).toBe(4);
  const items = await planItems(household.hid);
  expect(items.every((i) => i.mealType === "dinner" && i.status === "planned")).toBe(true);
  // They can be removed one by one afterwards (R6.20): each is its own planned meal.
  await expect(page.getByTestId("plan-item")).toHaveCount(4);
});

test("only recipes that meet the protein goal, until there are no more good combinations (R6.16, R6.19)", { tag: ["@R6.16", "@R6.19"] }, async ({ page, household }) => {
  await seedPeriod(household.hid);
  await adminDb.doc(`households/${household.hid}`).update({ "settings.proteinGoals": { dinner: 40 } });
  const plan = new PlanPage(page);
  await plan.goto();
  const card = page.getByTestId("optimiser");
  await card.getByRole("button", { name: "Fewer meals" }).click();
  await card.getByRole("button", { name: "Fewer meals" }).click();
  await card.getByRole("button", { name: "Fewer meals" }).click();
  await card.getByRole("checkbox", { name: /Only recipes that meet the protein goal \(40 g\)/ }).check();
  await card.getByRole("button", { name: "Find sets" }).click();
  const set = card.getByTestId("optimiser-set");
  const none = card.getByText(/No set fits|No more good combinations/);
  await expect(set.or(none).first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 60 && !(await none.isVisible()); i++) {
    const meta = await set.getByRole("listitem").first().innerText();
    const g = Number(/(\d+) G/.exec(meta.toUpperCase())?.[1]);
    expect(g).toBeGreaterThanOrEqual(40);
    await card.getByRole("button", { name: "Next →" }).click();
    await page.waitForTimeout(150);
  }
  await expect(none).toBeVisible();
  // Relax options are offered.
  await expect(card.getByRole("button", { name: "+$10 budget" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Any protein" })).toBeVisible();
});
