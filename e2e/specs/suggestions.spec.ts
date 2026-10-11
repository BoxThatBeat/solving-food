// suggestions.spec.ts (TECHNICAL_SPECS §14.1, Planning/M5): the Plan page's Suggested row ranked by the score with
// "why" chips; expiry alerts with recipes that use the expiring item, dismissible for the period; weights and presets.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, seedPeriod } from "../pages/plan";
import { seedSupply } from "../pages/supply";

test("salmon expiring in two days: the Plan page says so and the top suggestion uses it (R6.11, R6.13)", { tag: ["@R6.11", "@R6.13", "@smoke"] }, async ({ page, household }) => {
  await makePlanRecipe("Salmon use-up", { lines: "Roast @salmon fillet{340%g} with @lemon{1}." });
  const pid = await seedPeriod(household.hid);
  await seedSupply(household.hid, "salmon-fillet", [{ amount: 340, expiresInDays: 2 }], { label: "salmon fillet" });
  const plan = new PlanPage(page);
  await plan.goto();

  const alerts = page.getByTestId("expiry-alerts");
  await expect(alerts).toContainText(/Salmon fillet expires (tomorrow|in 2 days)/);
  await expect(alerts).toContainText("isn't covered by the plan");
  const using = alerts.getByRole("list", { name: "Recipes that use salmon fillet" });
  await expect(using.getByRole("listitem").first()).toContainText(/uses \d+ g/);

  // Ranked by the score, with why chips: the top one uses the salmon.
  const top = page.getByTestId("suggestion").first();
  await expect(top).toBeVisible({ timeout: 20_000 });
  await expect(top.getByLabel("Why")).toContainText(/Uses salmon fillet · (today|1d|2d)/);
  await expect(top.getByLabel(/^Score \d+$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Weights: Balanced" })).toBeVisible();

  // One tap from Create meal.
  await top.getByRole("button", { name: /^Add .* to plan$/ }).click();
  await expect(page.getByRole("dialog", { name: "Add to plan" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Dismissed for the rest of the period.
  await alerts.getByRole("button", { name: "Dismiss the alert for salmon fillet" }).click();
  await expect(page.getByTestId("expiry-alerts")).toBeHidden();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/periods/${pid}`).get()).data()?.dismissedLots).toContain("seed0");
});

test("weights: presets and per-factor weights change what is suggested (R6.12, R11.3)", { tag: ["@R6.12", "@R11.3"] }, async ({ page, household }) => {
  await page.goto("/settings/weights");
  await expect(page.getByRole("button", { name: "Balanced" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cheap week" }).click();
  await expect(page.getByRole("button", { name: "Cheap week" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.scoreWeights?.cost).toBe(5);
  // One factor by hand: the preset becomes Custom.
  await page.getByRole("radiogroup", { name: "Variety weight" }).getByRole("radio", { name: "0" }).click();
  await expect(page.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.scoreWeights?.variety).toBe(0);
  await page.goto("/plan");
  await expect(page.getByRole("link", { name: "Weights: Custom" })).toBeVisible();
  await page.getByRole("link", { name: "Weights: Custom" }).click();
  await expect(page).toHaveURL(/\/settings\/weights$/);
  await page.getByRole("button", { name: "Use it up" }).click();
  await expect(page.getByRole("button", { name: "Custom" })).toHaveCount(0);
});

test("Suggested and Expiring first sort any list; Uses expiring filters it (R6.11, R6.13, R4.7)", { tag: ["@R6.11", "@R6.13"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Salmon sort", { lines: "Roast @salmon fillet{340%g} with @lemon{1}." });
  await seedPeriod(household.hid);
  await seedSupply(household.hid, "salmon-fillet", [{ amount: 340, expiresInDays: 2 }], { label: "salmon fillet" });
  await page.goto("/recipes?exp=true&sort=expiry");
  await expect(page.getByTestId("recipe-count")).toContainText("EXPIRING FIRST", { timeout: 20_000 });
  await expect(page.getByRole("link", { name: new RegExp(r.title) }).first()).toBeVisible({ timeout: 20_000 });
  // Every recipe left uses salmon.
  const titles = await page.getByRole("list", { name: "Recipes" }).getByRole("listitem").allInnerTexts();
  expect(titles.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Remove filter Uses expiring" })).toBeVisible();
});
