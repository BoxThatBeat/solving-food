// rollover.spec.ts (TECHNICAL_SPECS §14.1, §7 "Periods & rollover"): when the current period has ended, opening the
// app creates the next period (budget snapshot), carries uncooked planned items into it, and advances the household;
// two members opening at once create one period and one copy of each item. Boundaries across DST are unit-tested
// in packages/core (period.test.ts).
import { addDays, localDate, nextPeriod, periodBounds } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, seedPeriod, seedPlanItem, TZ } from "../pages/plan";

async function endedPeriod(hid: string): Promise<{ oldId: string; newId: string }> {
  const start = addDays(localDate(Date.now(), TZ), -9); // a 7-day period that ended two days ago
  const oldId = await seedPeriod(hid, { startDate: start, days: 7, budgetCents: 15000 });
  const old = periodBounds(start, 7, TZ);
  const next = nextPeriod(old.endMs, 7, TZ, Date.now());
  return { oldId, newId: next.id };
}

test("uncooked meals roll over into the next period when it ends (R6.6)", { tag: ["@R6.6", "@smoke"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Never got cooked");
  const done = await makePlanRecipe("Cooked last week");
  const { oldId, newId } = await endedPeriod(household.hid);
  await adminDb.doc(`households/${household.hid}`).update({ budgetCents: 18000 });
  const planned = await seedPlanItem(household.hid, oldId, [r.id], { name: "Leftover plan" });
  await seedPlanItem(household.hid, oldId, [done.id], { status: "cooked" });

  const plan = new PlanPage(page);
  await page.goto("/plan");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()!.currentPeriodId, { timeout: 20_000 }).toBe(newId);
  await plan.goto();
  await expect(plan.item("Leftover plan")).toBeVisible();
  await expect(plan.item("Leftover plan")).toContainText("Carried over");
  await expect(plan.item(done.title)).toHaveCount(0);
  await expect(plan.budgetLeft()).not.toHaveText("$150.00"); // the new period snapshots the household's budget
  await expect(plan.stripCount("dinner")).toHaveText("1/7");

  const period = (await adminDb.doc(`households/${household.hid}/periods/${newId}`).get()).data()!;
  expect(period.budgetCents).toBe(18000);
  const carried = await adminDb.collection(`households/${household.hid}/planItems`).where("periodId", "==", newId).get();
  expect(carried.docs.map((d) => d.data())).toEqual([expect.objectContaining({ carriedFromId: planned, status: "planned", recipes: [{ recipeId: r.id, servingsMultiplier: 1 }] })]);
  // The old period keeps its history.
  expect((await adminDb.doc(`households/${household.hid}/planItems/${planned}`).get()).data()!.periodId).toBe(oldId);
});

test("two members opening the app at once create one period and one copy of each meal (R6.6)", { tag: ["@R6.6"] }, async ({ page, household, secondMember }) => {
  const r = await makePlanRecipe("Race to roll over");
  const { oldId, newId } = await endedPeriod(household.hid);
  const planned = await seedPlanItem(household.hid, oldId, [r.id]);
  await Promise.all([page.goto("/plan"), secondMember.page.goto("/plan")]);
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()!.currentPeriodId, { timeout: 20_000 }).toBe(newId);
  await Promise.all([page.reload(), secondMember.page.reload()]);
  await expect(new PlanPage(page).item(r.title)).toBeVisible();
  await expect(new PlanPage(secondMember.page).item(r.title)).toBeVisible();
  const copies = await adminDb.collection(`households/${household.hid}/planItems`).where("carriedFromId", "==", planned).get();
  expect(copies.size).toBe(1);
  const inNew = await adminDb.collection(`households/${household.hid}/planItems`).where("periodId", "==", newId).get();
  expect(inNew.size).toBe(1);
});
