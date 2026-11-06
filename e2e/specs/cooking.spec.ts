// cooking.spec.ts (TECHNICAL_SPECS §14.1): mise en place; step mode navigation (swipe, tap, keys); inline amounts;
// portrait/landscape and tablet layouts; wake lock requested; choosing the order of a multi-recipe meal.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";
import { cookEvents, expectSupply, fakeWakeLock, makeCookRecipe, seedNotedEvent, seedSupply } from "../pages/supply";

test("mise en place lists the prep tasks, then step mode shows one step with inline amounts and its ingredients; the screen stays awake (R4.12, R4.10, R4.11)", { tag: ["@R4.12", "@R4.10", "@R4.11"] }, async ({ page, household }) => {
  await fakeWakeLock(page);
  const r = await makeCookRecipe("Cook flow");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.item(r.title).getByRole("button", { name: `Cook ${r.title}` }).click();
  await expect(page).toHaveURL(/\/plan\/[^/]+\/cook/);
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  const tasks = page.getByRole("list", { name: "Prep tasks" });
  await expect(tasks.getByRole("checkbox")).toHaveCount(2);
  await expect(tasks).toContainText("Preheat the oven to 430°F"); // the recipe's 220°C, Fahrenheit only (R8.13)
  await expect(tasks).not.toContainText("°C");
  await tasks.getByRole("checkbox", { name: /Dice the onion/ }).click();
  await expect(page.getByTestId("mise-count")).toHaveText("1 OF 2 READY");
  await page.getByRole("button", { name: "Start step mode →" }).click();

  const card = page.getByTestId("step-card");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await expect(page.getByTestId("step-text")).toContainText("chicken thigh600 g in olive oil2 tbsp"); // inline amounts, one unit system: spoons as written (R4.11, R8.13)
  await expect(page.getByTestId("step-text")).not.toContainText("ml");
  await expect(page.getByTestId("awake")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __wakeLocks: number }).__wakeLocks)).toBeGreaterThan(0);

  // Keys, the screen edge, and the buttons all move between steps.
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });
  await expect(page.getByTestId("step-text")).toContainText(/baby spinach/i);
  await page.keyboard.press("ArrowLeft");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await page.getByRole("button", { name: "Next step" }).first().dispatchEvent("click"); // the invisible right edge
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });
  await page.getByRole("button", { name: "Next step →" }).click();
  await expect(card).toContainText("Step 3 of 3", { ignoreCase: true });
  await expect(page.getByRole("button", { name: "Done cooking ✓" })).toBeVisible();
});

test("swipe changes step on touch screens (R4.10)", { tag: ["@R4.10"] }, async ({ page, household, isMobile }) => {
  test.skip(!isMobile, "touch swipe");
  const r = await makeCookRecipe("Swipe flow");
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const card = page.getByTestId("step-card");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  const box = (await page.getByTestId("step-mode").boundingBox())!;
  const y = box.y + box.height / 2;
  await page.getByTestId("step-mode").dispatchEvent("pointerdown", { pointerType: "touch", clientX: box.x + box.width * 0.8, clientY: y });
  await page.getByTestId("step-mode").dispatchEvent("pointerup", { pointerType: "touch", clientX: box.x + box.width * 0.2, clientY: y + 5 });
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });
  void household;
});

test("layouts follow the screen: phone portrait, phone landscape, tablet portrait, wide three panes (R4.24)", { tag: ["@R4.24"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Layout flow");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const mode = page.getByTestId("step-mode");
  await expect(mode).toHaveAttribute("data-layout", "phone");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(mode).toHaveAttribute("data-layout", "phone-landscape");
  await expect(page.getByRole("complementary", { name: "This step's ingredients and timers" })).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(mode).toHaveAttribute("data-layout", "tablet-portrait");
  await expect(page.getByTestId("next-step")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Ingredients" })).toBeVisible();
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(mode).toHaveAttribute("data-layout", "wide");
  await expect(page.getByRole("complementary", { name: "Ingredients" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Timers and next step" })).toBeVisible();
  void household;
});

test("a meal of several recipes: choose the order, each shows its total time; check them off (R5.6, R9.1)", { tag: ["@R5.6", "@R9.1"] }, async ({ page, household }) => {
  const a = await makeCookRecipe("Order first", { leftovers: 0 });
  const b = await makeCookRecipe("Order second", { leftovers: 0, lines: "Boil @jasmine rice{300%g} for ~{12%minutes}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [a.id, b.id], { name: "Two-part dinner" });
  await page.goto("/plan");
  await new PlanPage(page).item("Two-part dinner").getByRole("button", { name: "Cook Two-part dinner" }).click();
  const list = page.getByRole("list", { name: "Recipes in cooking order" });
  await expect(list.getByTestId("cook-recipe")).toHaveCount(2);
  await expect(list.getByTestId("cook-recipe").first()).toContainText(a.title);
  await expect(list.getByTestId("cook-recipe").first()).toContainText("30m total");
  await list.getByRole("button", { name: `Move ${b.title} earlier` }).click();
  await expect(list.getByTestId("cook-recipe").first()).toContainText(b.title);
  // Cook the first through to its last step: it's checked off and we're back at the list.
  await list.getByRole("button", { name: `Cook ${b.title}` }).click();
  await page.getByRole("button", { name: "Start step mode →" }).click();
  await page.getByRole("button", { name: "Next step →" }).click();
  await page.getByRole("button", { name: "Next step →" }).click();
  await page.getByRole("button", { name: "Recipe done ✓" }).click();
  await expect(list.getByRole("checkbox", { name: `${b.title} done` })).toHaveAttribute("aria-checked", "true");
  // Checking off the last one opens the review (R9.1).
  await list.getByRole("checkbox", { name: `${a.title} done` }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect(page.getByRole("heading", { name: "Rate it" })).toBeVisible();
});

test("the back button goes from step mode to mise en place, and from a meal's mise en place to its order list (R4.12)", { tag: ["@R4.12"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Back flow");
  const b = await makeCookRecipe("Back flow second", { leftovers: 0, lines: "Boil @jasmine rice{300%g} for ~{12%minutes}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await seedPlanItem(household.hid, pid, [r.id, b.id], { name: "Back two-part" });
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.item(r.title).getByRole("button", { name: `Cook ${r.title}` }).click();
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await page.getByRole("button", { name: "Start step mode →" }).click();
  await expect(page.getByTestId("step-card")).toBeVisible();
  await page.getByRole("button", { name: "Next step →" }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await expect(page).toHaveURL(/\/plan\/[^/?]+\/cook$/);
  // Forward again returns to step mode; back twice leaves the cook view.
  await page.goForward();
  await expect(page.getByTestId("step-card")).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/\/plan$/);

  // A meal of two: step mode → mise en place → the order list.
  await plan.item("Back two-part").getByRole("button", { name: "Cook Back two-part" }).click();
  const list = page.getByRole("list", { name: "Recipes in cooking order" });
  await list.getByRole("button", { name: `Cook ${b.title}` }).click();
  await page.getByRole("button", { name: "Start step mode →" }).click();
  await expect(page.getByTestId("step-card")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await page.goBack();
  await expect(list).toBeVisible();
  // Finishing a recipe pops back to the list, so Back from there leaves the cook view.
  await list.getByRole("button", { name: `Cook ${b.title}` }).click();
  await page.getByRole("button", { name: "Start step mode →" }).click();
  for (;;) {
    const next = page.getByRole("button", { name: "Next step →" });
    if (!(await next.isVisible())) break;
    await next.click();
  }
  await page.getByRole("button", { name: "Recipe done ✓" }).click();
  await expect(list.getByRole("checkbox", { name: `${b.title} done` })).toHaveAttribute("aria-checked", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/plan$/);
});

test("a very long step scrolls inside the card; Back and Next stay visible and uncovered on a small phone (R4.10)", { tag: ["@R4.10"] }, async ({ page, household }) => {
  const words = Array.from({ length: 160 }, (_, i) => `word${i}`).join(" ");
  const r = await makeCookRecipe("Long step", { lines: `Sear @chicken thigh{600%g} in @olive oil{2%tbsp}, then ${words}, until golden and the end of the step is here.` });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const scroller = page.getByTestId("step-scroll");
  await expect(page.getByTestId("step-text")).toContainText("word159");
  const next = page.getByRole("button", { name: /^(Next step →|Done cooking ✓)$/ });
  const back = page.getByRole("button", { name: "← Back" });
  await expect(next).toBeInViewport({ ratio: 1 });
  await expect(back).toBeInViewport({ ratio: 1 });
  // The text overflows its own box (so it scrolls), and that box ends above the buttons.
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 10)).toBe(true);
  const box = (await scroller.boundingBox())!;
  const btn = (await next.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(btn.y);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.getByText("the end of the step is here", { exact: false })).toBeInViewport();
  void household;
});

test("a long step shows a down arrow while there's more text; it goes at the end and a short step never has it (R4.10)", { tag: ["@R4.10"] }, async ({ page, household }) => {
  const words = Array.from({ length: 160 }, (_, i) => `word${i}`).join(" ");
  const r = await makeCookRecipe("Arrow step", { lines: `Sear @chicken thigh{600%g} in @olive oil{2%tbsp}, then ${words}, until golden.\n\nServe it.` });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const scroller = page.getByTestId("step-scroll");
  const arrow = page.getByTestId("step-more");
  await expect(arrow).toBeVisible();
  // M24: the arrow is a labelled button, at least 44 px.
  const button = arrow.getByRole("button", { name: "Scroll down for more of this step" });
  const box = (await button.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  // Tapping the arrow scrolls down; at the end it's gone, scrolling back up brings it back.
  await button.click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(arrow).toHaveCount(0);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect(arrow).toBeVisible();
  // The next step is short: no arrow.
  await page.getByRole("button", { name: "Next step →" }).click();
  await expect(page.getByTestId("step-text")).toContainText("Serve it");
  await expect(arrow).toHaveCount(0);
  void household;
});

// ---------- M28: cook notes and swaps

test("last time's note shows on mise en place and the recipe page, with when and who; Show earlier opens the rest (R4.38)", { tag: ["@R4.38"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Noted flow");
  await seedNotedEvent(household.hid, { recipeId: r.id, title: r.title, uid: household.uid, daysAgo: 20, note: "Too salty" });
  await seedNotedEvent(household.hid, { recipeId: r.id, title: r.title, uid: household.uid, daysAgo: 10, note: "Less stock" });
  await seedNotedEvent(household.hid, { recipeId: r.id, title: r.title, uid: household.uid, daysAgo: 3, note: "More lemon next time" });
  // A cook with no note doesn't hide them.
  await seedNotedEvent(household.hid, { recipeId: r.id, title: r.title, uid: household.uid, daysAgo: 1, stepNotes: [] });

  await page.goto(`/recipes/${r.id}/cook`);
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  const last = page.getByTestId("last-time");
  await expect(last).toContainText(/Last time \(\d{1,2} [A-Z][a-z]{2,3}, Aaron\): More lemon next time/);
  await expect(last.getByRole("list", { name: "Earlier notes" })).toHaveCount(0);
  await last.getByRole("button", { name: "Show earlier (2)" }).click();
  const earlier = last.getByRole("list", { name: "Earlier notes" });
  await expect(earlier.getByRole("listitem")).toHaveCount(2);
  await expect(earlier.getByRole("listitem").first()).toContainText("Less stock");
  await expect(earlier.getByRole("listitem").last()).toContainText("Too salty");

  await page.goto(`/recipes/${r.id}`);
  await expect(page.getByTestId("last-time")).toContainText("More lemon next time");
});

test("a note on a step is saved with Done cooking and shows under that step next time (R4.39)", { tag: ["@R4.39"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Step note flow");
  await page.goto(`/recipes/${r.id}/cook`);
  await page.getByRole("button", { name: "Start step mode →" }).click();
  await expect(page.getByTestId("step-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Add a note to step 1" }).click();
  const sheet = page.getByRole("dialog", { name: "Note on step 1" });
  await sheet.getByLabel("Note on step 1").fill("Pan hotter than you think");
  await sheet.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByTestId("step-note")).toContainText("Pan hotter than you think");
  await expect(page.getByRole("button", { name: "Edit the note on step 1" })).toBeVisible();
  // Step 2 has no note.
  await page.getByRole("button", { name: "Next step →" }).click();
  await expect(page.getByTestId("step-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect.poll(async () => (await cookEvents(household.hid))[0]?.stepNotes, { timeout: 30_000 }).toEqual([{ recipeId: r.id, step: 0, text: "Pan hotter than you think" }]);
  expect((await cookEvents(household.hid))[0]!.notedRecipeIds).toEqual([r.id]);
  await page.getByRole("button", { name: "Review later" }).click();

  // Next time: under step 1's text, and carried forward when Done cooking comes without changes.
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  await expect(page.getByTestId("step-note")).toContainText("Pan hotter than you think");
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect.poll(async () => (await cookEvents(household.hid)).length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => (await cookEvents(household.hid)).every((e) => JSON.stringify(e.stepNotes) === JSON.stringify([{ recipeId: r.id, step: 0, text: "Pan hotter than you think" }]))).toBe(true);
});

test("a missing ingredient with a substitute in Supply: mise en place offers the swap and Done cooking takes the substitute (R4.40)", { tag: ["@R4.40"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Swap flow", { leftovers: 0, lines: "Sear @chicken thigh{600%g} with @garlic{10%g} for ~{10%minutes}." });
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 1000, expiresInDays: 3 }], { label: "chicken thigh" });
  await seedSupply(household.hid, "garlic-powder", [{ amount: 50, location: "pantry", expiresInDays: 300 }], { label: "garlic powder" });
  await seedSupply(household.hid, "baby-spinach", [{ amount: 312, expiresInDays: 4 }], { label: "baby spinach" });
  await page.goto(`/recipes/${r.id}/cook`);
  const swap = page.getByTestId("swap");
  await expect(swap).toHaveCount(1);
  await expect(swap).toContainText(/garlic: use 0\.8 g garlic powder from Supply/i);
  await swap.getByRole("button", { name: "Use it" }).click();
  await expect(swap).toContainText(/swapped/i);
  await expect(swap.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expectSupply(household.hid, "garlic-powder", 49.224);
  await expectSupply(household.hid, "chicken-thigh", 400);
  const [ev] = await cookEvents(household.hid);
  expect(ev!.substitutions).toEqual([{ ingredientId: "garlic", withIngredientId: "garlic-powder", amount: 0.776 }]);
  // The review pre-fills the garlic powder, not the garlic.
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByTestId("used-row").filter({ hasText: /garlic powder/i })).toContainText("0.8 g");
  await expect(page.getByTestId("used-row").filter({ hasText: /^Garlic$|^Garlic[^ ]/ })).toHaveCount(0);
});

// ---------- M29: a planned recipe cooked from its page, mise en place Back and amounts

test("Cook on the page of a planned recipe cooks that planned meal: Done cooking turns its cell from planned to cooked and it leaves the Plan list (R9.7, R6.2, R6.1)", { tag: ["@R9.7", "@R6.2", "@R6.1"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Planned from its page", { leftovers: 0 });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id]);
  const plan = new PlanPage(page);
  await plan.goto();
  const cell = page.getByTestId("strip-dinner").locator("td").nth(0);
  await expect(cell).toHaveAttribute("data-state", "planned");
  await expect(plan.item(r.title)).toHaveCount(1);

  await page.goto(`/recipes/${r.id}`);
  await page.getByRole("link", { name: "Cook →" }).click();
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await expect(page.getByTestId("cook-kicker")).toHaveText(/^Planned dinner$/i);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  await page.getByRole("button", { name: "Review later" }).click();
  await plan.goto();
  await expect(cell).toHaveAttribute("data-state", "cooked");
  await expect(plan.item(r.title)).toHaveCount(0);
  await expect(page.getByTestId("pending-reviews").getByRole("link", { name: `Review ${r.title}` })).toBeVisible();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/planItems/${itemId}`).get()).data()!.status, { timeout: 30_000 }).toBe("cooked");
  const [ev] = await cookEvents(household.hid);
  expect(ev!.planItemId).toBe(itemId);

  // Not planned any more: Cook on the recipe page is a cook off the plan.
  await page.goto(`/recipes/${r.id}/cook`);
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await expect(page.getByTestId("cook-kicker")).toHaveText(/^Mise en place$/i);
});

test("a recipe planned in a meal of several cooks the whole meal from its page (R9.7)", { tag: ["@R9.7"] }, async ({ page, household }) => {
  const a = await makeCookRecipe("Taco part", { leftovers: 0 });
  const b = await makeCookRecipe("Rice part", { leftovers: 0, lines: "Boil @jasmine rice{300%g} for ~{12%minutes}." });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [a.id, b.id], { name: "Taco night" });
  await page.goto(`/recipes/${a.id}/cook`);
  const list = page.getByRole("list", { name: "Recipes in cooking order" });
  await expect(list.getByTestId("cook-recipe")).toHaveCount(2);
  await expect(page.getByTestId("cook-kicker")).toHaveText(/^Planned dinner$/i);
  await expect(page.getByRole("region", { name: "Cooking Taco night" })).toBeVisible();
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/planItems/${itemId}`).get()).data()!.status, { timeout: 30_000 }).toBe("cooked");
});

test("mise en place has a Back button: to the recipe page for one recipe, to the list of recipes in a meal (R4.41)", { tag: ["@R4.41", "@R4.12"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Mise back");
  const b = await makeCookRecipe("Mise back second", { leftovers: 0, lines: "Boil @jasmine rice{300%g} for ~{12%minutes}." });
  await page.goto(`/recipes/${r.id}/cook`);
  const back = page.getByRole("button", { name: "Back to the recipe" });
  await expect(back).toBeVisible();
  const box = (await back.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${r.id}/?$`));
  await expect(page.locator("#recipe-title")).toHaveText(r.title);

  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id, b.id], { name: "Mise back two-part" });
  await page.goto(`/plan/${itemId}/cook`);
  const list = page.getByRole("list", { name: "Recipes in cooking order" });
  await list.getByRole("button", { name: `Cook ${b.title}` }).click();
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the meal's recipes" }).click();
  await expect(list).toBeVisible();
  // Back popped the mise en place entry: browser Back now leaves the cook view (R4.12).
  await page.goBack();
  await expect(page).not.toHaveURL(/\/cook/);
});

test("mise en place shows each prep task's ingredient amounts inline, scaled to the servings (R4.42, R8.13)", { tag: ["@R4.42", "@R8.13"] }, async ({ page, household }) => {
  const { makeRecipe, uniqueTitle, waitForIndexed } = await import("../fixtures/recipes");
  const title = uniqueTitle("Prep amounts");
  const id = await makeRecipe(title, {
    cook: `---
title: x
servings: 4
cuisine: other
main_protein: chicken
prep_time: 10
cook_time: 20
tags: [dinner]
prep:
  - Mince 2 garlic cloves
  - Pat the chicken thigh dry
  - Preheat the oven to 220°C
---

Sear @chicken thigh{600%g} with @garlic{2%cloves} for ~{10%minutes}.
`,
  });
  await waitForIndexed(id);
  await page.goto(`/recipes/${id}/cook?servings=8`);
  const tasks = page.getByRole("list", { name: "Prep tasks" });
  await expect(tasks.getByTestId("prep-task")).toHaveCount(3);
  // The written quantity becomes the badge, scaled ×2; a name alone gets the recipe's amount, metric (R8.13).
  await expect(tasks.getByTestId("prep-task").nth(0)).toHaveText("Mince garlic4 cloves");
  await expect(tasks.getByTestId("prep-task").nth(1)).toHaveText("Pat the chicken thigh1200 g dry");
  await expect(tasks.getByTestId("prep-task").nth(2)).toHaveText("Preheat the oven to 430°F");
  await expect(tasks.getByTestId("prep-amount")).toHaveCount(2);
  void household;
});
