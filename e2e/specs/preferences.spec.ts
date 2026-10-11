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
