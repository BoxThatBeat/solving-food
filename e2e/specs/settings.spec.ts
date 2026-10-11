// settings.spec.ts, M2 parts (TECHNICAL_SPECS §14.1): household (plan period, budget, timezone, default servings,
// planned meal types), kitchen tools, stores and sourcing rules, brand mappings. Theme is covered by theme.spec.ts;
// preferences, weights, protein goals, and members are later milestones.
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { cook, makePlanRecipe, PlanPage, seedPeriod, seedPlanItem } from "../pages/plan";
import { makeRecipe, uniqueTitle, waitForIndexed } from "../fixtures/recipes";

test("household settings: period length, budget, timezone, default servings, meal types (R11.5, R11.6, R11.11–R11.13)", { tag: ["@R11.5", "@R11.6", "@R11.11", "@R11.12", "@R11.13", "@smoke"] }, async ({ page, household }) => {
  const pid = await seedPeriod(household.hid);
  await page.goto("/settings/household");
  await expect(page.getByLabel("Name")).toHaveValue(household.householdName);
  await page.getByRole("group", { name: "Plan period" }).getByRole("button", { name: /^Increase/ }).click();
  await page.getByRole("group", { name: "Plan period" }).getByRole("button", { name: /^Increase/ }).click();
  await page.getByLabel("Budget per period").fill("150");
  await page.getByLabel("Timezone").selectOption("America/Vancouver");
  await page.getByRole("button", { name: "Fewer servings" }).click();
  await page.getByRole("button", { name: "Breakfast", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("notifications")).toContainText("Household settings saved");
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()).toMatchObject({
    periodDays: 9,
    budgetCents: 15000,
    timezone: "America/Vancouver",
    defaultServings: 3,
    plannedMealTypes: ["lunch", "dinner"],
  });
  // The current period's budget follows; its length doesn't change until the next period.
  expect((await adminDb.doc(`households/${household.hid}/periods/${pid}`).get()).data()!.budgetCents).toBe(15000);

  const plan = new PlanPage(page);
  await plan.goto();
  await expect(plan.budgetLeft()).toHaveText("$150.00");
  await expect(page.getByTestId("coverage-strip").getByRole("rowheader")).toHaveText(["Lunch", "Dinner"]);
  await expect(plan.stripCount("dinner")).toHaveText("0/7");
});

test("household settings are validated", { tag: ["@R11.6"] }, async ({ page, household }) => {
  void household;
  await page.goto("/settings/household");
  await page.getByLabel("Budget per period").fill("-5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Budget can't be negative");
  await page.getByLabel("Budget per period").fill("200");
  for (const m of ["Breakfast", "Lunch", "Dinner"]) await page.getByRole("button", { name: m, exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Plan at least one meal type");
});

test("kitchen tools: add and remove; recipes needing a missing tool are flagged and can be filtered out (R11.1)", { tag: ["@R11.1", "@R4.14"] }, async ({ page, household }) => {
  void household;
  const title = uniqueTitle("Wok stir fry");
  const id = await makeRecipe(title, { cook: cook({ lines: "Fry @chicken thigh{300%g}.", tools: "wok" }) });
  await waitForIndexed(id);
  await page.goto("/settings/tools");
  await page.getByRole("button", { name: "Add Instant Pot" }).click();
  await expect(page.getByRole("list", { name: "Tools you own" })).toContainText("instant pot");
  await page.getByLabel("Add a tool").fill("Pasta machine");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Tools you own" })).toContainText("pasta machine"); // shown lower-case
  await page.getByRole("button", { name: "Remove pasta machine" }).click();
  await expect(page.getByRole("list", { name: "Tools you own" })).not.toContainText("pasta machine");

  await page.goto(`/recipes/${id}`);
  await expect(page.getByText("Needs wok.")).toBeVisible();

  await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
  await expect(page.getByTestId("recipe-card").filter({ hasText: title })).toBeVisible();
  await page.getByRole("button", { name: /^Filter and sort/ }).click();
  await page.getByRole("dialog", { name: "Filter & sort" }).getByRole("button", { name: /^Have the tools/ }).click();
  await page.getByRole("button", { name: /^Show \d+ recipes/ }).click();
  await expect(page).toHaveURL(/tools=true/);
  await expect(page.getByTestId("recipe-card").filter({ hasText: title })).toHaveCount(0);

  // Owning it makes the recipe show again.
  await page.goto("/settings/tools");
  await page.getByLabel("Add a tool").fill("Wok");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Tools you own" })).toContainText("wok");
  await page.goto(`/recipes?q=${encodeURIComponent(title)}&tools=true`);
  await expect(page.getByTestId("recipe-card").filter({ hasText: title })).toBeVisible();
});

test("kitchen tools match by meaning: owning a Skillet covers a recipe's frying pan; one suggestion per tool (R11.1, M7)", { tag: ["@R11.1", "@R4.14"] }, async ({ page, household }) => {
  const title = uniqueTitle("Frying pan supper");
  const id = await makeRecipe(title, { cook: cook({ lines: "Fry @chicken thigh{300%g} in a #Frying Pan{}, then toss in a #large wok{}." }) });
  await waitForIndexed(id);
  await page.goto("/settings/tools");
  const suggested = page.getByRole("list", { name: "Suggested tools" });
  // "frying pan" from the recipe joins the skillet chip instead of getting its own.
  const skillet = suggested.getByRole("button", { name: "Add skillet", exact: true });
  await expect(skillet).toBeVisible();
  await expect(suggested.getByRole("button", { name: "Add frying pan" })).toHaveCount(0);
  await expect(skillet).toContainText("also:");
  await expect(skillet).toContainText("frying pan");
  await page.getByLabel("Add a tool").fill("Skillet");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Tools you own" })).toContainText("skillet");
  await expect(skillet).toHaveCount(0);
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()!.settings.tools).toEqual(["Skillet"]); // stored as typed
  // Adding another spelling of a tool you own says so instead of adding a duplicate.
  await page.getByLabel("Add a tool").fill("Frying pan");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("notifications")).toContainText("You already have skillet, which covers frying pan.");

  await page.goto(`/recipes/${id}`);
  await expect(page.getByRole("alert").filter({ hasText: "Needs" })).toHaveText(/^Needs large wok\. It's not in your kitchen tools\.$/);
  await expect(page.getByText("✓ frying pan")).toBeVisible();
  await expect(page.getByText("✕ large wok")).toBeVisible();
});

test("stores: default stores exist, add one, make it the default, and route a category to it (R11.7, R7.4)", { tag: ["@R11.7", "@R7.4"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Market dinner");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/stores");
  await expect(page.getByTestId("store-row")).toHaveCount(2);
  await expect(page.getByLabel("Store name").first()).toHaveValue("PC Express (Loblaws Greenbank Road)");
  await expect(page.getByRole("radio", { name: "Make PC Express (Loblaws Greenbank Road) the default store" })).toBeChecked();

  const add = page.getByRole("form", { name: "Add a store" });
  await add.getByLabel("New store name").fill("Farmers' market");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("store-row")).toHaveCount(3);
  const market = await expect
    .poll(async () => (await adminDb.collection(`households/${household.hid}/stores`).where("name", "==", "Farmers' market").get()).docs[0]?.id)
    .toBeTruthy()
    .then(async () => (await adminDb.collection(`households/${household.hid}/stores`).where("name", "==", "Farmers' market").get()).docs[0]!.id);
  await page.getByLabel("Produce", { exact: true }).selectOption(market);
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/sourcingRules/cat_produce`).get()).data()).toEqual({ match: { category: "produce" }, storeId: market });

  await page.goto("/grocery");
  await expect(page.getByRole("region", { name: "Farmers' market" })).toContainText("Baby spinach");
  await expect(page.getByTestId("store-pcExpress")).toContainText("Chicken thigh");

  await page.goto("/settings/stores");
  // Controlled by the household document: the radio follows the (local, then server) write.
  await page.getByRole("radio", { name: "Make Farmers' market the default store" }).click();
  await expect(page.getByRole("radio", { name: "Make Farmers' market the default store" })).toBeChecked();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()!.defaultStoreId).toBe(market);
});

test("brand mappings: add one by hand; the grocery list uses its name and pack (R11.7, R7.3)", { tag: ["@R11.7", "@R7.3"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("Branded dinner");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/brands");
  await page.getByLabel("Ingredient").fill("baby spin");
  await page.getByRole("option", { name: /baby spinach/i }).first().click();
  await page.getByLabel("PRODUCT", { exact: true }).fill("Organic baby spinach clamshell");
  await page.getByLabel("PACK SIZE").fill("142");
  await page.getByRole("button", { name: "Save brand" }).click();
  const row = page.getByTestId("brand-row").filter({ hasText: "Organic baby spinach clamshell" });
  await expect(row).toContainText("142 g");
  await page.goto("/grocery");
  const line = page.getByTestId("grocery-line").filter({ hasText: "Organic baby spinach clamshell" });
  await expect(line).toContainText("×1"); // 140 g needed, 142 g pack
  await expect(line).toContainText("142 g");

  // Edit and delete.
  await page.goto("/settings/brands");
  await row.getByRole("button", { name: /^Edit brand/ }).click();
  await page.getByLabel("PACK SIZE").fill("100");
  await page.getByRole("button", { name: "Save brand" }).click();
  await expect(row).toContainText("100 g");
  await row.getByRole("button", { name: /^Delete brand/ }).click();
  await expect(row).toHaveCount(0);
});
