// supply.spec.ts (TECHNICAL_SPECS §14.1): starts empty; add via the ingredient picker in an allowed measurement;
// current (projected) in metric and imperial; Staples for free-use; per-lot expiry flags; expired lots excluded until
// Still good / Threw it out; freeze/thaw; ±5/±25 + Apply corrections; discard; filters; transaction history with
// infinite scroll; live for another member.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, seedPeriod, seedPlanItem } from "../pages/plan";
import { commandsSettled, expectSupply, seedSupply, supplyDoc, SupplyPage } from "../pages/supply";

test("starts empty; add an ingredient in an allowed measurement; shown in metric and imperial (R8.2, R8.3, R8.13)", { tag: ["@R8.2", "@R8.3", "@R8.13", "@R8.1", "@smoke"] }, async ({ page, household }) => {
  const supply = new SupplyPage(page);
  await supply.goto();
  await expect(page.getByText(/Supply starts empty/)).toBeVisible();
  await page.getByRole("button", { name: "+ Add" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to supply" });
  await sheet.getByLabel("Ingredient").fill("dried red lent");
  await sheet.getByRole("option", { name: /dried red lentil/i }).first().click();
  // Lentils allow weight and volume: 2 cups at 0.81 g/ml = 383 g.
  await sheet.getByRole("button", { name: "cups" }).click();
  await sheet.getByLabel("Amount").fill("2");
  await expect(sheet.getByText("= 380 g · 14 oz")).toBeVisible();
  await sheet.getByRole("button", { name: /^Add 380 g/ }).click();
  await expect(supply.row("Dried red lentil")).toBeVisible();
  await expect(supply.row("Dried red lentil").getByTestId("supply-current")).toHaveText("380 g · 14 oz");
  await expectSupply(household.hid, "dried-red-lentil", 383.273);
  // Supply is written by the function only: the command doc is what the client wrote.
  expect(await commandsSettled(household.hid)).toEqual([]);
  const cmds = await adminDb.collection(`households/${household.hid}/commands`).get();
  expect(cmds.docs.map((d) => d.data().type)).toEqual(["addSupply"]);
});

test("current (projected after planned meals); expiry flags per lot; Staples group (R8.4, R8.5, R8.14, R8.10, R8.11)", { tag: ["@R8.4", "@R8.5", "@R8.14", "@R8.10", "@R8.11"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Supply projection");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]); // 600 g chicken thigh, 140 g spinach
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 1000, expiresInDays: 9 }], { label: "chicken thigh" });
  await seedSupply(household.hid, "baby-spinach", [{ amount: 100, expiresInDays: 2 }, { amount: 50, boughtDaysAgo: 6, expiresInDays: 8 }], { label: "baby spinach" });
  await adminDb.doc(`households/${household.hid}/cadence/olive-oil`).set({ avgIntervalDays: 30, lastPurchasedAt: new Date(Date.now() - 5 * 86_400_000), purchaseCount: 3 });
  await adminDb.doc(`households/${household.hid}/supply/leftover_x`).set({ label: "Chicken tikka", canonicalUnit: "count", canonicalAmount: 2, lots: [{ lotId: "x", amount: 2, location: "fridge", acquiredAt: new Date(), expiresFresh: new Date(Date.now() + 3 * 86_400_000) }], cookEventId: "x" });
  const supply = new SupplyPage(page);
  await supply.goto();
  const chicken = supply.row("Chicken thigh");
  await expect(chicken.getByTestId("supply-current")).toHaveText("1.0 kg · 2.2 lb");
  await expect(chicken.getByTestId("supply-projected")).toHaveText("(400 g after plan)");
  await expect(chicken).toContainText(/Fresh · [89]D/i);
  const spinach = supply.row("Baby spinach");
  await expect(spinach.getByTestId("supply-projected")).toHaveText("(10 g after plan)");
  await expect(spinach).toContainText(/Use soon · [12]D/i);
  await expect(spinach).toContainText(/2 purchases/i);
  // Leftovers are their own items (R8.11); free-use staples show when last bought, no amount (R8.14).
  await expect(page.getByTestId("leftover-row")).toContainText("Chicken tikka");
  await expect(page.getByTestId("staples")).toContainText("Olive oil");
  await expect(page.getByTestId("staples")).not.toContainText(/\d g/);
  // Exact amounts, no confidence indicator (R8.10).
  await expect(page.getByText(/confidence|approx/i)).toHaveCount(0);
  // Each purchase has its own expiry.
  const open = await supply.open("Baby spinach");
  await expect(open.getByTestId("lot")).toHaveCount(2);
});

test("an expired lot stops counting until Still good or Threw it out; never discarded on its own (R8.15)", { tag: ["@R8.15"] }, async ({ page, household }) => {
  await seedSupply(household.hid, "milk", [{ amount: 1000, expiresInDays: -1 }], { label: "milk" });
  await seedSupply(household.hid, "egg", [{ amount: 300, expiresInDays: -2 }], { label: "egg" });
  const supply = new SupplyPage(page);
  await supply.goto();
  const prompts = page.getByTestId("expired-prompts");
  await expect(prompts.getByTestId("expired-lot")).toHaveCount(2);
  await expect(supply.row("Milk")).toContainText(/Expired/i);
  await expect(supply.row("Milk").getByTestId("supply-projected")).toHaveText("(0 g after plan)");
  await prompts.getByRole("button", { name: "Milk is still good" }).click();
  await expect(supply.row("Milk").getByTestId("supply-projected")).toHaveText("(1.0 kg after plan)");
  await expect(prompts.getByTestId("expired-lot")).toHaveCount(1);
  await prompts.getByRole("button", { name: "Threw out the Egg" }).click();
  await expect(prompts).toHaveCount(0);
  expect(await commandsSettled(household.hid, 2)).toEqual([]);
  const milk = await supplyDoc(household.hid, "milk");
  expect((milk!.lots[0]!.expiryExtendedTo as { toMillis(): number }).toMillis()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
  await expectSupply(household.hid, "egg", 0);
  const tx = await adminDb.collection(`households/${household.hid}/supply/egg/transactions`).where("kind", "==", "discard").get();
  expect(tx.size).toBe(1); // recorded for waste tracking (R8.9), not shown as a stat
});

test("freeze part of a lot, thaw it; correct with ±5/±25 + Apply; discard (R8.6, R8.8, R8.9)", { tag: ["@R8.6", "@R8.8", "@R8.9"] }, async ({ page, household }) => {
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 1000, expiresInDays: 2 }], { label: "chicken thigh" });
  const supply = new SupplyPage(page);
  await supply.goto();
  let row = await supply.open("Chicken thigh");
  await row.getByRole("button", { name: "❄ Freeze" }).click();
  await row.getByRole("button", { name: "Decrease amount to freeze" }).click(); // 1000 → 950
  await row.getByRole("button", { name: /^Freeze 950 g/ }).click();
  await expect(row.getByTestId("lot")).toHaveCount(2);
  await expect(row.getByTestId("lot").filter({ hasText: "950 g" })).toContainText(/Frozen/i);
  await commandsSettled(household.hid, 1);
  const d = await supplyDoc(household.hid, "chicken-thigh");
  const frozen = d!.lots.find((l) => l.location === "freezer")!;
  expect(frozen.amount).toBe(950);
  expect((frozen.expiresFrozen as { toMillis(): number }).toMillis()).toBeGreaterThan(Date.now() + 200 * 86_400_000);
  expect(frozen.expiresFresh).toBeTruthy(); // both estimates kept

  await row.getByTestId("lot").filter({ hasText: "950 g" }).getByRole("button", { name: "Thaw" }).click();
  await expect(row.getByTestId("lot").filter({ hasText: "950 g" })).not.toContainText(/Frozen/i);

  // Correction: type, nudge, Apply.
  const box = row.getByLabel("Correct it · I actually have");
  await box.fill("800");
  await row.getByRole("button", { name: "Add 25 g" }).click();
  await row.getByRole("button", { name: "Take off 5 g" }).click();
  await expect(box).toHaveValue("820");
  await row.getByRole("button", { name: "Apply" }).click();
  await expectSupply(household.hid, "chicken-thigh", 820);
  await expect(row.getByTestId("supply-current")).toHaveText("820 g · 1.8 lb");

  // Discard a purchase.
  await supply.goto();
  row = await supply.open("Chicken thigh");
  await row.getByTestId("lot").first().getByRole("button", { name: /Threw out this purchase/ }).click();
  await commandsSettled(household.hid, 4);
  expect((await supplyDoc(household.hid, "chicken-thigh"))!.lots).toHaveLength(1);
});

test("filters: location, category, expiring soon, low stock (R8.12)", { tag: ["@R8.12"] }, async ({ page, household }) => {
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 900, frozen: { frozenDaysAgo: 3, expiresInDays: 200 } }], { label: "chicken thigh" });
  await seedSupply(household.hid, "baby-spinach", [{ amount: 50, expiresInDays: 1 }], { label: "baby spinach" });
  await seedSupply(household.hid, "jasmine-rice", [{ amount: 5000, location: "pantry", expiresInDays: 300 }], { label: "jasmine rice" });
  const supply = new SupplyPage(page);
  await supply.goto();
  const names = () => page.getByTestId("supply-row");
  await expect(names()).toHaveCount(3);
  await page.getByRole("group", { name: "Location" }).getByRole("button", { name: "Freezer" }).click();
  await expect(names()).toHaveCount(1);
  await expect(supply.row("Chicken thigh")).toBeVisible();
  await page.getByRole("group", { name: "Location" }).getByRole("button", { name: "All" }).click();
  await page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Grains" }).click();
  await expect(names()).toHaveCount(1);
  await expect(supply.row("Jasmine rice")).toBeVisible();
  await page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Grains" }).click();
  await page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Expiring soon" }).click();
  await expect(names()).toHaveCount(1);
  await expect(supply.row("Baby spinach")).toBeVisible();
  await page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Expiring soon" }).click();
  await page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Low stock" }).click();
  await expect(supply.row("Baby spinach")).toBeVisible(); // 50 g of a 312 g bag
  await expect(supply.row("Jasmine rice")).toHaveCount(0);
  await expect(page).toHaveURL(/low=true/);
});

test("transaction history: every change with date and who, loads more as you scroll (R8.7)", { tag: ["@R8.7"] }, async ({ page, household }) => {
  await seedSupply(household.hid, "jasmine-rice", [{ amount: 5000, location: "pantry", expiresInDays: 300 }], { label: "jasmine rice" });
  // 40 older changes so the list needs a second page.
  const ref = adminDb.collection(`households/${household.hid}/supply/jasmine-rice/transactions`);
  const b = adminDb.batch();
  for (let i = 0; i < 40; i++) b.set(ref.doc(`old${String(i).padStart(2, "0")}`), { delta: -10, kind: "cook", lotId: "seed0", uid: household.uid, note: `Meal ${i}`, createdAt: new Date(Date.now() - (i + 2) * 60_000) });
  await b.commit();
  await page.goto("/supply/jasmine-rice");
  const ledger = page.getByTestId("ledger");
  await expect(ledger.getByTestId("ledger-row")).toHaveCount(25);
  await expect(ledger.getByTestId("ledger-row").first()).toContainText("Cooked");
  await expect(ledger.getByTestId("ledger-row").first()).toContainText(household.displayName, { ignoreCase: true });
  await page.getByRole("button", { name: "Load older changes" }).scrollIntoViewIfNeeded();
  await expect(ledger.getByTestId("ledger-row")).toHaveCount(41, { timeout: 15_000 });
  await expect(ledger.getByTestId("ledger-row").last()).toContainText("Bought");
});

test("another member sees supply change without a reload (NFR5)", { tag: ["@NFR5"] }, async ({ page, household, secondMember }) => {
  await seedSupply(household.hid, "jasmine-rice", [{ amount: 2000, location: "pantry", expiresInDays: 300 }], { label: "jasmine rice" });
  const mine = new SupplyPage(page);
  await mine.goto();
  const theirs = new SupplyPage(secondMember.page);
  await theirs.goto();
  await expect(theirs.row("Jasmine rice").getByTestId("supply-current")).toHaveText("2.0 kg · 4.4 lb");
  const row = await mine.open("Jasmine rice");
  await row.getByLabel("Correct it · I actually have").fill("1500");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(theirs.row("Jasmine rice").getByTestId("supply-current")).toHaveText("1.5 kg · 3.3 lb", { timeout: 20_000 });
});
