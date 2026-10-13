// cadence.spec.ts (Planning/M5 "grocery (cadence prompts)", reworked in M10): staples are on the grocery list by
// themselves when they're due (R7.12): the cadence says they're probably running low (85 % of the usual interval, the
// seed's typical interval until bought twice; R7.7), or a planned meal uses a free-use staple the household has never
// bought (R8.14). Not when already on a list; removing one keeps it off for its usual interval. No more prompt.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, seedPeriod, seedPlanItem } from "../pages/plan";
import type { Page } from "@playwright/test";

const DAY = 86_400_000;
const line = (page: Page, name: string | RegExp) => page.getByTestId("grocery-line").filter({ hasText: name });
const draft = async (hid: string) => (await adminDb.doc(`households/${hid}/groceryLists/draft`).get()).data();

test("staples that are due appear on the list by themselves, in a Staples group; not when bought recently or already listed (R7.7, R7.12)", { tag: ["@R7.7", "@R7.12"] }, async ({ page, household }) => {
  const pid = await seedPeriod(household.hid);
  const now = Date.now();
  // Bread: bought every 4 days (learned), last 4 days ago → due. Coffee: bought once 20 days ago; the seed says every
  // 21 days → due. Olive oil (free-use): bought yesterday → not due. Milk: due, but already on the list by hand.
  await adminDb.doc(`households/${household.hid}/cadence/whole-wheat-bread`).set({ avgIntervalDays: 4, lastPurchasedAt: new Date(now - 4 * DAY), purchaseCount: 3 });
  await adminDb.doc(`households/${household.hid}/cadence/ground-coffee`).set({ avgIntervalDays: null, lastPurchasedAt: new Date(now - 20 * DAY), purchaseCount: 1 });
  await adminDb.doc(`households/${household.hid}/cadence/olive-oil`).set({ avgIntervalDays: 30, lastPurchasedAt: new Date(now - DAY), purchaseCount: 2 });
  await adminDb.doc(`households/${household.hid}/cadence/milk`).set({ avgIntervalDays: 4, lastPurchasedAt: new Date(now - 6 * DAY), purchaseCount: 4 });
  await adminDb.doc(`households/${household.hid}/groceryLists/draft`).set({
    periodId: pid,
    status: "draft",
    createdAt: new Date(),
    items: { manual_milk: { ingredientId: "milk", amount: 4120, measure: "g", packs: 1, productName: "Milk", storeId: "pc-express", estPriceCents: 699, source: "manual", checked: false } },
  });

  await page.goto("/grocery");
  const pcx = page.getByTestId("store-pcExpress");
  await expect(line(page, /whole wheat bread/i)).toContainText("probably running low", { timeout: 20_000 });
  await expect(line(page, /ground coffee/i)).toContainText("probably running low");
  await expect(line(page, /olive oil/i)).toHaveCount(0);
  await expect(line(page, /^Milk/)).toHaveCount(1); // the hand-added line only
  await expect(pcx.getByTestId("staples-divider")).toHaveText(/staples/i);
  // No question any more, on either page.
  await expect(page.getByText(/Are you out of/)).toHaveCount(0);
  await expect.poll(async () => Object.keys((await draft(household.hid))?.items ?? {}).sort()).toEqual(["manual_milk", "staple_ground-coffee", "staple_whole-wheat-bread"]);
  // Staples are bought outside recipes: the budget meter doesn't count them (R6.4).
  await page.goto("/plan");
  await expect(page.getByText(/Are you out of/)).toHaveCount(0);
});

test("a free-use staple a planned meal uses is listed until bought; removing a staple keeps it off (R7.12, R8.14)", { tag: ["@R7.12", "@R8.14"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Staple skillet", { lines: "Sear @chicken thigh{600%g} in @olive oil{2%tbsp} with @salt{}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await adminDb.doc(`households/${household.hid}/cadence/whole-wheat-bread`).set({ avgIntervalDays: 4, lastPurchasedAt: new Date(Date.now() - 5 * 86_400_000), purchaseCount: 3 });
  await page.goto("/grocery");
  // Olive oil (2 tbsp) is a staple line; salt "to taste" has no amount, so it isn't.
  const oil = line(page, /olive oil/i);
  await expect(oil).toContainText("used by planned meals", { timeout: 20_000 });
  await expect(line(page, /^Salt/)).toHaveCount(0);
  // Each staple line can be ticked and removed like a manual one.
  await oil.getByRole("checkbox").click();
  await expect(oil.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await oil.getByRole("button", { name: /^Remove / }).click();
  await expect(oil).toHaveCount(0);
  await line(page, /whole wheat bread/i).getByRole("button", { name: /^Remove / }).click();
  await expect(line(page, /whole wheat bread/i)).toHaveCount(0);
  await expect.poll(async () => Object.keys((await draft(household.hid))?.dismissedStaples ?? {}).sort()).toEqual(["olive-oil", "whole-wheat-bread"]);
  const until = (await draft(household.hid))!.dismissedStaples as Record<string, number>;
  expect(until["olive-oil"]).toBeGreaterThan(Date.now() + 25 * 86_400_000); // its usual 30-day interval
  // Not added back on reload or regenerate.
  await page.reload();
  await expect(line(page, /chicken thigh/i)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(line(page, /olive oil/i)).toHaveCount(0);
  await expect(line(page, /whole wheat bread/i)).toHaveCount(0);
});
