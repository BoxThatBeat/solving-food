// sides.spec.ts (Planning/M6, TECHNICAL_SPECS §14.1): sides picked in Create meal and on the plan item (R5.9), their
// per-person portion scaled by servings and tracked in Supply (R5.10), on the grocery list rounded to packs (R7.11),
// kept by saved meals, shown in History, and the Settings → Sides page (R11.14).
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, pickSide, PlanPage, planItems, seedPeriod, seedPlanItem } from "../pages/plan";
import { commandsSettled, cookEvents, expectSupply, makeCookRecipe, seedSupply } from "../pages/supply";
import type { Page } from "@playwright/test";

const FRIES = { ingredientId: "french-fry", portion: 150 };
const line = (page: Page, name: string | RegExp) => page.getByTestId("grocery-line").filter({ hasText: name });

async function gotoGrocery(page: Page) {
  await page.goto("/grocery");
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
}

test("Create meal picks sides from a search dropdown; the row lists them, the budget counts them, the plan item can change them (R5.9)", { tag: ["@R5.9", "@R6.1"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Side dinner");
  await seedPeriod(household.hid);
  const plan = new PlanPage(page);
  await plan.goto();
  const sheet = await plan.openCreateMeal();
  await sheet.getByRole("searchbox", { name: "Search recipes to add…" }).fill(r.title);
  await sheet.getByRole("checkbox", { name: new RegExp(`^${r.title}`) }).click();
  await sheet.getByRole("button", { name: /^Next/ }).click();
  const details = page.getByRole("dialog", { name: "Add to plan" });
  await expect(details.getByTestId("budget-impact")).not.toContainText("Working it out", { timeout: 15_000 });
  const before = await details.getByTestId("budget-impact").innerText();
  // "fries" finds french fries by alias; the option shows the portion per person in metric.
  await details.getByRole("combobox", { name: "Add a side" }).fill("fries");
  await expect(details.getByRole("option", { name: /^french fries/i })).toContainText("150 g / person");
  await details.getByRole("option", { name: /^french fries/i }).click();
  await expect(details.getByRole("list", { name: "Sides" })).toContainText("150 g each · × 4 = 600 g");
  await expect(details.getByTestId("create-meal-title")).toHaveText(`${r.title} + french fries`);
  // The budget impact includes the fries (1 × 1 kg bag).
  await expect(details.getByTestId("budget-impact")).not.toHaveText(before);
  await details.getByRole("button", { name: /^Add to plan/ }).click();
  await expect(details).toBeHidden();

  const row = plan.item(`${r.title} + french fries`);
  await expect(row).toBeVisible();
  await expect.poll(async () => (await planItems(household.hid))[0]?.sides).toEqual([FRIES]);

  // The plan item sheet adds another side and removes one.
  await row.getByRole("button", { name: `${r.title} + french fries`, exact: true }).click();
  const itemSheet = page.getByRole("dialog", { name: `${r.title} + french fries` });
  await pickSide(itemSheet, "frozen peas", "peas");
  await itemSheet.getByRole("button", { name: "Remove french fries" }).click();
  await itemSheet.getByRole("button", { name: "Save changes" }).click();
  await expect(plan.item(`${r.title} + frozen peas`)).toBeVisible();
  await expect.poll(async () => (await planItems(household.hid))[0]?.sides).toEqual([{ ingredientId: "frozen-pea", portion: 80 }]);
});

test("sides go on the grocery list scaled by servings and rounded to packs; supply covers them (R7.11, R5.10)", { tag: ["@R7.11", "@R5.10"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Side grocery");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id], { sides: [FRIES] });
  await gotoGrocery(page);
  // 4 servings × 150 g = 600 g → 1 × 1 kg bag ($4.29 estimate).
  const fries = line(page, "French fries");
  await expect(fries).toContainText("×1");
  await expect(fries).toContainText("need 600 g →");
  await expect(fries).toContainText("1 kg");
  // 2 kg already in the freezer: nothing to buy.
  await seedSupply(household.hid, "french-fry", [{ amount: 2000, location: "freezer", expiresInDays: 200 }], { label: "french fries" });
  await expect(fries).toHaveCount(0, { timeout: 15_000 });
  await expect(line(page, "Chicken thigh")).toBeVisible();
});

test("Done cooking takes the side's portions out of Supply and the review lists them (R5.10, R9.3)", { tag: ["@R5.10"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Side cook", { leftovers: 0 });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id], { sides: [FRIES] });
  await seedSupply(household.hid, "french-fry", [{ amount: 2000, location: "freezer", expiresInDays: 200 }], { label: "french fries" });
  await page.goto(`/plan/${itemId}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expectSupply(household.hid, "french-fry", 1400);
  await expect.poll(async () => (await cookEvents(household.hid))[0]?.sides, { timeout: 20_000 }).toEqual([FRIES]);
  await page.getByRole("button", { name: "Next →" }).click();
  const fries = page.getByTestId("used-row").filter({ hasText: /French fries/i });
  await expect(fries).toContainText("600 g");
  await page.getByRole("button", { name: "Didn't use French fries" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Save & update supply" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  expect(await commandsSettled(household.hid, 2)).toEqual([]);
  await expectSupply(household.hid, "french-fry", 2000);
});

test("a saved meal keeps its sides and brings them back when planned again (R5.9, R5.8)", { tag: ["@R5.9"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Side saved");
  await seedPeriod(household.hid);
  const plan = new PlanPage(page);
  await plan.goto();
  const name = `Fish and chips ${Math.random().toString(36).slice(2, 6)}`;
  await plan.createMeal({ recipes: [r.title], sides: ["french fries", "coleslaw mix"], saveAs: name });
  await expect.poll(async () => (await adminDb.collection("meals").where("name", "==", name).get()).docs[0]?.data().sides).toEqual([FRIES, { ingredientId: "coleslaw-mix", portion: 80 }]);
  const item = plan.item(name);
  await expect(item.getByTestId("plan-item-sides")).toHaveText(/with french fries, coleslaw mix/i);
  // Planned again from Saved meals: the sides come with it.
  await plan.createMeal({ savedMeal: name });
  await expect.poll(async () => (await planItems(household.hid)).filter((i) => i.name === name).map((i) => i.sides)).toEqual([
    [FRIES, { ingredientId: "coleslaw-mix", portion: 80 }],
    [FRIES, { ingredientId: "coleslaw-mix", portion: 80 }],
  ]);
  await page.goto("/meals");
  await expect(page.getByTestId("meal-card").filter({ hasText: name }).getByTestId("meal-sides")).toHaveText(/with french fries, coleslaw mix/i);
});

test("Settings → Sides: change a portion for meals created afterwards, flag an ingredient, refuse a free-use one (R11.14)", { tag: ["@R11.14", "@R5.10"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Side settings");
  const pid = await seedPeriod(household.hid);
  const before = await seedPlanItem(household.hid, pid, [r.id], { sides: [FRIES] });
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Sides/ }).click();
  await expect(page).toHaveURL(/\/settings\/sides$/);
  const fries = page.getByTestId("side-row").filter({ hasText: /^french fries/i });
  await expect(fries.getByTestId("side-portion")).toHaveText("150 g");
  await expect(page.getByTestId("side-row").filter({ hasText: /^hamburger bun/i }).getByTestId("side-portion")).toHaveText("1 (55 g)");
  await fries.getByRole("button", { name: "Change portion of french fries" }).click();
  await fries.getByLabel("Portion per person (g)").fill("200");
  await fries.getByRole("button", { name: "Save" }).click();
  await expect(fries.getByTestId("side-portion")).toHaveText("200 g");
  await expect(fries).toContainText("Changed");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.sides).toEqual({ "french-fry": { portion: 200 } });

  // Free-use ingredients aren't tracked, so they can't be sides.
  const picker = page.getByRole("combobox", { name: "Ingredient to use as a side" });
  await picker.fill("dill pickle");
  await page.getByRole("option", { name: /^dill pickle/i }).click();
  await expect(page.getByRole("alert")).toContainText("free use");
  // Any other ingredient can be flagged.
  await picker.fill("green beans");
  await page.getByRole("option", { name: /^green beans/i }).click();
  await page.getByLabel("Portion per person (g)").fill("120");
  await page.getByRole("button", { name: "Add side" }).click();
  const beans = page.getByTestId("side-row").filter({ hasText: /^green beans/i });
  await expect(beans).toContainText("Household");
  await expect(beans.getByTestId("side-portion")).toHaveText("120 g");

  // New meals get the new portions; the meal planned before keeps 150 g.
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.createMeal({ recipes: [r.title], sides: ["french fries", "green beans"] });
  await expect.poll(async () => (await planItems(household.hid)).find((i) => i.id !== before)?.sides).toEqual([
    { ingredientId: "french-fry", portion: 200 },
    { ingredientId: "green-bean", portion: 120 },
  ]);
  expect((await adminDb.doc(`households/${household.hid}/planItems/${before}`).get()).data()?.sides).toEqual([FRIES]);
});

test("History lists a cooked meal's sides (R10.1, R5.9)", { tag: ["@R10.1", "@R5.9"] }, async ({ page, household }) => {
  await seedPeriod(household.hid);
  await adminDb.doc(`households/${household.hid}/cookEvents/side-ev`).set({
    recipeIds: ["r-gone"],
    titles: ["Pan-fried cod"],
    title: "Pan-fried cod",
    sides: [FRIES, { ingredientId: "frozen-pea", portion: 80 }],
    cookedBy: household.uid,
    cookedAt: Timestamp.fromMillis(Date.now() - 86_400_000),
    used: [{ ingredientId: "french-fry", canonicalAmount: 600 }],
    defaults: [{ ingredientId: "french-fry", canonicalAmount: 600 }],
    leftoverPortions: 0,
    reviewStatus: "done",
    ratedBy: [],
  });
  await page.goto("/history");
  const row = page.getByTestId("history-row").filter({ hasText: "Pan-fried cod" });
  await expect(row.getByTestId("history-sides")).toHaveText(/with french fries, frozen peas/i);
  // Search finds it by a side's name.
  await page.getByRole("searchbox").first().fill("peas");
  await expect(page.getByTestId("history-row")).toHaveCount(1);
});
