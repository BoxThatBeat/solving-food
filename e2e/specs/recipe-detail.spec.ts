// Recipe detail (TECHNICAL_SPECS §14.1 recipe-detail.spec.ts, M1 parts): what the page shows, amounts in the recipe's
// wording plus metric only (R8.13), inline amounts in steps, servings scaling, the tools flag, and protein per serving. Supply badges are M3.
import { adminDb } from "../fixtures/admin";
import { makeRecipe, seedRecipeId, uniqueTitle } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { detail } from "../pages/recipes";

test("shows image, servings, times, ingredients, steps, tools, source, notes, and protein", { tag: ["@R4.8", "@R6.15", "@R4.18"] }, async ({ page, household: _ }) => {
  const id = await seedRecipeId("Garlic Rice and Chicken");
  await page.goto(`/recipes/${id}`);
  const d = detail(page);
  await expect(d.locator("#recipe-title")).toHaveText("Garlic Rice and Chicken");
  await expect(d.getByRole("img", { name: "Garlic Rice and Chicken" })).toBeVisible();
  // The stored photo, served in three sizes from our own bucket.
  await expect(d.getByRole("img", { name: "Garlic Rice and Chicken" })).toHaveAttribute("srcset", /480\.webp.*960\.webp.*1920\.webp/);
  await expect(d.getByTestId("meta-total")).toHaveText("40′");
  await expect(d.getByTestId("meta-active")).toHaveText("15′");
  await expect(d.getByTestId("meta-cook")).toHaveText("25′");
  await expect(d.getByTestId("meta-protein")).toHaveText("60 g");
  await expect(d.getByLabel("Servings", { exact: true })).toHaveText("2");

  const ingredients = d.locator("section[aria-labelledby=ing-h]");
  await expect(ingredients.getByRole("listitem")).toHaveCount(14);
  await expect(ingredients).toContainText(/boneless skinless chicken breasts/i); // capitalised by CSS
  await expect(ingredients).toContainText(/kosher salt/i);

  // Every step is stored and shown, in order.
  const steps = d.locator("section[aria-labelledby=steps-h] ol > li");
  await expect(steps).toHaveCount(5);
  await expect(steps.first()).toContainText("Defrost the boneless skinless chicken breasts");
  await expect(steps.last()).toContainText("kosher salt");

  await expect(d.getByText("air fryer", { exact: true })).toBeVisible();
  await expect(d.getByText("Before you start")).toBeVisible();
  await expect(d.getByText("Our thoughts: really juicy chicken")).toBeVisible();
  await expect(d.getByLabel("HOUSEHOLD NOTES")).toBeVisible();
  await expect(d.getByText(/SHARED LIBRARY · V1/)).toBeVisible();

  // Source link (a recipe that has one).
  const withSource = await makeRecipe(uniqueTitle("Sourced Salad"), { content: { sourceUrl: "https://example.com/recipes/sourced-salad?utm_source=x" } });
  await page.goto(`/recipes/${withSource}`);
  await expect(detail(page).getByRole("link", { name: /example\.com\/recipes\/sourced-salad/ })).toHaveAttribute("href", "https://example.com/recipes/sourced-salad?utm_source=x");
});

test("household notes save per household", { tag: ["@R4.8"] }, async ({ page, household }) => {
  const id = await seedRecipeId("Easy Flatbread No Yeast");
  await page.goto(`/recipes/${id}`);
  const note = detail(page).getByLabel("HOUSEHOLD NOTES");
  await note.fill("Use the cast iron pan.");
  await detail(page).getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Household note saved" })).toBeVisible();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/notes/${id}`).get()).data()?.text).toBe("Use the cast iron pan.");
  await page.reload();
  await expect(detail(page).getByLabel("HOUSEHOLD NOTES")).toHaveValue("Use the cast iron pan.");
});

test("amounts are shown in the recipe's wording with the metric conversion only, inline in the steps too", { tag: ["@R8.13", "@R4.11"] }, async ({ page, household: _ }) => {
  const id = await seedRecipeId("Roasted Salmon With Tomatoes");
  await page.goto(`/recipes/${id}`);
  const d = detail(page);
  const row = (name: string) => d.locator("section[aria-labelledby=ing-h] li").filter({ hasText: name });
  await expect(row("Cherry tomatoes").getByTestId("ingredient-amount")).toHaveText(/^2 pints \(\d+ g\)$/);
  await expect(row("Garlic").getByTestId("ingredient-amount")).toHaveText(/^3 cloves \(\d+ g\)$/);
  await expect(row("Salmon fillet").getByTestId("ingredient-amount")).toHaveText(/^1 lb \(450 g\)$/);
  // No-amount ingredients are optional and say so.
  await expect(row("Kosher salt")).toContainText("OPTIONAL");

  // Steps: the ingredient's name with its amount right where it's used.
  const steps = d.locator("section[aria-labelledby=steps-h]");
  // The recipe's wording first, then the metric conversion only: never an imperial conversion.
  await expect(steps).toContainText(/salmon fillet\s*1 lb \(450 g\)/i);
  await expect(steps).toContainText(/cherry tomatoes\s*2 pints \(600 g\)/i);
  await expect(d.locator("section[aria-labelledby=ing-h]")).not.toContainText(/\d (g|kg|ml|L) · [\d.<]+ ?(oz|lb)/);
  await expect(steps).not.toContainText(/\d (g|kg|ml|L) · [\d.<]+ ?(oz|lb)/);
});

test("scaling servings updates every amount", { tag: ["@R4.13"] }, async ({ page, household: _ }) => {
  const id = await seedRecipeId("Garlic Rice and Chicken");
  await page.goto(`/recipes/${id}`);
  const d = detail(page);
  const rice = d.locator("section[aria-labelledby=ing-h] li").filter({ hasText: "Jasmine rice" }).getByTestId("ingredient-amount");
  await expect(rice).toHaveText(/^1 cup \(/);
  await expect(d.getByText("As written")).toBeVisible();

  await d.getByRole("button", { name: "More servings" }).click();
  await d.getByRole("button", { name: "More servings" }).click();
  await expect(d.getByLabel("Servings", { exact: true })).toHaveText("4");
  await expect(d.getByText("Scaled ×2 · amounts update")).toBeVisible();
  await expect(rice).toHaveText(/^2 cups \(/);
  await expect(d.locator("section[aria-labelledby=steps-h]")).toContainText(/jasmine rice\s*2 cups/i);
  await expect(d.locator("section[aria-labelledby=ing-h]")).toContainText("4 SERVINGS");

  await d.getByRole("button", { name: "Fewer servings" }).click();
  await d.getByRole("button", { name: "Fewer servings" }).click();
  await d.getByRole("button", { name: "Fewer servings" }).click();
  await expect(d.getByLabel("Servings", { exact: true })).toHaveText("1");
  await expect(rice).toHaveText(/^0\.5 cup|^½ cup/);
});

test("tools: says when the household has none configured, and flags missing tools when it has", { tag: ["@R4.14"] }, async ({ page, household }) => {
  const id = await seedRecipeId("Garlic Rice and Chicken"); // needs an air fryer
  await page.goto(`/recipes/${id}`);
  await expect(detail(page).getByText(/No kitchen tools configured for this household yet/)).toBeVisible();

  // Kitchen tools are set in Settings from M2; here they are written directly.
  await adminDb.doc(`households/${household.hid}`).update({ "settings.tools": ["oven", "stand mixer"] });
  await expect(detail(page).getByRole("alert")).toHaveText(/Needs air fryer\. It's not in your kitchen tools\./);

  await adminDb.doc(`households/${household.hid}`).update({ "settings.tools": ["oven", "air fryer"] });
  await expect(detail(page).getByText("Your kitchen has everything this needs.")).toBeVisible();
});

test("beside every ingredient: how much is in supply, staple for free-use, expired lots not counted (R4.9)", { tag: ["@R4.9", "@R8.15"] }, async ({ page, household }) => {
  const { makePlanRecipe } = await import("../pages/plan");
  const { seedSupply } = await import("../pages/supply");
  const r = await makePlanRecipe("Badge check"); // 600 g chicken thigh, 140 g spinach, olive oil
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 250, expiresInDays: 2 }]);
  await seedSupply(household.hid, "baby-spinach", [{ amount: 300, expiresInDays: -1 }]);
  await page.goto(`/recipes/${r.id}`);
  const d = detail(page);
  const badges = d.getByTestId("supply-badge");
  await expect(badges).toHaveCount(3);
  await expect(d.getByLabel("chicken thigh: 250 g in supply, not enough", { exact: false })).toHaveText("have 250 g ⚠");
  await expect(d.getByLabel(/baby spinach: none in supply/i)).toHaveText("none");
  await expect(d.getByLabel(/olive oil: staple/i)).toHaveText("staple");
  // Scaling down to 2 servings: 300 g needed, 250 g still short; to 1 serving, enough.
  await d.getByRole("button", { name: "Fewer servings" }).click();
  await d.getByRole("button", { name: "Fewer servings" }).click();
  await d.getByRole("button", { name: "Fewer servings" }).click();
  await expect(d.getByLabel(/chicken thigh: 250 g in supply$/i)).toHaveText("have 250 g");
});
