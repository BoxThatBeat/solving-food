// prices.spec.ts (TECHNICAL_SPECS §14.1, Planning/M5): the PC Express store picker (default Loblaws Greenbank Road),
// product search on brand mappings (name, pack, image, price), live prices in the budget with the estimate fallback,
// and the "not connected" state. Everything runs against the functions' PC Express stub, never the real API.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";

test("store picker: default Greenbank Road, in-app store search, pick another (R6.22)", { tag: ["@R6.22"] }, async ({ page, household }) => {
  await page.goto("/settings/stores");
  const picker = page.getByTestId("pcx-store-picker");
  await expect(picker.getByTestId("pcx-current-store")).toHaveText("Loblaws Greenbank Road (default)");
  await expect(picker.getByTestId("pcx-status")).toContainText("PC Express connected", { timeout: 20_000 });
  await picker.getByLabel("Search PC Express stores").fill("rideau");
  await picker.getByRole("button", { name: "Search" }).click();
  const found = picker.getByRole("list", { name: "Stores found" });
  await expect(found).toContainText("Loblaws Rideau Centre", { timeout: 20_000 });
  await found.getByRole("button", { name: "Use this store" }).click();
  await expect(picker.getByTestId("pcx-current-store")).toHaveText("Loblaws Rideau Centre");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.pcxStoreId).toBe("STUB-1009");
});

test("product search links a brand to a PC Express product; the budget uses its live price (R7.10, R6.21)", { tag: ["@R7.10", "@R6.21", "@R7.3"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Live price stew", { lines: "Simmer @canned diced tomato{400%ml} with @chicken thigh{600%g}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/brands");
  await page.getByLabel("Ingredient").fill("canned diced tom");
  await page.getByRole("option", { name: /canned diced tomato/i }).first().click();
  const search = page.getByTestId("pcx-product-search");
  await search.getByLabel("Search PC Express products").fill("diced tomatoes");
  await search.getByRole("button", { name: "Search" }).click();
  const result = search.getByRole("button", { name: "Use No Name Diced Tomatoes" });
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result).toContainText("796 mL");
  await expect(result).toContainText("$1.99");
  await result.click();
  await expect(page.getByLabel("PRODUCT", { exact: true })).toHaveValue("No Name Diced Tomatoes");
  await expect(page.getByTestId("linked-product")).toContainText("STUB-TOM-796");
  await page.getByRole("button", { name: "Save brand" }).click();
  await expect(page.getByTestId("brand-row")).toContainText("No Name Diced Tomatoes");
  await expect(page.getByTestId("brand-price")).toContainText(/\$1\.99 · live today/i);
  await expect
    .poll(async () => (await adminDb.doc(`households/${household.hid}/brandMappings/canned-diced-tomato`).get()).data())
    .toMatchObject({ productCode: "STUB-TOM-796", packAmount: 796, packMeasure: "volume" });

  // The meter prices the tomatoes live and the chicken from the estimates.
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(page.locator('[data-testid="price-sources"]:visible')).toContainText(/1 live · 1 estimated/i, { timeout: 20_000 });
});

test("not connected: the store page says so and prices come from the estimates (R6.21)", { tag: ["@R6.21"] }, async ({ page, household }) => {
  await adminDb.doc(`_stubPcx/${household.hid}`).set({ mode: "notConfigured" });
  const r = await makePlanRecipe("Estimate stew", { lines: "Simmer @canned diced tomato{400%ml} with @chicken thigh{600%g}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/stores");
  await expect(page.getByTestId("pcx-status")).toContainText("PC Express not connected", { timeout: 20_000 });
  await page.getByLabel("Search PC Express stores").fill("rideau");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/isn't connected yet/).first()).toBeVisible();
  const plan = new PlanPage(page);
  await plan.goto();
  await expect(page.locator('[data-testid="price-sources"]:visible')).toContainText(/2 estimated/i, { timeout: 20_000 });
  await expect(page.locator('[data-testid="price-sources"]:visible')).not.toContainText("live");
});
