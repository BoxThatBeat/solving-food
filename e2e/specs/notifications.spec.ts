// The notification system (TECHNICAL_SPECS §12 <NotificationBanners>, §14.1 notifications.spec.ts; PRD R12.1):
// banners from users/{uid}/notifications appear at the bottom of every page (above the phone tab bar), stack,
// auto-dismiss (success, info) or persist (error), link to their page, and stay dismissed on every device.
import { FieldValue } from "firebase-admin/firestore";
import type { Page } from "@playwright/test";
import { adminDb } from "../fixtures/admin";
import { seedRecipeId } from "../fixtures/recipes";
import { expect, signInWithEmailLink, test } from "../fixtures/test";

async function notifyUser(uid: string, n: { kind: "info" | "success" | "error"; message: string; link?: string }): Promise<string> {
  const ref = await adminDb.collection(`users/${uid}/notifications`).add({ ...n, createdAt: FieldValue.serverTimestamp(), dismissedAt: null });
  return ref.id;
}

const stack = (page: Page) => page.getByTestId("notifications");

test("banners stack at the bottom of any page; success and info auto-dismiss, errors stay until dismissed", { tag: ["@R12.1"] }, async ({ page, household }) => {
  await page.goto("/drop");
  const ok = await notifyUser(household.uid, { kind: "success", message: "Imported \"Test Soup\" from test-soup.cook." });
  await notifyUser(household.uid, { kind: "info", message: "\"Test Soup\" looks like a duplicate of \"Soup\"." });
  const err = await notifyUser(household.uid, { kind: "error", message: "broken.cook: Front matter: missing cuisine", link: "/drop" });

  await expect(stack(page).getByRole("status")).toHaveCount(2);
  await expect(stack(page).getByRole("alert")).toHaveCount(1);
  // Oldest first, error last.
  await expect(stack(page).locator("[data-kind]")).toHaveText([/Imported "Test Soup"/, /looks like a duplicate/, /broken\.cook/]);

  // At the bottom of the viewport; on phones, above the tab bar.
  const box = (await stack(page).boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y + box.height).toBeGreaterThan(vh - 160);
  const tabs = page.locator("nav[data-nav=tabs]");
  if (await tabs.isVisible()) expect(box.y + box.height).toBeLessThanOrEqual((await tabs.boundingBox())!.y + 1);

  // Another page: still there (the stack belongs to the shell).
  await page.getByRole("link", { name: "Recipes" }).first().click();
  await expect(stack(page).getByRole("alert")).toBeVisible();

  // After ~6 s the success and info banners are gone and marked dismissed; the error stays.
  await expect(stack(page).getByRole("status")).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await adminDb.doc(`users/${household.uid}/notifications/${ok}`).get()).data()?.dismissedAt).not.toBeNull();
  await page.waitForTimeout(1000);
  const alert = stack(page).getByRole("alert");
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toBeHidden();
  await expect.poll(async () => (await adminDb.doc(`users/${household.uid}/notifications/${err}`).get()).data()?.dismissedAt).not.toBeNull();

  // A dismissed notification doesn't come back on reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  await expect(stack(page).locator("[data-kind]")).toHaveCount(0);
});

test("a banner links to its page", { tag: ["@R12.1"] }, async ({ page, household }) => {
  const id = await seedRecipeId("Oatmeal Muffins");
  await page.goto("/recipes/trash");
  await notifyUser(household.uid, { kind: "success", message: "Imported \"Oatmeal Muffins\" from oatmeal-muffins.cook.", link: `/recipes/${id}` });
  const b = stack(page).getByRole("status").filter({ hasText: "Oatmeal Muffins" });
  await b.getByRole("link", { name: "Open recipe" }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${id}$`));
  await expect(page.locator("#recipe-title")).toHaveText("Oatmeal Muffins");
  await expect(b).toBeHidden(); // following the link dismisses it

  await notifyUser(household.uid, { kind: "info", message: "One import is waiting for review.", link: "/recipes?review=1" });
  await stack(page).getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("dialog", { name: "Needs review" })).toBeVisible();
});

test("dismissing on one device dismisses on the others", { tag: ["@R12.1"] }, async ({ page, household, browser }) => {
  const ctx = await browser.newContext();
  const phone2 = await ctx.newPage();
  await signInWithEmailLink(phone2, household.email);
  await expect(phone2).toHaveURL(/\/recipes$/);
  await page.goto("/recipes");

  await notifyUser(household.uid, { kind: "error", message: "household-import.json: not a Solving Food export" });
  await expect(stack(page).getByRole("alert")).toBeVisible();
  await expect(stack(phone2).getByRole("alert")).toBeVisible();
  await stack(phone2).getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
  await expect(stack(page).getByRole("alert")).toBeHidden();
  await ctx.close();
});

test("a burst of notifications shows the newest three and a \"+N more\" row with Dismiss all", { tag: ["@R12.1"] }, async ({ page, household }) => {
  await page.goto("/recipes");
  for (let i = 1; i <= 6; i++) await notifyUser(household.uid, { kind: "error", message: `bulk-${i}.cook: missing title` });
  await expect(stack(page).getByRole("alert")).toHaveCount(3);
  await expect(stack(page).getByRole("alert").last()).toContainText("bulk-6.cook");
  await expect(stack(page).getByText("+3 more notifications")).toBeVisible();
  await stack(page).getByRole("button", { name: "Dismiss all" }).click();
  await expect(stack(page).locator("[data-kind]")).toHaveCount(0);
  await expect
    .poll(async () => (await adminDb.collection(`users/${household.uid}/notifications`).where("dismissedAt", "==", null).get()).size)
    .toBe(0);
});
