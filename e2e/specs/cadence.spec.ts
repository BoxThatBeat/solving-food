// cadence.spec.ts (Planning/M5 "grocery (cadence prompts)"): "Are you out of …?" for staples once 85 % of the usual
// interval has passed (the seed's typical interval until bought twice); Yes adds it to the list, Not yet snoozes it
// through a command.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { seedPeriod } from "../pages/plan";
import { commandsSettled } from "../pages/supply";

const DAY = 86_400_000;

test("staples cadence: asks when it's probably running low; Yes adds it, Not yet snoozes (R7.7)", { tag: ["@R7.7"] }, async ({ page, household }) => {
  await seedPeriod(household.hid);
  const now = Date.now();
  // Bread: bought every 4 days (learned), last 4 days ago. Coffee: bought once 20 days ago; the seed says every 21 days.
  await adminDb.doc(`households/${household.hid}/cadence/whole-wheat-bread`).set({ avgIntervalDays: 4, lastPurchasedAt: new Date(now - 4 * DAY), purchaseCount: 3 });
  await adminDb.doc(`households/${household.hid}/cadence/ground-coffee`).set({ avgIntervalDays: null, lastPurchasedAt: new Date(now - 20 * DAY), purchaseCount: 1 });
  // Bought yesterday: not due.
  await adminDb.doc(`households/${household.hid}/cadence/all-purpose-flour`).set({ avgIntervalDays: 30, lastPurchasedAt: new Date(now - DAY), purchaseCount: 2 });

  await page.goto("/grocery");
  const prompt = page.getByTestId("cadence-prompt");
  await expect(prompt).toContainText("Are you out of whole wheat bread?", { timeout: 20_000 });
  await expect(prompt).toContainText("You usually buy it every 4 days.");
  await prompt.getByRole("button", { name: "Not yet" }).click();
  expect(await commandsSettled(household.hid)).toEqual([]);
  const bread = (await adminDb.doc(`households/${household.hid}/cadence/whole-wheat-bread`).get()).data()!;
  expect(bread.snoozedUntil.toMillis()).toBeGreaterThan(now + 0.9 * DAY);

  await expect(prompt).toContainText("Are you out of ground coffee?");
  await expect(prompt).toContainText("every 21 days");
  await prompt.getByRole("button", { name: "Yes, add it" }).click();
  await expect(page.getByText(/Added .* to the list/)).toBeVisible();
  await expect(prompt).toBeHidden();
  await expect
    .poll(async () => (await adminDb.doc(`households/${household.hid}/groceryLists/draft`).get()).data()?.items?.["cadence_ground-coffee"]?.source)
    .toBe("cadence");

  // The Plan page asks too (nothing due now).
  await page.goto("/plan");
  await expect(page.getByTestId("cadence-prompt")).toHaveCount(0);
});
