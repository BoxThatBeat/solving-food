// grocery.spec.ts, M2 parts (TECHNICAL_SPECS §14.1): the list is plan − supply − incoming rounded to packs (mapping,
// default pack, or raw); free-use ingredients excluded; brand names applied; grouped by store with the mapping beating
// a category rule; Copy copies only the PC Express section and marks the list ordered (with Undo); regenerating doesn't
// re-add ordered items; manual additions; live ticks. Expired lots and cadence prompts arrive with Supply (M3/M5).
import { adminDb } from "../fixtures/admin";
import { forgetIngredients } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";
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

test("Copy copies only the PC Express section and marks the list ordered; Undo puts it back; ordered items aren't added again (R7.5, R6.3)", { tag: ["@R7.5", "@R6.3"] }, async ({ page, household, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const r = await makePlanRecipe("Copy me");
  const pid = await seedPeriod(household.hid, { budgetCents: 10000 });
  await adminDb.doc(`households/${household.hid}/sourcingRules/cat_meat`).set({ match: { category: "meat" }, storeId: "costco" });
  await seedPlanItem(household.hid, pid, [r.id]);
  await gotoGrocery(page);
  await expect(line(page, "Baby spinach")).toBeVisible();
  await page.getByRole("button", { name: "Copy for ChatGPT" }).click();
  if (browserName !== "chromium") {
    // WebKit and Firefox in Playwright may refuse the clipboard: the fallback sheet shows the text to copy by hand.
    const sheet = page.getByRole("dialog", { name: "Copy for ChatGPT" });
    if (await sheet.isVisible().catch(() => false)) await sheet.getByRole("button", { name: /mark ordered/ }).click();
  }
  await expect(page.getByTestId("notifications")).toContainText(/list marked ordered/i);
  if (browserName === "chromium") {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    // Olive oil is a staple line (M10, R7.12: free-use, used by the meal, never bought here), ordered like any PC Express line.
    expect(text).toBe(["Please add these to my PC Express cart:", "- Baby spinach, 312 g × 1", "- Olive oil, 1 L × 1", "Substitutions: closest equivalent size; skip if unavailable."].join("\n"));
  }
  const ordered = page.getByTestId("ordered-list");
  await expect(ordered).toContainText("Chicken thigh"); // Costco's checklist travels with the order
  await expect(page.getByText(/Nothing to buy/)).toBeVisible();
  await expect.poll(async () => (await adminDb.collection(`households/${household.hid}/groceryLists`).where("status", "==", "ordered").get()).docs.map((d) => d.data().orderedBy)).toEqual([household.uid]);

  // The plan meter now counts nothing for these: they're incoming.
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.budgetLeft()).toHaveText("$100.00");

  // Undo from the ordered list: back to the draft.
  await gotoGrocery(page);
  await ordered.getByRole("button", { name: "Undo order" }).click();
  await expect(ordered).toHaveCount(0);
  await expect(line(page, "Baby spinach")).toBeVisible();
  await expect.poll(async () => (await adminDb.collection(`households/${household.hid}/groceryLists`).where("status", "==", "ordered").get()).size).toBe(0);
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
  await expect(line(page, "Bananas")).toContainText("ADDED BY HAND");
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
