// rollover.spec.ts (TECHNICAL_SPECS §14.1, §7 "Periods & rollover"): when the current period has ended, opening the
// app creates the next period (budget snapshot), carries uncooked planned items into it, and advances the household;
// two members opening at once create one period and one copy of each item. Boundaries across DST are unit-tested
// in packages/core (period.test.ts). M7: "Restart period" in Settings → Household (R3.1) uses the same carry code.
import { addDays, formatPeriodRange, localDate, nextPeriod, periodBounds } from "../../packages/core/src/index";
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

test("restart the period for tomorrow from Settings: planned meals move, cooked ones and the old period stay (R3.1)", { tag: ["@R3.1"] }, async ({ page, household }) => {
  const a = await makePlanRecipe("Restart carries me");
  const b = await makePlanRecipe("Restart carries me too");
  const done = await makePlanRecipe("Cooked before the restart");
  const start = addDays(localDate(Date.now(), TZ), -3);
  const oldId = await seedPeriod(household.hid, { startDate: start, days: 7 });
  const first = await seedPlanItem(household.hid, oldId, [a.id], { name: "First meal" });
  const second = await seedPlanItem(household.hid, oldId, [b.id], { name: "Second meal" });
  const cooked = await seedPlanItem(household.hid, oldId, [done.id], { status: "cooked" });
  const next = periodBounds(addDays(localDate(Date.now(), TZ), 1), 7, TZ);

  await page.goto("/settings/household");
  const group = page.getByRole("group", { name: "Restart period" });
  // Today on a period that started three days ago restarts too; here we pick tomorrow.
  await group.getByRole("button", { name: "Tomorrow" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Restart the period tomorrow?" });
  await expect(dialog).toContainText("Ends the current period now; 2 planned meals move to the new one");
  await dialog.getByRole("button", { name: "Restart period" }).click();
  await expect(page.getByTestId("notifications")).toContainText("New period started tomorrow · 2 planned meals moved");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()!.currentPeriodId).toBe(next.id);

  const plan = new PlanPage(page);
  await plan.goto();
  await expect(page.getByTestId("period-range")).toContainText(formatPeriodRange(next.startMs, next.endMs, TZ));
  await expect(plan.item("First meal")).toContainText("Carried over");
  await expect(plan.item("Second meal")).toBeVisible();
  await expect(plan.item(done.title)).toHaveCount(0);
  await expect(plan.stripCount("dinner")).toHaveText("2/7");

  const carried = await adminDb.collection(`households/${household.hid}/planItems`).where("periodId", "==", next.id).get();
  expect(carried.docs.map((d) => d.data().carriedFromId).sort()).toEqual([first, second].sort());
  // The old period is kept, ends where the new one starts, and keeps its cooked meal and the originals.
  const old = (await adminDb.doc(`households/${household.hid}/periods/${oldId}`).get()).data()!;
  expect(old.end.toMillis()).toBe(next.startMs);
  expect((await adminDb.doc(`households/${household.hid}/planItems/${cooked}`).get()).data()).toMatchObject({ periodId: oldId, status: "cooked" });

  // Tomorrow again is a no-op; Today moves the not-yet-started period to today without carrying anything again.
  await page.goto("/settings/household");
  await group.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByTestId("notifications")).toContainText("The current period already starts tomorrow");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await group.getByRole("button", { name: "Today" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restart period" }).click();
  await expect(page.getByTestId("notifications")).toContainText("The period now starts today");
  const today = periodBounds(localDate(Date.now(), TZ), 7, TZ);
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/periods/${next.id}`).get()).data()!.start.toMillis()).toBe(today.startMs);
  expect((await adminDb.collection(`households/${household.hid}/planItems`).where("periodId", "==", next.id).get()).size).toBe(2);
});
