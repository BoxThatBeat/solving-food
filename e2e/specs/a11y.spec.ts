// @axe-core/playwright scan of the M0 pages: no serious or critical violations; keyboard reaches the navigation.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { allowlist } from "../fixtures/admin";
import { expect, signInWithEmailLink, test } from "../fixtures/test";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
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
