// cooking.spec.ts (TECHNICAL_SPECS §14.1): mise en place; step mode navigation (swipe, tap, keys); inline amounts;
// portrait/landscape and tablet layouts; wake lock requested; choosing the order of a multi-recipe meal.
import { expect, test } from "../fixtures/test";
import { PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";
import { fakeWakeLock, makeCookRecipe } from "../pages/supply";

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
  await tasks.getByRole("checkbox", { name: /Dice the onion/ }).click();
  await expect(page.getByTestId("mise-count")).toHaveText("1 OF 2 READY");
  await page.getByRole("button", { name: "Start step mode →" }).click();

  const card = page.getByTestId("step-card");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await expect(page.getByTestId("step-text")).toContainText("chicken thigh600 g in olive oil2 tbsp (30 ml)"); // inline amounts: recipe wording + metric only (R4.11, R8.13)
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
  await expect(list.getByTestId("cook-recipe").first()).toContainText("30 min total");
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
