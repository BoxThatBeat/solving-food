// Sharing (TECHNICAL_SPECS §14.1 sharing.spec.ts; PRD R4.21): Copy link; the recipe page opens for a signed-out
// visitor without household data or edit controls. (R4.22, the .cook download, was withdrawn in M7.)
import { adminDb } from "../fixtures/admin";
import { seedRecipeId } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { detail } from "../pages/recipes";

test("Copy link gives a link that opens for someone without an account, without household data", { tag: ["@R4.21", "@smoke"] }, async ({ page, household, browser, browserName, context }) => {
  const id = await seedRecipeId("Baked Feta Pasta");
  await adminDb.doc(`households/${household.hid}/notes/${id}`).set({ text: "Secret family tweak", updatedBy: household.uid });
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/recipes/${id}`);
  await expect(detail(page).getByLabel("HOUSEHOLD NOTES")).toHaveValue("Secret family tweak");
  // No .cook download on the recipe page (R4.22 withdrawn in M7); Copy link stays.
  await expect(detail(page).getByRole("button", { name: "Export .cook file" })).toHaveCount(0);
  await expect(detail(page).getByRole("button", { name: ".cook" })).toHaveCount(0);
  await detail(page).getByRole("button", { name: "Copy link" }).click();
  const url = `${new URL(page.url()).origin}/recipes/${id}`;
  // Browsers without clipboard access get the link in the banner instead.
  await expect(page.getByRole("status").filter({ hasText: /Link copied · opens without an account|Copy this link:/ })).toBeVisible();
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(url);
  const d = detail(v);
  await expect(d.locator("#recipe-title")).toHaveText("Baked Feta Pasta");
  await expect(d.getByRole("img", { name: "Baked Feta Pasta" })).toBeVisible();
  await expect(d.locator("section[aria-labelledby=ing-h] li")).toHaveCount(8);
  await expect(d.locator("section[aria-labelledby=ing-h]")).toContainText("AMOUNT");
  await expect(d.locator("section[aria-labelledby=ing-h]")).toContainText("225 g"); // feta, 8 oz: converted to metric only (R8.13)
  await expect(d.locator("section[aria-labelledby=ing-h]")).not.toContainText(/\boz\b/);
  await expect(d.locator("section[aria-labelledby=steps-h] ol > li")).toHaveCount(6);
  // No household data, no edit controls.
  await expect(v.getByText("Secret family tweak")).toHaveCount(0);
  await expect(d.getByLabel("HOUSEHOLD NOTES")).toHaveCount(0);
  await expect(d.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(d.getByRole("button", { name: /Save$/ })).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(d.getByText(/Never cooked in this household|You've made this/)).toHaveCount(0);
  await expect(d.getByRole("link", { name: "Sign in" })).toBeVisible();
  // Still shareable.
  await expect(d.getByRole("button", { name: "Copy link" })).toBeVisible();
  await visitor.close();
});
