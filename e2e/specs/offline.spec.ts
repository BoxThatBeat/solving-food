// offline.spec.ts (TECHNICAL_SPECS §12 "Offline", §14.1): with the network off, adjust supply, finish a meal, and tick
// groceries; back online, the queued commands apply and everything syncs.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";
import { commandsSettled, expectSupply, makeCookRecipe, seedSupply, SupplyPage } from "../pages/supply";

test("finish a meal, correct supply, and tick groceries offline; they apply after reconnecting", { tag: ["@NFR5"] }, async ({ page, household, context }) => {
  const r = await makeCookRecipe("Offline dinner", { leftovers: 0 });
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id]);
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 1000, expiresInDays: 3 }], { label: "chicken thigh" });
  await seedSupply(household.hid, "jasmine-rice", [{ amount: 2000, location: "pantry", expiresInDays: 300 }], { label: "jasmine rice" });

  // Visit every screen once online, in one page session (routes are code-split and the service worker that precaches
  // them is off in e2e), then drop the network.
  const plan = new PlanPage(page);
  await plan.goto();
  await plan.item(r.title).getByRole("button", { name: `Cook ${r.title}` }).click();
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  await page.getByRole("button", { name: "Stop cooking" }).click();
  await page.getByRole("link", { name: "Grocery" }).first().click();
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => Object.keys((await adminDb.doc(`households/${household.hid}/groceryLists/draft`).get()).data()?.items ?? {}).length).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Supply" }).first().click();
  const supply = new SupplyPage(page);
  await expect(supply.row("Jasmine rice")).toBeVisible();
  await context.setOffline(true);

  // Correct supply: shown at once (pending), applied later.
  const rice = await supply.open("Jasmine rice");
  await rice.getByLabel("Correct it · I actually have").fill("1500");
  await rice.getByRole("button", { name: "Apply" }).click();
  await expect(rice.getByTestId("supply-current")).toHaveText("1.5 kg · 3.3 lb");
  await expect(page.getByTestId("supply-count")).toContainText("SYNCING");

  // Tick a grocery line.
  await page.getByRole("link", { name: "Grocery" }).first().click();
  const line = page.getByTestId("grocery-line").first();
  await line.getByRole("checkbox").click();
  await expect(line.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");

  // Finish the meal; the review opens from the queued command.
  await page.getByRole("link", { name: "Plan" }).first().click();
  await plan.item(r.title).getByRole("button", { name: `Cook ${r.title}` }).click();
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page.getByText(/Syncing · supply updates when you're back online/)).toBeVisible();
  await page.getByRole("button", { name: "Review later" }).click();
  await expect(plan.item(r.title).getByTestId("plan-item-status")).toHaveText(/cooked/i);

  // Nothing reached the server yet.
  expect((await adminDb.collection(`households/${household.hid}/commands`).get()).size).toBe(0);

  await context.setOffline(false);
  expect(await commandsSettled(household.hid, 2, 45_000)).toEqual([]);
  await expectSupply(household.hid, "jasmine-rice", 1500);
  await expectSupply(household.hid, "chicken-thigh", 400);
  expect((await adminDb.doc(`households/${household.hid}/planItems/${itemId}`).get()).data()!.status).toBe("cooked");
  const draft = (await adminDb.doc(`households/${household.hid}/groceryLists/draft`).get()).data()!;
  expect(Object.values(draft.items as Record<string, { checked: boolean }>).some((it) => it.checked)).toBe(true);
});
