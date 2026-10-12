// Ingredient review and "Merge into…" (Planning/M8, PRD R4.27, R8.16): an import with a name nothing in the catalogue
// means creates an ingredient that needs review; the import's banner links to the review, the Recipes page shows a
// banner, Settings shows the count, and Merge into… repoints the recipe and moves the household's Supply (with
// Σ transactions == amount) through the mergeIngredient function, teaching the target the new name.
import type { Page } from "@playwright/test";
import { newIngredientId } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { uniqueTitle } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { seedSupply, supplyDoc } from "../pages/supply";

async function dropFiles(page: Page, files: Array<{ name: string; body: string; mimeType: string }>) {
  await page.goto("/drop");
  await page.getByLabel("Choose .cook files and photos").setInputFiles(files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.body) })));
}

const statusBanner = (page: Page, text: string | RegExp) => page.getByTestId("notifications").getByRole("status").filter({ hasText: text });

test("a new name from an import is reviewed and merged: banner, Settings count, Merge into… moves the recipe and Supply", { tag: ["@R4.27", "@R8.16", "@R4.16"] }, async ({ page, household }) => {
  test.setTimeout(150_000);
  const word = `quandong${Math.random().toString(36).slice(2, 7)}`;
  const name = `${word} relish`;
  const newId = newIngredientId(name);
  const title = uniqueTitle("Relish Toast");
  const cook = [
    "---",
    `title: ${title}`,
    "servings: 2",
    "cuisine: other",
    "main_protein: none",
    "prep_time: 5 minutes",
    "cook_time: 5 minutes",
    "tags: [snack]",
    "---",
    `Spread @diced ${name}{3%tbsp} over @butter{1%tbsp} and rinse with @water{${1000 + 100 * Math.floor(Math.random() * 400)}%ml}.`,
    "",
  ].join("\n");
  await dropFiles(page, [{ name: "relish.cook", body: cook, mimeType: "text/plain" }]);

  // The import's banner says so and links to the review as well as the recipe.
  const ok = statusBanner(page, `Imported "${title}"`);
  await expect(ok).toBeVisible({ timeout: 45_000 });
  await expect(ok).toContainText(`1 new ingredient to review: ${name}`); // "diced" dropped from the new name
  await expect(ok.getByRole("link", { name: "Open recipe" })).toBeVisible();
  await expect(ok.getByRole("link", { name: "Review ingredients" })).toBeVisible();
  const ing = (await adminDb.doc(`ingredients/${newId}`).get()).data()!;
  expect(ing).toMatchObject({ name, aliases: [`diced ${name}`], needsReview: true });
  const recipeId = (await adminDb.collection("recipes").where("title", "==", title).get()).docs[0]!.id;
  // Some of it is already in the household's Supply.
  await seedSupply(household.hid, newId, [{ amount: 250, expiresInDays: 30 }], { label: name });

  // The Recipes page shows the banner; dismissing it hides it for this session only.
  await page.goto("/recipes");
  const recipesBanner = page.getByTestId("ingredient-review-banner");
  await expect(recipesBanner).toBeVisible();
  await expect(recipesBanner).toContainText(/ingredients? from imports needs? review/);
  await recipesBanner.getByRole("button", { name: "Hide until next time" }).click();
  await expect(recipesBanner).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("recipe-count")).toBeVisible();
  await expect(page.getByTestId("ingredient-review-banner")).toBeHidden();

  // Settings → Ingredients carries the live count and opens the review list.
  await page.goto("/settings");
  const entry = page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /Ingredients/ });
  await expect(entry).toContainText(/need(s)? review/);
  await expect(entry.getByTestId("review-count")).toHaveText(/^\d+$/);
  await entry.click();
  await expect(page).toHaveURL(/\/ingredients/);
  await expect(page.getByRole("button", { name: "Needs review" })).toHaveAttribute("aria-pressed", "true");

  // The card: the recipe that uses it, then Merge into… strawberry jam.
  const card = page.getByRole("article", { name });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Merge into…" }).click();
  const sheet = page.getByRole("dialog", { name: `Merge “${name}”` });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("combobox", { name: "Merge into" }).fill("strawberry jam");
  await sheet.getByRole("option", { name: /^strawberry jam/ }).click();
  await expect(sheet.getByTestId("merge-preview")).toContainText("Moves 1 recipe, 1 Supply row to strawberry jam", { timeout: 30_000 });
  await expect(sheet.getByTestId("merge-preview")).toContainText(`“${name}”`);
  await sheet.getByRole("button", { name: "Merge into strawberry jam" }).click();
  await expect(statusBanner(page, `Merged “${name}” into “strawberry jam”`)).toBeVisible({ timeout: 60_000 });
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("article", { name })).toHaveCount(0);

  // The recipe now uses strawberry jam (its wording unchanged), and the Supply moved with a consistent ledger.
  const recipe = (await adminDb.doc(`recipes/${recipeId}`).get()).data()!;
  expect(recipe.ingredientIds).toContain("strawberry-jam");
  expect(recipe.ingredientIds).not.toContain(newId);
  expect(recipe.version).toBe(1);
  const into = await supplyDoc(household.hid, "strawberry-jam");
  expect(into?.canonicalAmount).toBe(250);
  const txs = await adminDb.collection(`households/${household.hid}/supply/strawberry-jam/transactions`).get();
  expect(txs.docs.reduce((s, d) => s + Number(d.data().delta), 0)).toBe(250);
  expect((await supplyDoc(household.hid, newId))?.canonicalAmount).toBe(0);
  expect((await adminDb.doc(`ingredients/${newId}`).get()).data()).toMatchObject({ mergedInto: "strawberry-jam", needsReview: false });
  expect((await adminDb.doc("ingredients/strawberry-jam").get()).data()!.aliases).toEqual(expect.arrayContaining([name, `diced ${name}`]));

  // The household sees it under strawberry jam; the merged name is gone from Supply.
  await page.goto("/supply");
  await expect(page.getByRole("main")).toContainText(/strawberry jam/i, { timeout: 20_000 });
  await expect(page.getByRole("main")).not.toContainText(name);
  // The merged ingredient's page says where it went.
  await page.goto(`/ingredients/${newId}`);
  await expect(page.getByRole("status").filter({ hasText: "Merged into" })).toContainText("strawberry jam");
});

test("the More sheet links to Ingredients on phones", { tag: ["@R4.27"] }, async ({ page, household: _ }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "phones only: wider screens reach it from Settings");
  await page.goto("/plan");
  await page.getByRole("button", { name: "More pages" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: /Ingredients/ }).click();
  await expect(page).toHaveURL(/\/ingredients/);
  await expect(page.getByRole("heading", { name: "Ingredients", level: 1 })).toBeVisible();
});
