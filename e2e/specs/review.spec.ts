// review.spec.ts (TECHNICAL_SPECS §14.1): Done cooking deducts recipe defaults and adds estimated leftovers at once;
// the review opens when all recipes are checked off and on an early Done cooking; per-user ratings; adjusting used
// ingredients posts corrections for the difference; pending reviews completed later by another member; Save this meal.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { seedPeriod, seedPlanItem } from "../pages/plan";
import { uniqueTitle } from "../fixtures/recipes";
import { commandsSettled, cookEvents, expectSupply, makeCookRecipe, seedNotedEvent, seedSupply } from "../pages/supply";

test("Done cooking subtracts the recipe's amounts right away and records leftovers; the review then corrects by the difference (R9.3, R9.2)", { tag: ["@R9.3", "@R9.2", "@R5.3", "@R8.1"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Review flow");
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id]);
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 1000, expiresInDays: 2 }], { label: "chicken thigh" });
  await seedSupply(household.hid, "baby-spinach", [{ amount: 312, expiresInDays: 4 }], { label: "baby spinach" });
  await page.goto(`/plan/${itemId}/cook`);
  // An early Done cooking (before the steps are done) opens the review too (R9.1).
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  // Defaults are out of supply before anyone reviews (R9.3); free-use olive oil isn't tracked.
  await expectSupply(household.hid, "chicken-thigh", 400);
  await expectSupply(household.hid, "baby-spinach", 172);
  await expect.poll(async () => (await cookEvents(household.hid)).length, { timeout: 20_000 }).toBe(1);
  await expectSupply(household.hid, "leftover_" + (await cookEvents(household.hid))[0]!.id, 2);
  expect((await adminDb.doc(`households/${household.hid}/planItems/${itemId}`).get()).data()!.status).toBe("cooked");

  // Rate it (R9.2 step 1): a one-recipe meal rates its recipe.
  await expect(page.getByTestId("rating-card")).toHaveCount(1);
  await page.getByTestId("rating-card").getByRole("button", { name: "8 out of 10" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  // What did you use? Pre-filled; used 100 g more chicken and no spinach.
  await expect(page.getByTestId("used-row")).toHaveCount(2);
  const chicken = page.getByTestId("used-row").filter({ hasText: "Chicken thigh" });
  await expect(chicken).toContainText("600 g");
  for (let i = 0; i < 4; i++) await chicken.getByRole("button", { name: "More Chicken thigh" }).click();
  await expect(chicken).toContainText("700 g");
  await page.getByRole("button", { name: "Didn't use Baby spinach" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText("Estimated leftovers: 2 portions. Correct?")).toBeVisible();
  await page.getByRole("button", { name: "Fewer leftovers" }).click();
  await page.getByRole("button", { name: "Save & update supply" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  expect(await commandsSettled(household.hid, 2)).toEqual([]);
  await expectSupply(household.hid, "chicken-thigh", 300);
  await expectSupply(household.hid, "baby-spinach", 312);
  const [ev] = await cookEvents(household.hid);
  expect(ev).toMatchObject({ reviewStatus: "done", leftoverPortions: 1, ratedBy: [household.uid] });
  const stats = (await adminDb.doc(`households/${household.hid}/stats/recipe_${r.id}`).get()).data()!;
  expect(stats).toMatchObject({ timesCooked: 1, ratingSum: 8, ratingCount: 1 });
});

test("a review can wait: Pending reviews on the Plan page; another member finishes it and others add their rating (R9.4, R2.7)", { tag: ["@R9.4", "@R5.3", "@R2.7"] }, async ({ page, household, secondMember }) => {
  const r = await makeCookRecipe("Later review", { leftovers: 0 });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto(`/plan/${itemId}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await page.getByRole("button", { name: "Review later" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  const pending = page.getByTestId("pending-reviews");
  await expect(pending).toContainText(r.title);
  await expect(pending).toContainText("NOT REVIEWED YET");

  // Sam reviews it that evening.
  const sam = secondMember.page;
  await sam.goto("/plan");
  await sam.getByTestId("pending-reviews").getByRole("link", { name: `Review ${r.title}` }).click();
  await sam.getByTestId("rating-card").getByRole("button", { name: "6 out of 10" }).click();
  await sam.getByRole("tab", { name: "3 · Leftovers" }).click();
  await sam.getByRole("button", { name: "Save & update supply" }).click();
  await commandsSettled(household.hid, 2);
  // Now I'm asked only for my rating.
  await expect(pending).toContainText("SAM RATED IT 6/10");
  await pending.getByRole("link", { name: `Rate ${r.title}` }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.getByTestId("rating-card").getByRole("button", { name: "9 out of 10" }).click();
  await page.getByRole("button", { name: "Save rating" }).click();
  await commandsSettled(household.hid, 3);
  await expect(page.getByTestId("pending-reviews")).toHaveCount(0);
  const stats = (await adminDb.doc(`households/${household.hid}/stats/recipe_${r.id}`).get()).data()!;
  expect(stats).toMatchObject({ ratingSum: 15, ratingCount: 2 });
});

test("an unsaved meal of several recipes offers Save this meal; the meal is then rated too (R5.8, R5.3)", { tag: ["@R5.8", "@R5.3"] }, async ({ page, household }) => {
  const a = await makeCookRecipe("Save me A", { leftovers: 0 });
  const b = await makeCookRecipe("Save me B", { leftovers: 0, lines: "Boil @jasmine rice{300%g}." });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [a.id, b.id]);
  await page.goto(`/plan/${itemId}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page.getByTestId("rating-card")).toHaveCount(2);
  // Saved meals are a global collection and several projects can share one emulator: the name must be unique.
  const mealName = uniqueTitle("Weeknight duo");
  const prompt = page.getByTestId("save-meal-prompt");
  await prompt.getByLabel("Meal name").fill(mealName);
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("rating-card")).toHaveCount(3);
  await page.getByTestId("rating-card").filter({ hasText: "The meal" }).getByRole("button", { name: "10 out of 10" }).click();
  await page.getByRole("tab", { name: "3 · Leftovers" }).click();
  await page.getByRole("button", { name: "Save & update supply" }).click();
  await commandsSettled(household.hid, 2);
  const meal = await adminDb.collection("meals").where("name", "==", mealName).get();
  expect(meal.size).toBe(1);
  const st = (await adminDb.doc(`households/${household.hid}/stats/meal_${meal.docs[0]!.id}`).get()).data();
  expect(st).toMatchObject({ ratingSum: 10, ratingCount: 1 });
  // The plan item takes the saved meal's name (it has left the Plan list once eaten, M29).
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/planItems/${itemId}`).get()).data()).toMatchObject({ savedMealId: meal.docs[0]!.id, name: mealName, status: "eaten" });
});

test("the review shows last time's note above the note field; Keep this note carries it into this cook (R9.6, R4.38)", { tag: ["@R9.6", "@R4.38"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Kept note", { leftovers: 0 });
  await seedNotedEvent(household.hid, { recipeId: r.id, title: r.title, uid: household.uid, daysAgo: 6, note: "Rest the chicken five minutes" });
  await page.goto(`/recipes/${r.id}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  await page.getByRole("tab", { name: "3 · Leftovers" }).click();
  const prev = page.getByTestId("previous-note");
  await expect(prev).toContainText(/Last time \(\d{1,2} [A-Z][a-z]{2,3}, Aaron\): Rest the chicken five minutes/);
  await prev.getByRole("button", { name: "Keep this note" }).click();
  await expect(page.getByPlaceholder("Pork could go five minutes longer.")).toHaveValue("Rest the chicken five minutes");
  await expect(prev.getByRole("button", { name: "Kept ✓" })).toBeDisabled();
  await page.getByRole("button", { name: "Save & update supply" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  expect(await commandsSettled(household.hid, 2)).toEqual([]);
  const ev = (await cookEvents(household.hid)).find((e) => !e.id.startsWith("noted-"))!;
  expect(ev).toMatchObject({ note: "Rest the chicken five minutes", notedRecipeIds: [r.id] });
  // The recipe page now leads with this cook's note.
  await page.goto(`/recipes/${r.id}`);
  await expect(page.getByTestId("last-time-text")).toHaveText("Rest the chicken five minutes");
  await expect(page.getByTestId("last-time").getByRole("button", { name: "Show earlier (1)" })).toBeVisible();
});
