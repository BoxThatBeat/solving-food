// preferences.spec.ts (Planning/M5 "settings", "plan"): food preferences (likes, dislikes, diets as hard filters),
// protein goals per meal type with on/off, and the Plan page's protein summary against the goal.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";

const MEAT = ["beef", "pork", "chicken", "turkey", "lamb", "fish", "seafood"];

test("likes, dislikes, and dietary restrictions are saved and keep clashing recipes out of suggestions (R11.2, R6.11)", { tag: ["@R11.2", "@R6.11"] }, async ({ page, household }) => {
  await page.goto("/settings/preferences");
  const input = page.getByLabel("Add a food, cuisine or word");
  await input.fill("thai");
  await page.getByRole("button", { name: /^Like Thai/ }).click();
  await expect(page.getByRole("list", { name: "Likes", exact: true })).toContainText("Thai");
  await page.getByRole("button", { name: "Adding to likes; switch" }).click();
  await input.fill("olive");
  await page.getByRole("button", { name: /^Dislike Anything with “olive”/ }).click();
  await expect(page.getByRole("list", { name: "Dislikes", exact: true })).toContainText("“olive”");
  await page.getByRole("button", { name: "Vegetarian", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vegetarian", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.preferences)
    .toEqual({ likes: ["cuisine:thai"], dislikes: ["text:olive"], diets: ["vegetarian"] });

  // Diets are hard filters: no suggestion has a meat or fish main protein.
  await seedPeriod(household.hid);
  await page.goto("/plan");
  const cards = page.getByTestId("suggestion");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  const titles = (await cards.locator("a span.font-extrabold").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  expect(titles.length).toBeGreaterThan(0);
  for (const t of titles) {
    const snap = await adminDb.collection("recipes").where("title", "==", t).limit(1).get();
    expect(MEAT).not.toContain(snap.docs[0]?.data().mainProtein);
  }

  // Removing a like.
  await page.goto("/settings/preferences");
  await page.getByRole("button", { name: "Remove Thai from likes" }).click();
  await expect(page.getByRole("list", { name: "Likes", exact: true })).toContainText("None yet.");
});

test("protein goals per meal type, each on or off; the plan shows its average next to the goal (R6.14, R11.4, R6.17)", { tag: ["@R6.14", "@R11.4", "@R6.17", "@R6.16"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Protein check");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/preferences");
  const dinner = page.getByRole("switch", { name: "Dinner protein goal" });
  await expect(dinner).toHaveAttribute("aria-checked", "false");
  await dinner.click();
  await expect(dinner).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Raise the dinner goal" }).click();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.proteinGoals).toEqual({ dinner: 40 });

  const plan = new PlanPage(page);
  await plan.goto();
  const row = page.getByTestId("protein-dinner");
  await expect(row).toContainText(/\d+ g · goal 40 g/);
  await expect(page.getByTestId("protein-breakfast")).toContainText("no goal");

  // Off again.
  await page.goto("/settings/preferences");
  await expect(page.getByRole("switch", { name: "Dinner protein goal" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Dinner protein goal" }).click();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.proteinGoals).toEqual({});
});

test("fibre goals per meal type, like protein; the plan shows the fibre average next to its goal (M9)", { tag: ["@R6.26"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Fibre check", { lines: "Simmer @pearl barley{200%g} with @chicken thigh{600%g}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/preferences");
  const dinner = page.getByRole("switch", { name: "Dinner fibre goal" });
  await expect(dinner).toHaveAttribute("aria-checked", "false");
  await dinner.click();
  await page.getByRole("button", { name: "Raise the dinner fibre goal" }).click();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.fibreGoals).toEqual({ dinner: 9 });

  const plan = new PlanPage(page);
  await plan.goto();
  // 200 g pearl barley (15.6 g/100 g) for 4 servings ≈ 8 g fibre per serving.
  await expect(page.getByTestId("fibre-dinner")).toContainText(/8 g · goal 9 g ↓/);
  await expect(plan.item(r.title)).toContainText(/8 g FIBRE/i);
});

test("one switch hides protein and fibre everywhere and keeps the goals; switching back restores them (M9)", { tag: ["@R6.27"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Nutrition switch");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await adminDb.doc(`households/${household.hid}`).update({ "settings.proteinGoals": { dinner: 40 }, "settings.fibreGoals": { dinner: 8 } });

  await page.goto("/settings/preferences");
  const sw = page.getByRole("switch", { name: "Track protein and fibre" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings).toMatchObject({ nutrition: false, proteinGoals: { dinner: 40 }, fibreGoals: { dinner: 8 } });
  await expect(page.getByRole("switch", { name: "Dinner protein goal" })).toHaveCount(0);
  await expect(page.getByTestId("nutrition-note")).toContainText("hidden everywhere");

  // Plan: no summary, no protein or fibre on the item, no goal filter in the optimiser.
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.item(r.title)).toBeVisible();
  await expect(page.getByTestId("protein-summary")).toHaveCount(0);
  await expect(plan.item(r.title)).not.toContainText(/protein|fibre/i);
  await expect(page.getByRole("checkbox", { name: /Only recipes that meet/ })).toHaveCount(0);

  // Recipes: cards, the filter sheet, and the recipe page.
  await page.goto(`/recipes?q=${encodeURIComponent(r.title)}`);
  const card = page.getByTestId("recipe-card").filter({ hasText: r.title });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(/protein|fibre/i);
  await page.getByRole("button", { name: /^Filter and sort/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filter & sort" });
  await expect(sheet.getByRole("group", { name: "Protein per serving" })).toHaveCount(0);
  await expect(sheet.getByRole("group", { name: "Fibre per serving" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Most protein" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto(`/recipes/${r.id}`);
  await expect(page.locator("#recipe-title")).toHaveText(r.title);
  await expect(page.getByTestId("meta-protein")).toHaveCount(0);
  await expect(page.getByTestId("meta-fibre")).toHaveCount(0);

  // Back on: everything returns, with the goals as they were.
  await page.goto("/settings/preferences");
  await expect(page.getByRole("switch", { name: "Track protein and fibre" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: "Track protein and fibre" }).click();
  await expect(page.getByRole("switch", { name: "Dinner protein goal" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "Dinner fibre goal" })).toHaveAttribute("aria-checked", "true");
  await page.goto(`/recipes/${r.id}`);
  await expect(page.getByTestId("meta-protein")).toHaveText(/\d+ g/);
  await expect(page.getByTestId("meta-fibre")).toHaveText(/\d+ g/);
  await plan.goto();
  await expect(page.getByTestId("protein-dinner")).toContainText("goal 40 g");
  await expect(page.getByTestId("fibre-dinner")).toContainText("goal 8 g");
});
