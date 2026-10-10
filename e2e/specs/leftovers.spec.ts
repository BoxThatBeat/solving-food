// leftovers.spec.ts (TECHNICAL_SPECS §14.1): a meal-prep batch fills lunch cells when planned; the confirmed ▲/▼ count
// replaces the estimate; the leftover supply item has an expiry; leftover plan items roll over; mark eaten (leftovers,
// cooked meals, snacks).
import { addDays, localDate, nextPeriod, periodBounds } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { PlanPage, seedPeriod, seedPlanItem, TZ } from "../pages/plan";
import { commandsSettled, cookEvents, expectSupply, makeCookRecipe, supplyDoc } from "../pages/supply";

test("cooking a batch turns its leftovers into supply portions with a use-by and lunch items that fill the strip (R6.8, R6.10, R6.9, R8.11)", { tag: ["@R6.8", "@R6.10", "@R6.9", "@R8.11"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Batch cook", { leftovers: 3 });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id], { coverage: { dinner: 1, lunch: 3 } });
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.stripCount("lunch")).toHaveText("3/7"); // planned meal prep fills lunches straight away
  await page.goto(`/plan/${itemId}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await page.getByRole("tab", { name: "3 · Leftovers" }).click();
  await expect(page.getByText("Estimated leftovers: 3 portions. Correct?")).toBeVisible();
  await page.getByRole("button", { name: "More leftovers" }).click();
  await expect(page.getByTestId("leftover-count")).toHaveText("4");
  await page.getByRole("button", { name: "Save & update supply" }).click();
  expect(await commandsSettled(household.hid, 2)).toEqual([]);
  const [ev] = await cookEvents(household.hid);
  await expectSupply(household.hid, `leftover_${ev!.id}`, 4);
  const lo = await supplyDoc(household.hid, `leftover_${ev!.id}`);
  const expires = (lo!.lots[0]!.expiresFresh as { toMillis(): number }).toMillis();
  expect(expires - Date.now()).toBeGreaterThan(3 * 86_400_000);
  expect(expires - Date.now()).toBeLessThan(5 * 86_400_000); // 4 days in the fridge (R6.10)

  await plan.goto();
  await expect(page.getByTestId("plan-item").filter({ hasText: "Leftover" })).toHaveCount(4);
  await expect(plan.stripCount("lunch")).toHaveText("4/7");
  await expect(plan.stripCount("dinner")).toHaveText("1/7");
  await page.goto("/supply");
  await expect(page.getByTestId("leftover-row")).toContainText(r.title);
});

test("mark eaten: a leftover portion leaves supply and its cell turns solid; a cooked meal and a snack too (R9.5, R6.2)", { tag: ["@R9.5", "@R6.2"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Eat it", { leftovers: 1 });
  const snack = await makeCookRecipe("Snack it", { leftovers: 0, lines: "Slice @tomato{125%g}." });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id]);
  await seedPlanItem(household.hid, pid, [snack.id], { mealType: "snack", coverage: {}, name: "Afternoon snack" });
  await page.goto(`/plan/${itemId}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await page.getByRole("button", { name: "Review later" }).click();
  await commandsSettled(household.hid);
  const plan = new PlanPage(page);
  await plan.goto();
  const leftover = page.getByTestId("plan-item").filter({ hasText: "Leftover" });
  await leftover.getByRole("button", { name: /^Ate one/ }).click();
  await expect(leftover.getByTestId("plan-item-status")).toHaveText(/eaten/i);
  const cooked = plan.item(r.title).filter({ hasNotText: "Leftover" });
  await cooked.getByRole("button", { name: `Mark ${r.title} eaten` }).click();
  await plan.item("Afternoon snack").getByRole("button", { name: "Mark Afternoon snack eaten" }).click();
  expect(await commandsSettled(household.hid, 4)).toEqual([]);
  const [ev] = await cookEvents(household.hid);
  await expectSupply(household.hid, `leftover_${ev!.id}`, 0);
  const items = (await adminDb.collection(`households/${household.hid}/planItems`).get()).docs.map((d) => d.data().status);
  expect(items.sort()).toEqual(["eaten", "eaten", "eaten"]);
  await expect(plan.stripCount("lunch")).toHaveText("1/7"); // eaten leftovers still fill their (now solid) cell
});

test("leftovers still good roll over into the next period; expired ones stay behind (R6.8, R6.6)", { tag: ["@R6.8", "@R6.6"] }, async ({ page, household }) => {
  const start = addDays(localDate(Date.now(), TZ), -9);
  const oldId = await seedPeriod(household.hid, { startDate: start, days: 7 });
  const next = nextPeriod(periodBounds(start, 7, TZ).endMs, 7, TZ, Date.now());
  const day = 86_400_000;
  await adminDb.doc(`households/${household.hid}/supply/leftover_good`).set({ label: "Good batch", canonicalUnit: "count", canonicalAmount: 1, lots: [{ lotId: "good", amount: 1, location: "fridge", acquiredAt: new Date(Date.now() - day), expiresFresh: new Date(Date.now() + 3 * day) }], cookEventId: "good" });
  await adminDb.doc(`households/${household.hid}/supply/leftover_old`).set({ label: "Old batch", canonicalUnit: "count", canonicalAmount: 1, lots: [{ lotId: "old", amount: 1, location: "fridge", acquiredAt: new Date(Date.now() - 6 * day), expiresFresh: new Date(Date.now() - day) }], cookEventId: "old" });
  for (const [id, name] of [["leftover_good", "Good batch"], ["leftover_old", "Old batch"]] as const) {
    await seedPlanItem(household.hid, oldId, [], { kind: "leftover", mealType: "lunch", servings: 1, name, leftoverSupplyId: id, coverage: { lunch: 1 } });
  }
  await page.goto("/plan");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()!.currentPeriodId, { timeout: 20_000 }).toBe(next.id);
  const carried = await adminDb.collection(`households/${household.hid}/planItems`).where("periodId", "==", next.id).get();
  expect(carried.docs.map((d) => d.data().name)).toEqual(["Good batch"]);
});
