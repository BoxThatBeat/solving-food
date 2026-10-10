// R11.9 theme (flavour + accent) per user; R2.10 it's the only per-user setting.
import type { Page } from "@playwright/test";
import { adminDb } from "../fixtures/admin";
import { expect, forwardConsole, signInWithEmailLink, test } from "../fixtures/test";

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("flavour and accent apply at once, persist per user, and don't touch the household", { tag: ["@R11.9", "@R2.10", "@smoke"] }, async ({ page, household, secondMember }) => {
  await page.goto("/settings/theme");
  expect(await cssVar(page, "--base")).toBe("#eff1f5"); // Latte by default
  expect(await cssVar(page, "--acc")).toBe("#a6da95"); // green by default

  await page.getByRole("button", { name: "Mocha" }).click();
  await page.getByRole("button", { name: "Peach" }).click();
  await expect(page.getByRole("button", { name: "Mocha" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => cssVar(page, "--base")).toBe("#1e1e2e");
  await expect.poll(() => cssVar(page, "--acc")).toBe("#f5a97f");

  await expect.poll(async () => (await adminDb.doc(`users/${household.uid}`).get()).data()!.theme).toEqual({ flavour: "mocha", accent: "peach" });
  const hh = (await adminDb.doc(`households/${household.hid}`).get()).data()!;
  expect(hh).not.toHaveProperty("theme");

  // Survives a reload (and is painted before the app boots, from the localStorage mirror).
  await page.reload();
  await expect(page.getByRole("button", { name: "Mocha" })).toHaveAttribute("aria-pressed", "true");
  expect(await cssVar(page, "--base")).toBe("#1e1e2e");

  // Another member of the same household keeps their own theme.
  await secondMember.page.goto("/settings/theme");
  await expect(secondMember.page.getByRole("button", { name: "Latte" })).toHaveAttribute("aria-pressed", "true");
  expect(await cssVar(secondMember.page, "--base")).toBe("#eff1f5");
});

test("the theme follows the user to a new device", { tag: ["@R11.9"] }, async ({ signedInAs, browser }) => {
  const user = await signedInAs({ theme: { flavour: "frappe", accent: "mauve" } });
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  forwardConsole(p2, ":2");
  await signInWithEmailLink(p2, user.email);
  await expect(p2).toHaveURL(/\/recipes$/);
  await expect.poll(() => cssVar(p2, "--base")).toBe("#303446");
  expect(await cssVar(p2, "--acc")).toBe("#c6a0f6");
  await ctx.close();
});
