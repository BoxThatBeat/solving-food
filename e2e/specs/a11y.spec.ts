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
