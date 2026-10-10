// NFR6: every page works from a 360 px phone to 4K: the right navigation per breakpoint and no horizontal scroll.
import { expect, test } from "../fixtures/test";

const PAGES = ["/plan", "/recipes", "/meals", "/supply", "/grocery", "/history", "/settings", "/settings/theme"];

function expectedNav(width: number): "tabs" | "rail" | "sidebar" {
  if (width >= 1024) return "sidebar";
  if (width >= 768) return "rail";
  return "tabs";
}

test("navigation variant per breakpoint and no horizontal scroll on any page", { tag: ["@NFR6"] }, async ({ page, household }) => {
  void household;
  const width = page.viewportSize()!.width;
  const want = expectedNav(width);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(`nav[data-nav="${want}"]`)).toBeVisible();
    for (const other of ["tabs", "rail", "sidebar"].filter((n) => n !== want)) {
      await expect(page.locator(`nav[data-nav="${other}"]`)).toBeHidden();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});

test("every page title is reachable from the navigation", { tag: ["@NFR6"] }, async ({ page, household }) => {
  void household;
  const width = page.viewportSize()!.width;
  const titles = ["Plan", "Recipes", "Meals", "Supply", "Grocery", "History", "Settings"];
  for (const title of titles) {
    if (width < 768 && ["Meals", "History", "Settings"].includes(title)) {
      await page.getByRole("button", { name: "More pages" }).click();
      await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: new RegExp(`^${title}`) }).click();
    } else {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: title, exact: true }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
});

test("the tablet rail collapses to icons and expands again", { tag: ["@NFR6"] }, async ({ page, household }) => {
  void household;
  const width = page.viewportSize()!.width;
  test.skip(expectedNav(width) !== "rail", "rail only between md and lg");
  const rail = page.locator('nav[data-nav="rail"]');
  await rail.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  await rail.getByRole("link", { name: "Supply" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Supply" })).toBeVisible();
  await rail.getByRole("button", { name: "Expand navigation" }).click();
  await expect(rail).not.toHaveAttribute("data-collapsed", "true");
});

test("sign-in fits a 360 px phone without horizontal scroll", { tag: ["@NFR6"] }, async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await ctx.close();
});

test("the Plan page: one column on phones, two at lg, three at xl (plan · suggestions · budget)", { tag: ["@NFR6"] }, async ({ page, household }) => {
  void household;
  const width = page.viewportSize()!.width;
  await page.goto("/plan");
  await expect(page.getByTestId("coverage-strip")).toBeVisible({ timeout: 20_000 });
  const x = async (name: string) => (await page.getByRole(name === "Suggested" ? "heading" : "region", { name }).first().boundingBox())!;
  const strip = (await page.getByTestId("coverage-strip").boundingBox())!;
  const suggested = await x("Suggested");
  const protein = await x("Protein per serving");
  if (width >= 1440) {
    expect(suggested.x).toBeGreaterThan(strip.x + strip.width - 1);
    expect(protein.x).toBeGreaterThan(suggested.x + suggested.width - 1);
  } else if (width >= 1024) {
    expect(suggested.x).toBeGreaterThan(strip.x + strip.width - 1);
    expect(Math.abs(protein.x - suggested.x)).toBeLessThan(2);
  } else {
    expect(Math.abs(suggested.x - strip.x)).toBeLessThan(2);
    expect(suggested.y).toBeGreaterThan(strip.y);
  }
});
