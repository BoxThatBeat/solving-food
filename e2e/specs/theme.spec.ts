// R11.9 theme (accent) per user; R2.10 it's the only per-user setting. M9: Catppuccin Latte is the only flavour and
// isn't offered; a flavour stored before M9 is read as Latte.
import type { Page } from "@playwright/test";
import { adminDb } from "../fixtures/admin";
import { expect, forwardConsole, signInWithEmailLink, test } from "../fixtures/test";

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("the accent applies at once, persists per user, and doesn't touch the household; no flavour picker", { tag: ["@R11.9", "@R2.10", "@smoke"] }, async ({ page, household, secondMember }) => {
  await page.goto("/settings/theme");
  expect(await cssVar(page, "--base")).toBe("#eff1f5"); // Latte, the only flavour
  expect(await cssVar(page, "--acc")).toBe("#a6da95"); // green by default
  await expect(page.getByText("Catppuccin flavour", { exact: false })).toHaveCount(0);
  for (const f of ["Latte", "Frappé", "Macchiato", "Mocha"]) await expect(page.getByRole("button", { name: f, exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Peach" }).click();
  await expect(page.getByRole("button", { name: "Peach" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => cssVar(page, "--acc")).toBe("#f5a97f");
  expect(await cssVar(page, "--base")).toBe("#eff1f5");

  await expect.poll(async () => (await adminDb.doc(`users/${household.uid}`).get()).data()!.theme).toEqual({ flavour: "latte", accent: "peach" });
  const hh = (await adminDb.doc(`households/${household.hid}`).get()).data()!;
  expect(hh).not.toHaveProperty("theme");

  // Survives a reload (and is painted before the app boots, from the localStorage mirror).
  await page.reload();
  await expect(page.getByRole("button", { name: "Peach" })).toHaveAttribute("aria-pressed", "true");
  expect(await cssVar(page, "--acc")).toBe("#f5a97f");

  // Another member of the same household keeps their own accent.
  await secondMember.page.goto("/settings/theme");
  await expect(secondMember.page.getByRole("button", { name: "Green" })).toHaveAttribute("aria-pressed", "true");
  expect(await cssVar(secondMember.page, "--acc")).toBe("#a6da95");
});

test("the accent follows the user to a new device; a flavour stored before M9 shows as Latte", { tag: ["@R11.9"] }, async ({ signedInAs, browser }) => {
  const user = await signedInAs({ theme: { flavour: "frappe", accent: "mauve" } });
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  forwardConsole(p2, ":2");
  await signInWithEmailLink(p2, user.email);
  await expect(p2).toHaveURL(/\/recipes$/);
  await expect.poll(() => cssVar(p2, "--acc")).toBe("#c6a0f6");
  expect(await cssVar(p2, "--base")).toBe("#eff1f5");
  await ctx.close();
});
