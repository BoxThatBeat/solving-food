// core-loop.spec.ts (TECHNICAL_SPECS §14.1, PRD §3 steps 2–6): plan → grocery list → ordered → confirm with the freeze
// prompt → cook → review later → supply, stats, and history updated. (The optimiser step arrives with M5.)
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { PlanPage } from "../pages/plan";
import { commandsSettled, expectSupply, makeCookRecipe, supplyDoc } from "../pages/supply";

test("the core loop, end to end", { tag: ["@smoke", "@R7.8", "@R7.9", "@R9.3", "@R9.4", "@R10.1"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Core loop chicken", { leftovers: 2 });
  // Meat goes to Costco (bulk), so the chicken arrives as a bulk buy.
  await adminDb.doc(`households/${household.hid}/sourcingRules/cat_meat`).set({ match: { category: "meat" }, storeId: "costco" });

  // 2. Plan.
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.createMeal({ recipes: [r.title], mealType: "Dinner", servings: 4 });
  await expect(plan.item(r.title)).toBeVisible();

  // 3–4. Grocery list → ordered → arrived, freezing half the chicken.
  await page.goto("/grocery");
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("store-inStore")).toContainText("Chicken thigh");
  await page.getByRole("button", { name: "Mark ordered without copying" }).click();
  await expect(page.getByTestId("ordered-list")).toBeVisible();
  await page.getByRole("button", { name: /Groceries arrived\? Confirm/ }).click();
  await page.getByRole("dialog", { name: "Confirm groceries" }).getByRole("button", { name: "Everything arrived · add to supply" }).click();
  const bulk = page.getByRole("dialog", { name: "Bulk buy" });
  await bulk.getByRole("button", { name: /^Freeze/ }).click();
  expect(await commandsSettled(household.hid, 1)).toEqual([]);
  const chicken = (await supplyDoc(household.hid, "chicken-thigh"))!;
  expect(chicken.canonicalAmount).toBe(1000);
  expect(chicken.lots.some((l) => l.location === "freezer")).toBe(true);
  await expectSupply(household.hid, "baby-spinach", 312);

  // 5. Cook: Done cooking deducts the defaults at once.
  await plan.goto();
  await plan.item(r.title).getByRole("button", { name: `Cook ${r.title}` }).click();
  await page.getByRole("button", { name: "Start step mode →" }).click();
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await page.getByRole("button", { name: "Review later" }).click();
  await expectSupply(household.hid, "chicken-thigh", 400);
  await expectSupply(household.hid, "baby-spinach", 172);

  // 6. Review later from Pending reviews: used a bit less spinach.
  await page.getByTestId("pending-reviews").getByRole("link", { name: `Review ${r.title}` }).click();
  await page.getByTestId("rating-card").getByRole("button", { name: "9 out of 10" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  const spinach = page.getByTestId("used-row").filter({ hasText: "Baby spinach" });
  await spinach.getByRole("button", { name: "Less Baby spinach" }).click(); // 140 → 115
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Save & update supply" }).click();
  expect(await commandsSettled(household.hid, 3)).toEqual([]);
  await expectSupply(household.hid, "baby-spinach", 197);

  // Supply, stats ("made 1 time"), and history all show it.
  await page.goto(`/recipes/${r.id}`);
  await expect(page.getByText("You've made this 1 time")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByTestId("history-row").first()).toContainText(r.title);
  await expect(page.getByTestId("history-row").first()).toContainText(/−25 g baby spinach/i);
});
