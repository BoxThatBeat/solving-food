// Sharing and export (TECHNICAL_SPECS §14.1 sharing.spec.ts; PRD R4.21, R4.22): Copy link; the recipe page opens for a
// signed-out visitor without household data or edit controls; .cook export downloads and re-imports.
import { readFileSync } from "node:fs";
import {
  buildIngredientIndex,
  cooklangToRecipe,
  resolveIngredientName,
} from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { makeRecipe, seedRecipeId, uniqueTitle } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { detail } from "../pages/recipes";

test("Copy link gives a link that opens for someone without an account, without household data", { tag: ["@R4.21", "@smoke"] }, async ({ page, household, browser, browserName, context }) => {
  const id = await seedRecipeId("Baked Feta Pasta");
  await adminDb.doc(`households/${household.hid}/notes/${id}`).set({ text: "Secret family tweak", updatedBy: household.uid });
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/recipes/${id}`);
  await expect(detail(page).getByLabel("HOUSEHOLD NOTES")).toHaveValue("Secret family tweak");
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
  await expect(d.locator("section[aria-labelledby=ing-h]")).toContainText("8 oz (225 g)"); // feta, 8 oz: the recipe's wording plus metric only (R8.13)
  await expect(d.locator("section[aria-labelledby=steps-h] ol > li")).toHaveCount(6);
  // No household data, no edit controls.
  await expect(v.getByText("Secret family tweak")).toHaveCount(0);
  await expect(d.getByLabel("HOUSEHOLD NOTES")).toHaveCount(0);
  await expect(d.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(d.getByRole("button", { name: /Save$/ })).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(d.getByText(/Never cooked in this household|You've made this/)).toHaveCount(0);
  await expect(d.getByRole("link", { name: "Sign in" })).toBeVisible();
  // Still shareable and exportable.
  await expect(d.getByRole("button", { name: "Copy link" })).toBeVisible();
  await visitor.close();
});

test("export a recipe as a .cook file that re-imports to the same recipe", { tag: ["@R4.22"] }, async ({ page, household: _ }) => {
  const title = uniqueTitle("Exported Chicken");
  const id = await makeRecipe(title, { from: "garlic-rice-and-chicken.cook", content: { sourceUrl: "https://example.com/garlic-rice" } });
  await page.goto(`/recipes/${id}`);
  const [download] = await Promise.all([page.waitForEvent("download"), detail(page).getByRole("button", { name: "Export .cook file" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^exported-chicken-[a-z0-9]+\.cook$/);
  const text = readFileSync((await download.path())!, "utf8");
  expect(text).toContain(`title: ${title}`);
  expect(text).toMatch(/cuisine: other/);
  expect(text).toMatch(/main_protein: chicken/);
  expect(text).toContain("source: https://example.com/garlic-rice");
  await expect(page.getByRole("status").filter({ hasText: /^Downloaded / })).toBeVisible();

  // Re-import with the app's own importer: same ingredients, amounts, and steps.
  const stored = (await adminDb.doc(`recipes/${id}`).get()).data()!;
  const ingredients = (await adminDb.collection("ingredients").get()).docs.map((d) => ({ id: d.id, name: d.data().name as string, aliases: (d.data().aliases ?? []) as string[] }));
  const index = buildIngredientIndex(ingredients);
  const again = cooklangToRecipe(text, { resolve: (n) => resolveIngredientName(n, index) });
  expect(again.newIngredients).toEqual([]);
  expect(again.content.title).toBe(title);
  expect(again.content.servings).toBe(stored.servings);
  expect(again.content.ingredients.map((l) => [l.ingredientId, l.amount, l.measure])).toEqual(
    (stored.ingredients as Array<{ ingredientId: string; amount: number; measure: string }>).map((l) => [l.ingredientId, l.amount, l.measure]),
  );
  expect(again.content.steps.length).toBe(stored.steps.length);

  // And through the drop folder, where it's recognised as the recipe it came from.
  await page.goto("/drop");
  await page.getByLabel("Choose .cook files and photos").setInputFiles({ name: download.suggestedFilename(), mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByTestId("notifications").getByRole("status").filter({ hasText: `"${title}" looks like a duplicate of` })).toBeVisible({ timeout: 45_000 });
  // Tidy the shared review list.
  const pending = await adminDb.collection("recipes").where("title", "==", title).where("status", "==", "pendingDuplicateReview").get();
  for (const d of pending.docs) await d.ref.delete();
});
