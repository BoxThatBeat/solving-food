// grocery.spec.ts, M2 parts (TECHNICAL_SPECS §14.1): the list is plan − supply − incoming rounded to packs (mapping,
// default pack, or raw); free-use ingredients excluded; brand names applied; grouped by store with the mapping beating
// a category rule; Copy copies only the PC Express section and marks the list ordered (with Undo); regenerating doesn't
// re-add ordered items; manual additions; live ticks. Expired lots and cadence prompts arrive with Supply (M3/M5).
import { adminDb } from "../fixtures/admin";
import { forgetIngredients } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, seedPeriod, seedPlanItem, TZ } from "../pages/plan";
import { seedSupply } from "../pages/supply";
import { addDays, localDate } from "../../packages/core/src/index";
import type { Page } from "@playwright/test";

const line = (page: Page, name: string | RegExp) => page.getByTestId("grocery-line").filter({ hasText: name });

async function gotoGrocery(page: Page) {
  await page.goto("/grocery");
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
}

test("built from the plan, rounded to packs, free-use not a plan line, metric only (R7.1, R7.2, R8.13, R8.14)", { tag: ["@R7.1", "@R7.2", "@R8.13", "@R8.14", "@smoke"] }, async ({ page, household }) => {
  const raw = `e2e-loose-${Math.random().toString(36).slice(2, 8)}`;
  await adminDb.doc(`ingredients/${raw}`).set({ name: raw.replace(/-/g, " "), aliases: [], category: "produce", defaultLocation: "fridge", allowedMeasures: ["weight"], canonicalUnit: "g", proteinPer100g: 1, shelfLifeDays: { fridge: 5 }, freezable: false, isStaple: false, freeUse: false, needsReview: false });
  forgetIngredients();
  const r = await makePlanRecipe("Grocery chicken", { lines: `Sear @chicken thigh{600%g} in @olive oil{2%tbsp}, wilt @baby spinach{140%g}, add @${raw.replace(/-/g, " ")}{75%g}.` });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id], { servings: 8 }); // doubles the recipe
  await gotoGrocery(page);
  const pcx = page.getByTestId("store-pcExpress");
  await expect(pcx).toBeVisible();
  // 1200 g chicken thighs → 2 × 1 kg (default pack); 280 g spinach → 1 × 312 g; 150 g of an ingredient with no pack → raw.
  await expect(line(page, "Chicken thigh")).toContainText("×2");
  await expect(line(page, "Chicken thigh")).toContainText("need 1.2 kg →");
  await expect(line(page, "Chicken thigh")).toContainText("$25.98");
  await expect(line(page, "Baby spinach")).toContainText("×1");
  await expect(line(page, new RegExp(raw.replace(/-/g, " "), "i"))).toContainText("150 g");
  // Free-use olive oil isn't a plan line (R8.14); never bought here, it's on the list as a staple instead (M10, R7.12).
  await expect(line(page, /olive oil/i)).toHaveCount(1);
  await expect(line(page, /olive oil/i)).toContainText("used by planned meals");
  await expect(line(page, /olive oil/i)).not.toContainText("need ");
  await expect(pcx).not.toContainText(/\d ?(oz|lb)\b/); // no imperial anywhere on the list (R8.13)
  // The stored draft holds the same lines (deterministic IDs).
  await expect.poll(async () => Object.keys((await adminDb.doc(`households/${household.hid}/groceryLists/draft`).get()).data()?.items ?? {}).sort()).toEqual(["baby-spinach", "chicken-thigh", raw, "staple_olive-oil"].sort());
});

test("brand mappings name the product and set the pack; stores group the list, and a mapping beats a category rule (R7.3, R7.4)", { tag: ["@R7.3", "@R7.4"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Store split", { lines: "Sear @chicken thigh{600%g}, wilt @baby spinach{140%g}, add @canned diced tomatoes{400%g} and @feta cheese{100%g}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  // Meat and dairy go to Costco; the feta mapping pins it to PC Express.
  await adminDb.doc(`households/${household.hid}/sourcingRules/cat_meat`).set({ match: { category: "meat" }, storeId: "costco" });
  await adminDb.doc(`households/${household.hid}/sourcingRules/cat_dairy`).set({ match: { category: "dairy" }, storeId: "costco" });
  await adminDb.doc(`households/${household.hid}/brandMappings/feta-cheese`).set({ productName: "Krinos Greek feta", packAmount: 200, packMeasure: "weight", storeId: "pc-express" });
  await gotoGrocery(page);
  const costco = page.getByTestId("store-inStore");
  const pcx = page.getByTestId("store-pcExpress");
  await expect(costco).toContainText("Chicken thigh");
  await expect(costco).toContainText("In-store checklist");
  await expect(pcx).toContainText("Krinos Greek feta, 200 g");
  await expect(costco).not.toContainText("feta");
  await expect(pcx).toContainText("Baby spinach");
});

test("Copy copies only the PC Express section and marks the list ordered; Undo puts it back; ordered items aren't added again (R7.5, R6.3)", { tag: ["@R7.5", "@R6.3", "@R7.14"] }, async ({ page, household, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const r = await makePlanRecipe("Copy me");
  const pid = await seedPeriod(household.hid, { budgetCents: 10000 });
  await adminDb.doc(`households/${household.hid}/sourcingRules/cat_meat`).set({ match: { category: "meat" }, storeId: "costco" });
  await seedPlanItem(household.hid, pid, [r.id]);
  await gotoGrocery(page);
  await expect(line(page, "Baby spinach")).toBeVisible();
  // The household's own instructions travel with the copy (saved when the box loses focus).
  const instructions = page.getByLabel("Instructions for ChatGPT");
  await instructions.fill("Default to No Name or President's Choice brands if not specified.");
  await instructions.blur();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.chatgptInstructions).toBe("Default to No Name or President's Choice brands if not specified.");
  await page.reload();
  await expect(page.getByLabel("Instructions for ChatGPT")).toHaveValue("Default to No Name or President's Choice brands if not specified.");
  await page.getByRole("button", { name: "Copy for ChatGPT" }).click();
  if (browserName !== "chromium") {
    // WebKit and Firefox in Playwright may refuse the clipboard: the fallback sheet shows the text to copy by hand.
    const sheet = page.getByRole("dialog", { name: "Copy for ChatGPT" });
    if (await sheet.isVisible().catch(() => false)) await sheet.getByRole("button", { name: /mark ordered/ }).click();
  }
  await expect(page.getByTestId("notifications")).toContainText(/PC Express.* marked ordered/i);
  if (browserName === "chromium") {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    // Olive oil is a staple line (M10, R7.12: free-use, used by the meal, never bought here), ordered like any PC Express line.
    // The store is named so ChatGPT doesn't ask which one (the fixture household keeps the default store).
    expect(text).toBe(
      [
        "Please add these to my PC Express cart at the Loblaws Greenbank Road (Ottawa) store (use this store; don't ask me to pick one):",
        "- Baby spinach, 312 g × 1",
        "- Olive oil, 1 L × 1",
        "Substitutions: closest equivalent size; skip if unavailable.",
        "Default to No Name or President's Choice brands if not specified.",
      ].join("\n"),
    );
  }
  // R7.14: each store is its own order. Copy ordered PC Express only; Costco's checklist stays on the list.
  const ordered = page.getByTestId("ordered-list");
  await expect(ordered).toHaveCount(1);
  await expect(ordered).toContainText("PC Express");
  await expect(ordered).not.toContainText("Chicken thigh");
  const costco = page.getByTestId("store-inStore");
  await expect(costco.getByText("Chicken thigh").first()).toBeVisible();
  await expect.poll(async () => (await adminDb.collection(`households/${household.hid}/groceryLists`).where("status", "==", "ordered").get()).docs.map((d) => [d.data().storeId, d.data().orderedBy])).toEqual([["pc-express", household.uid]]);

  // In the store: Done shopping orders Costco on its own and opens the confirm step for just its lines.
  await costco.getByRole("button", { name: "Done shopping · confirm" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByTestId("receive-line")).toHaveCount(1);
  await expect(confirm).toContainText("Chicken thigh");
  await page.keyboard.press("Escape");
  await expect(ordered).toHaveCount(2);
  await expect(page.getByText(/Nothing to buy/)).toBeVisible();
  await expect.poll(async () => (await adminDb.collection(`households/${household.hid}/groceryLists`).where("status", "==", "ordered").get()).docs.map((d) => d.data().storeId).sort()).toEqual(["costco", "pc-express"]);

  // The plan meter now counts nothing for these: they're incoming.
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.budgetLeft()).toHaveText("$100.00");

  // Undo from the ordered list: back to the draft.
  await gotoGrocery(page);
  await ordered.filter({ hasText: "PC Express" }).getByRole("button", { name: "Undo order" }).click();
  await expect(ordered).toHaveCount(1);
  await expect(line(page, "Baby spinach")).toBeVisible();
  await expect.poll(async () => (await adminDb.collection(`households/${household.hid}/groceryLists`).where("status", "==", "ordered").get()).size).toBe(1);
});

test("the Undo in the copy banner reverts the order (R7.5)", { tag: ["@R7.5"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Undo me");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await gotoGrocery(page);
  await page.getByRole("button", { name: "Mark ordered without copying" }).click();
  await expect(page.getByTestId("ordered-list")).toBeVisible();
  await page.getByTestId("notifications").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("ordered-list")).toHaveCount(0);
  await expect(line(page, "Chicken thigh")).toBeVisible();
});

test("manual additions: free text or an ingredient; they don't count against the budget (R7.6, R6.4)", { tag: ["@R7.6", "@R6.4"] }, async ({ page, household }) => {
  await seedPeriod(household.hid, { budgetCents: 10000 });
  await gotoGrocery(page);
  await expect(page.getByText(/Nothing to buy/)).toBeVisible();
  const add = page.getByRole("form", { name: "Add to the list" });
  await add.getByLabel("Add any food item").fill("Bananas");
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(line(page, "Bananas")).toContainText("Added by hand");
  await add.getByLabel("Add any food item").fill("milk");
  await add.getByRole("button", { name: "milk", exact: true }).click();
  await add.getByLabel("Quantity").fill("2");
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(line(page, "Milk")).toContainText("×2");
  await expect(line(page, "Milk")).toContainText("4 L");
  await line(page, "Bananas").getByRole("button", { name: "Remove Bananas" }).click();
  await expect(line(page, "Bananas")).toHaveCount(0);
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.budgetLeft()).toHaveText("$100.00");
});

test("ticks show up live for the other member (NFR5)", { tag: ["@NFR5"] }, async ({ page, household, secondMember }) => {
  const r = await makePlanRecipe("Tick together");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await gotoGrocery(page);
  await gotoGrocery(secondMember.page);
  await line(page, "Chicken thigh").getByRole("checkbox").click();
  await expect(line(secondMember.page, "Chicken thigh").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await line(secondMember.page, "Baby spinach").getByRole("checkbox").click();
  await expect(line(page, "Baby spinach").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(line(page, "Chicken thigh").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  const items = (await adminDb.doc(`households/${household.hid}/groceryLists/draft`).get()).data()!.items;
  expect(items["chicken-thigh"]).toMatchObject({ checked: true, checkedBy: household.uid });
  expect(items["baby-spinach"]).toMatchObject({ checked: true, checkedBy: secondMember.user.uid });
});

test("every line has an ×: a removed plan line stays off (reload, order) and leaves the budget; Regenerate puts it back (R7.13)", { tag: ["@R7.13"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Remove a line");
  const pid = await seedPeriod(household.hid, { budgetCents: 20000 });
  await seedPlanItem(household.hid, pid, [r.id]);
  const plan = new PlanPage(page);
  const dollars = async () => Number((await plan.budgetLeft().textContent())!.replace(/[^0-9.]/g, ""));
  await plan.goto();
  await expect(plan.budgetLeft()).not.toHaveText("$200.00");
  const before = await dollars();
  await gotoGrocery(page);
  await expect(line(page, "Chicken thigh")).toBeVisible();
  // Plan lines have the × too, not only lines added by hand.
  await line(page, "Chicken thigh").getByRole("button", { name: "Remove Chicken thigh" }).click();
  await expect(line(page, "Chicken thigh")).toHaveCount(0);
  await expect(page.getByTestId("notifications")).toContainText("Regenerate puts it back");
  await expect(page.getByTestId("removed-count")).toContainText("1 removed");
  const draft = () => adminDb.doc(`households/${household.hid}/groceryLists/draft`).get();
  await expect.poll(async () => (await draft()).data()?.items?.["chicken-thigh"]?.removed).toBe(true);
  // It stays removed after a reload (stored on the draft, so for every member).
  await gotoGrocery(page);
  await expect(line(page, "Baby spinach")).toBeVisible();
  await expect(line(page, "Chicken thigh")).toHaveCount(0);
  // The budget meter no longer counts it (R6.3: what the next order will cost).
  await plan.goto();
  await expect.poll(dollars).toBeGreaterThan(before);
  // Ordering leaves it out, and it doesn't come back afterwards.
  await gotoGrocery(page);
  await page.getByRole("button", { name: "Mark ordered without copying" }).click();
  await expect(page.getByTestId("ordered-list")).toBeVisible();
  await expect(page.getByTestId("ordered-list")).toContainText("Baby spinach");
  await expect(line(page, "Chicken thigh")).toHaveCount(0);
  expect((await draft()).data()?.items?.["chicken-thigh"]?.removed).toBe(true);
  // Regenerate puts every removed line back.
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(line(page, "Chicken thigh")).toBeVisible();
  await expect(page.getByTestId("removed-count")).toHaveCount(0);
  await expect.poll(async () => (await draft()).data()?.items?.["chicken-thigh"]?.removed).toBeUndefined();
  await gotoGrocery(page);
  await expect(line(page, "Chicken thigh")).toBeVisible();
});

test("the next period's list: its own draft from its meals and the Supply left after this period, ordered for it (R7.18)", { tag: ["@R7.18"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Grocery next period");
  const pid = await seedPeriod(household.hid);
  const nextId = addDays(localDate(Date.now(), TZ), 7); // the current period starts today and runs 7 days
  await seedPlanItem(household.hid, pid, [r.id]); // 600 g chicken this period
  await seedPlanItem(household.hid, nextId, [r.id], { name: "Next week's chicken" }); // 600 g next period
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 1000, expiresInDays: null }]);

  // This period: Supply covers the chicken; the next period's meal adds nothing here.
  await gotoGrocery(page);
  await expect(line(page, "Chicken thigh")).toHaveCount(0);
  await expect(line(page, "Baby spinach")).toContainText("need 140 g");

  // Next period: 1000 g − this period's 600 g leaves 400 g, so 200 g more (one pack).
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: /^Next period/ }).click();
  await expect(page).toHaveURL(/period=next/);
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
  await expect(line(page, "Chicken thigh")).toContainText("need 200 g →");
  await expect(line(page, "Baby spinach")).toContainText("need 140 g");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/groceryLists/draft-next`).get()).data()?.periodId).toBe(nextId);
  expect(Object.keys((await adminDb.doc(`households/${household.hid}/groceryLists/draft-next`).get()).data()!.items)).toContain("chicken-thigh");

  // Ordering it puts an order for the next period under the next view only.
  await page.getByRole("button", { name: "Mark ordered without copying" }).click();
  await expect(page.getByRole("heading", { name: "Ordered for the next period" })).toBeVisible();
  const orders = await adminDb.collection(`households/${household.hid}/groceryLists`).where("status", "==", "ordered").get();
  expect(orders.docs.map((d) => d.data().periodId)).toEqual([nextId]);
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: /^This period/ }).click();
  await expect(page.getByRole("heading", { name: /Ordered/ })).toHaveCount(0);
  // This period's list still buys its own spinach: the next order isn't counted as incoming here.
  await expect(line(page, "Baby spinach")).toContainText("need 140 g");
});

test("a line whose substitute is already in Supply says so; switching substitutions off in Settings drops the hint and the swaps (R7.20, R11.20)", { tag: ["@R7.20", "@R11.20"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Shallot chicken", { lines: "Sear @chicken thigh{600%g} with @shallot{100%g}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await seedSupply(household.hid, "onion", [{ amount: 500, location: "pantry", expiresInDays: 20 }], { label: "onion" });
  await gotoGrocery(page);
  // Only a hint: the shallot is still on the list.
  await expect(line(page, /shallot/i)).toHaveCount(1);
  await expect(line(page, /shallot/i).getByTestId("swap-hint")).toHaveText(/have onion/i);
  await expect(line(page, "Chicken thigh").getByTestId("swap-hint")).toHaveCount(0);

  await page.goto("/settings/preferences");
  const sw = page.getByRole("switch", { name: "Suggest substitutions" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("substitutions-note")).toContainText("Off");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.substitutions).toBe(false);
  await gotoGrocery(page);
  await expect(line(page, /shallot/i)).toHaveCount(1);
  await expect(page.getByTestId("swap-hint")).toHaveCount(0);
});
