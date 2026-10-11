// @axe-core/playwright scan of the M0 and M1 pages: no serious or critical violations; keyboard reaches the navigation.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { allowlist } from "../fixtures/admin";
import { expect, signInWithEmailLink, test } from "../fixtures/test";

async function expectNoSeriousViolations(page: Page, label: string) {
  // Live data can re-render the page mid-scan (another spec's import adds a duplicate-review banner and shifts the
  // layout), which makes axe sample the wrong background. A violation has to show up in three scans in a row.
  let bad: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    // Sheets fade their overlay in; contrast measured mid-animation is meaningless.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    bad = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary?.split("\n").slice(1).join(" ").trim()})`).join(", ")}`);
    if (!bad.length) return;
    await page.waitForTimeout(750);
  }
  expect(bad, label).toEqual([]);
}

test("sign-in, not-invited, and first-run pages", async ({ page, uniqueEmail }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoSeriousViolations(page, "/sign-in");

  await page.goto("/not-invited?email=someone%40example.com");
  await expectNoSeriousViolations(page, "/not-invited");

  const email = uniqueEmail("a11y");
  await allowlist(email);
  await signInWithEmailLink(page, email);
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
  await expectNoSeriousViolations(page, "/welcome");
  await page.getByLabel("Display name").fill("Aaron");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create your household" })).toBeVisible();
  await expectNoSeriousViolations(page, "/welcome/household");
});

test("shell pages in Latte and Mocha", async ({ page, household }) => {
  test.slow(); // 10 full-page scans
  void household;
  for (const flavour of ["latte", "mocha"] as const) {
    if (flavour === "mocha") {
      await page.goto("/settings/theme");
      await page.getByRole("button", { name: "Mocha" }).click();
    }
    for (const path of ["/recipes", "/plan", "/settings", "/settings/theme", "/settings/household"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expectNoSeriousViolations(page, `${path} (${flavour})`);
    }
  }
});

test("the More sheet and household sheet are accessible dialogs", async ({ page, household }) => {
  void household;
  const phone = page.viewportSize()!.width < 768;
  if (phone) {
    await page.getByRole("button", { name: "More pages" }).click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await expectNoSeriousViolations(page, "More sheet");
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: /Household:/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Households" })).toBeVisible();
  await expectNoSeriousViolations(page, "Households sheet");
});

test("keyboard alone reaches and follows the primary navigation", async ({ page, household }) => {
  void household;
  // From a short page: on Recipes the phone tab bar comes after every recipe card in tab order.
  await page.goto("/plan");
  await expect(page.locator("h1")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  const target = nav.getByRole("link", { name: "Supply", exact: true });
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Supply" })).toBeVisible();
});

test("recipe pages and sheets (M1) in Latte and Mocha", async ({ page, household, browser }) => {
  test.slow(); // 17 full-page scans
  void household;
  const { makeRecipe, seedRecipeId, uniqueTitle } = await import("../fixtures/recipes");
  const id = await seedRecipeId("Garlic Rice and Chicken");
  await makeRecipe(uniqueTitle("A11y Trashed"), { status: "trashed", extra: { trashedAt: new Date(), trashedBy: household.uid } });
  await makeRecipe(uniqueTitle("A11y Pending"), { status: "pendingDuplicateReview" });
  // Every card badge on screen: FAMILY (tag) and ★ FAV (this household's favourite).
  await makeRecipe(uniqueTitle("A11y Family"), { content: { tags: ["dinner", "family recipe"] } });
  const { adminDb } = await import("../fixtures/admin");
  await adminDb.doc(`households/${household.hid}/favourites/recipe_${id}`).set({ type: "recipe", targetId: id });
  for (const flavour of ["latte", "mocha"] as const) {
    if (flavour === "mocha") {
      await page.goto("/settings/theme");
      await page.getByRole("button", { name: "Mocha" }).click();
    }
    for (const path of ["/recipes", `/recipes/${id}`, `/recipes/${id}/edit`, "/recipes/new", "/recipes/trash", "/drop", "/meals"]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      if (path === "/recipes/trash") await expect(page.getByRole("list", { name: "Trashed recipes" })).toBeVisible();
      await expectNoSeriousViolations(page, `${path} (${flavour})`);
    }
    await page.goto("/recipes");
    await page.getByRole("button", { name: /^Filter and sort/ }).click();
    await expect(page.getByRole("dialog", { name: "Filter & sort" })).toBeVisible();
    await expectNoSeriousViolations(page, `filter sheet (${flavour})`);
    await page.goto("/recipes?review=1");
    await expect(page.getByRole("dialog", { name: "Needs review" })).toBeVisible();
    await expectNoSeriousViolations(page, `review sheet (${flavour})`);
  }
  // The share page as a visitor sees it.
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/recipes/${id}`);
  await expect(v.locator("#recipe-title")).toBeVisible();
  await expectNoSeriousViolations(v, "shared recipe, signed out");
  await visitor.close();
});

test("M2 pages and sheets: plan with a meal, Create meal, meals, grocery, household settings", async ({ page, household }) => {
  test.slow();
  const { makePlanRecipe, seedPeriod, seedPlanItem } = await import("../pages/plan");
  const r = await makePlanRecipe("Accessible dinner");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  for (const path of ["/plan", "/meals", "/grocery", "/settings/stores", "/settings/brands", "/settings/tools"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    if (path === "/grocery") await expect(page.getByText("Building the list…")).toHaveCount(0);
    await expectNoSeriousViolations(page, path);
  }
  await page.goto("/plan");
  await page.getByRole("button", { name: "+ Create meal" }).first().click();
  await expect(page.getByRole("dialog", { name: "Create meal" })).toBeVisible();
  await expectNoSeriousViolations(page, "Create meal sheet");
  await page.getByRole("dialog").getByRole("checkbox").first().click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.getByRole("dialog", { name: "Add to plan" })).toBeVisible();
  await expectNoSeriousViolations(page, "Add to plan sheet");
});

test("M3 pages and sheets in Latte and Mocha: supply with every flag, add supply, item history, cooking phases, review, history, confirm groceries", async ({ page, household }) => {
  test.slow();
  const { seedPeriod, seedPlanItem } = await import("../pages/plan");
  const { seedSupply, makeCookRecipe, seedOrderedList, groceryLine } = await import("../pages/supply");
  const r = await makeCookRecipe("Accessible cook");
  const pid = await seedPeriod(household.hid);
  const itemId = await seedPlanItem(household.hid, pid, [r.id]);
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 300, expiresInDays: 1 }, { amount: 900, frozen: { frozenDaysAgo: 2, expiresInDays: 200 } }]);
  await seedSupply(household.hid, "milk", [{ amount: 1000, expiresInDays: -1 }]);
  await seedSupply(household.hid, "jasmine-rice", [{ amount: 5000, location: "pantry", expiresInDays: 300 }]);
  await seedOrderedList(household.hid, pid, { "baby-spinach": groceryLine({ ingredientId: "baby-spinach", amount: 312, packAmount: 312, packLabel: "312 g", productName: "Baby spinach", storeId: "costco", estPriceCents: 499 }) });
  for (const flavour of ["latte", "mocha"] as const) {
    if (flavour === "mocha") {
      await page.goto("/settings/theme");
      await page.getByRole("button", { name: "Mocha" }).click();
    }
    await page.goto("/supply");
    await expect(page.getByTestId("expired-prompts")).toBeVisible();
    await page.getByTestId("supply-row").filter({ hasText: /Chicken thigh/i }).getByRole("button").first().click();
    await expectNoSeriousViolations(page, `/supply with detail (${flavour})`);
    await page.getByRole("button", { name: "+ Add" }).click();
    await expect(page.getByRole("dialog", { name: "Add to supply" })).toBeVisible();
    await expectNoSeriousViolations(page, `add supply (${flavour})`);
    await page.goto("/supply/jasmine-rice");
    await expect(page.getByTestId("ledger")).toBeVisible();
    await expectNoSeriousViolations(page, `/supply/:id (${flavour})`);
    await page.goto(`/recipes/${r.id}`);
    await expect(page.getByTestId("supply-badge").first()).toBeVisible();
    await expectNoSeriousViolations(page, `recipe with supply badges (${flavour})`);
    await page.evaluate(() => sessionStorage.clear()); // the cook view resumes where it was left
    await page.goto(`/plan/${itemId}/cook`);
    await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
    await expectNoSeriousViolations(page, `mise en place (${flavour})`);
    await page.getByRole("button", { name: "Start step mode →" }).click();
    await expect(page.getByTestId("step-card")).toBeVisible();
    await expectNoSeriousViolations(page, `step mode (${flavour})`);
    await page.goto("/grocery");
    await page.getByRole("button", { name: /Groceries arrived\? Confirm/ }).click();
    await expect(page.getByRole("dialog", { name: "Confirm groceries" })).toBeVisible();
    await expectNoSeriousViolations(page, `confirm groceries (${flavour})`);
  }
  // Review and history (Latte is the reference; Mocha shares the tokens checked above).
  await page.goto(`/plan/${itemId}/cook`);
  await page.getByRole("button", { name: "Done cooking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rate it" })).toBeVisible();
  await expectNoSeriousViolations(page, "review: rate");
  await page.getByRole("tab", { name: "2 · Used" }).click();
  await expect(page.getByTestId("used-row").first()).toBeVisible();
  await expectNoSeriousViolations(page, "review: used");
  await page.getByRole("button", { name: "Review later" }).click();
  await expect(page.getByTestId("pending-reviews")).toBeVisible();
  await expectNoSeriousViolations(page, "/plan with pending review and cooked item");
  await page.goto("/history");
  await expect(page.getByTestId("history-row").first()).toBeVisible();
  await expectNoSeriousViolations(page, "/history");
});

test("M4 pages and dialogs in Latte and Mocha: members with invites, the invite banner, data, the leave warning, another household", async ({ page, household }) => {
  test.slow();
  const { adminDb, addMember } = await import("../fixtures/admin");
  const { FieldValue } = await import("firebase-admin/firestore");
  await addMember(household.hid, `sam-${household.hid}`, "Sam");
  await adminDb.doc(`households/${household.hid}/invites/pat@example.com`).set({ inviteeEmailLower: "pat@example.com", householdName: "Silbrass Pvt", invitedBy: household.uid, invitedByName: "Aaron", createdAt: FieldValue.serverTimestamp() });
  const other = adminDb.collection("households").doc();
  await other.set({ name: "Cottage", createdBy: "someone", periodDays: 7, budgetCents: 0, currency: "CAD", timezone: "America/Toronto", defaultServings: 2, plannedMealTypes: ["dinner"], pcxStoreId: "x", currentPeriodId: null, settings: {} });
  await adminDb.doc(`households/${other.id}/invites/${household.uid}`).set({ inviteeUid: household.uid, householdName: "Cottage", invitedBy: "someone", invitedByName: "Kim", createdAt: FieldValue.serverTimestamp() });
  for (const flavour of ["latte", "mocha"] as const) {
    if (flavour === "mocha") {
      await page.goto("/settings/theme");
      await page.getByRole("button", { name: "Mocha" }).click();
    }
    await page.goto("/settings/members");
    await expect(page.getByRole("region", { name: "Invites" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Pending invites" })).toContainText("pat@example.com");
    await page.getByLabel("Search people by name").fill("a");
    await expectNoSeriousViolations(page, `/settings/members (${flavour})`);
    await page.getByRole("button", { name: "Leave this household" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectNoSeriousViolations(page, `leave dialog (${flavour})`);
    await page.keyboard.press("Escape");
    await page.goto("/settings/data");
    await expect(page.getByTestId("read-estimate")).toHaveText(/About/);
    await expectNoSeriousViolations(page, `/settings/data (${flavour})`);
    await page.goto("/settings");
    await expectNoSeriousViolations(page, `/settings with invites (${flavour})`);
    await page.goto("/welcome/household");
    await expect(page.getByRole("heading", { name: "Create a household" })).toBeVisible();
    await expectNoSeriousViolations(page, `/welcome/household, another household (${flavour})`);
  }
});
