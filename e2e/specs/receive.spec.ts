// receive.spec.ts (TECHNICAL_SPECS §14.1): confirm unchanged = everything bought; edit quantities, substitutions, and
// "didn't come"; the freeze prompt for bulk freezable items; supply updated, the list received, cadence recorded.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { PlanPage, seedPeriod } from "../pages/plan";
import { commandsSettled, expectSupply, groceryLine, seedOrderedList, supplyDoc } from "../pages/supply";
import type { Page } from "@playwright/test";

async function openConfirm(page: Page) {
  await page.goto("/grocery");
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("button", { name: /Groceries arrived\? Confirm/ }).click();
  const sheet = page.getByRole("dialog", { name: "Confirm groceries" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("confirming an unchanged order adds everything to supply and marks the list received (R7.8, R6.3)", { tag: ["@R7.8", "@R6.3", "@smoke"] }, async ({ page, household }) => {
  const pid = await seedPeriod(household.hid);
  const listId = await seedOrderedList(household.hid, pid, {
    "baby-spinach": groceryLine({ ingredientId: "baby-spinach", amount: 312, packAmount: 312, packLabel: "312 g", productName: "Organic baby spinach", storeId: "pc-express", estPriceCents: 499 }),
    "jasmine-rice": groceryLine({ ingredientId: "jasmine-rice", amount: 8000, packAmount: 8000, packLabel: "8 kg", productName: "Jasmine rice", storeId: "pc-express", estPriceCents: 1999 }),
    manual_x: groceryLine({ freeText: "Birthday candles", amount: 0, productName: "Birthday candles", storeId: "pc-express" }),
  });
  const sheet = await openConfirm(page);
  await expect(sheet.getByTestId("receive-line")).toHaveCount(3);
  await sheet.getByRole("button", { name: "Everything arrived · add to supply" }).click();
  await expect(page.getByTestId("notifications")).toContainText(/Supply updated · 3 items added/);
  expect(await commandsSettled(household.hid)).toEqual([]);
  await expectSupply(household.hid, "baby-spinach", 312);
  await expectSupply(household.hid, "jasmine-rice", 8000);
  const list = (await adminDb.doc(`households/${household.hid}/groceryLists/${listId}`).get()).data()!;
  expect(list.status).toBe("received");
  expect(list.receivedCents).toBe(499 + 1999);
  expect((await adminDb.doc(`households/${household.hid}/cadence/jasmine-rice`).get()).exists).toBe(true);
  await expect(page.getByTestId("ordered-list")).toHaveCount(0);
});

test("pack counts, a substitution, and an item that didn't come (R7.8)", { tag: ["@R7.8"] }, async ({ page, household }) => {
  const pid = await seedPeriod(household.hid);
  await seedOrderedList(household.hid, pid, {
    "baby-spinach": groceryLine({ ingredientId: "baby-spinach", amount: 312, packAmount: 312, packLabel: "312 g", productName: "Organic baby spinach", storeId: "pc-express", estPriceCents: 499 }),
    "feta-cheese": groceryLine({ ingredientId: "feta-cheese", amount: 200, packAmount: 200, packLabel: "200 g", productName: "Krinos Greek feta", storeId: "pc-express", estPriceCents: 599 }),
    "jasmine-rice": groceryLine({ ingredientId: "jasmine-rice", amount: 8000, packAmount: 8000, packLabel: "8 kg", productName: "Jasmine rice", storeId: "pc-express", estPriceCents: 1999 }),
  });
  const sheet = await openConfirm(page);
  await sheet.getByRole("button", { name: "More Organic baby spinach" }).click(); // 2 bags arrived
  await sheet.getByRole("button", { name: "Krinos Greek feta arrived" }).click(); // → didn't come
  await expect(sheet.getByRole("button", { name: "Krinos Greek feta didn't come" })).toBeVisible();
  // Basmati instead of jasmine.
  await sheet.getByTestId("receive-line").filter({ hasText: "Jasmine rice" }).getByRole("button", { name: "Got something else instead" }).click();
  await sheet.getByLabel("What arrived instead").fill("basmati");
  await sheet.getByRole("option", { name: /basmati rice/i }).first().click();
  await expect(sheet.getByTestId("receive-line").filter({ hasText: /instead of Jasmine rice/i })).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm with changes" }).click();
  expect(await commandsSettled(household.hid)).toEqual([]);
  await expectSupply(household.hid, "baby-spinach", 624);
  await expectSupply(household.hid, "basmati-rice", 8000);
  expect(await supplyDoc(household.hid, "feta-cheese")).toBeUndefined();
  expect(await supplyDoc(household.hid, "jasmine-rice")).toBeUndefined();
});

test("a bulk buy of something freezable asks to freeze some (R7.9)", { tag: ["@R7.9"] }, async ({ page, household }) => {
  const pid = await seedPeriod(household.hid);
  await seedOrderedList(household.hid, pid, {
    "chicken-thigh": groceryLine({ ingredientId: "chicken-thigh", amount: 3000, packAmount: 3000, packLabel: "3 kg", productName: "Kirkland boneless thighs", storeId: "costco", estPriceCents: 3000 }),
    "jasmine-rice": groceryLine({ ingredientId: "jasmine-rice", amount: 8000, packAmount: 8000, packLabel: "8 kg", productName: "Kirkland jasmine rice", storeId: "costco", estPriceCents: 1999 }),
  });
  const sheet = await openConfirm(page);
  await sheet.getByRole("button", { name: "Everything arrived · add to supply" }).click();
  const bulk = page.getByRole("dialog", { name: "Bulk buy" });
  await expect(bulk.getByTestId("freeze-prompt")).toContainText("Freeze some of this?"); // only the chicken: rice doesn't freeze
  await expect(bulk.getByTestId("freeze-prompt")).toContainText("3.0 kg of chicken thigh arrived");
  await bulk.getByRole("button", { name: "Increase amount to freeze" }).click(); // 1500 → 1750
  await bulk.getByRole("button", { name: /^Freeze 1\.8 kg/ }).click();
  expect(await commandsSettled(household.hid)).toEqual([]);
  const d = await supplyDoc(household.hid, "chicken-thigh");
  expect(d!.canonicalAmount).toBe(3000);
  expect(d!.lots.map((l) => [l.location, l.amount]).sort()).toEqual([
    ["freezer", 1750],
    ["fridge", 1250],
  ]);
  // The plan's meter no longer counts what's in supply: nothing extra to buy for it (R6.3 goes back up).
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.budgetLeft()).toHaveText("$200.00");
});
