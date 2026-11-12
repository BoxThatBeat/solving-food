// gemini.spec.ts (Planning/M16): Settings → Gemini (R11.15, R4.36: the owner's key, everyone else a status line) and
// Add with Gemini (R4.37: a web link, uploaded photos, the camera option, several photos at once; not set up). Gemini and the web pages are
// the functions' stubs: `_stubLlm/{uid}` { pages, recipe, mode } for this test's own user.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { adminDb } from "../fixtures/admin";
import { uniqueTitle } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";

const cook = (title: string, extra = "") =>
  ["---", `title: ${title}`, "servings: 2", "cuisine: other", "main_protein: none", "prep_time: 5 minutes", "cook_time: 0 minutes", "tags: [snack]", extra, "---", "", "Spread @butter{1%tbsp} on @bread{2%slices}.", ""].filter((l, i) => i !== 8 || l).join("\n");

async function openAddSheet(page: Page) {
  await page.goto("/recipes");
  await page.getByRole("button", { name: "+ Add recipe" }).click();
  const sheet = page.getByRole("dialog", { name: "Add recipe" });
  await expect(sheet.getByTestId("add-with-gemini")).toBeVisible();
  return sheet;
}

test("Settings → Gemini: the owner saves the key there; others see whether it's set up (R11.15, R4.36)", { tag: ["@R11.15", "@R4.36"] }, async ({ page, household }) => {
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /Gemini/ }).click();
  await expect(page).toHaveURL(/\/settings\/gemini/);
  await expect(page.getByTestId("ai-status").getByRole("status")).toHaveText("Gemini is set up", { timeout: 20_000 });
  await expect(page.getByTestId("ai-key")).toHaveCount(0);

  await adminDb.doc(`_stubPcx/${household.hid}`).set({ ownerUid: household.uid });
  await page.reload();
  const card = page.getByTestId("ai-key");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("no billing");
  await card.getByLabel("Gemini API key").fill("AQ.not-the-key");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("alert")).toContainText(/didn't accept it.*400/);
  await card.getByLabel("Gemini API key").fill("stub-gemini-key");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Gemini key saved and working")).toBeVisible();
  // The Ingredients page no longer has the key card.
  await page.goto("/ingredients");
  await expect(page.getByRole("heading", { name: "Ingredients", level: 1 })).toBeVisible();
  await expect(page.getByTestId("ai-key")).toHaveCount(0);
});

test("Add recipe offers a link, an upload and the camera; a link becomes a recipe (R4.37)", { tag: ["@R4.37"] }, async ({ page, household }) => {
  test.setTimeout(120_000);
  const title = uniqueTitle("Gemini Link Toast");
  const url = `https://recipes.example.com/${title.toLowerCase().replace(/\W+/g, "-")}`;
  const ld = { "@context": "https://schema.org", "@type": "Recipe", name: title, recipeIngredient: ["1 tbsp butter", "2 slices bread"] };
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ pages: { [url]: `<script type="application/ld+json">${JSON.stringify(ld)}</script>` }, recipe: "```cooklang\n" + cook(title, `source: ${url}`) + "```" });

  const sheet = await openAddSheet(page);
  await expect(sheet.getByLabel("Take photos of a recipe")).toHaveAttribute("capture", "environment");
  await expect(sheet.getByLabel("Upload photos of a recipe")).toHaveAttribute("accept", "image/*");
  await expect(sheet.getByLabel("Upload photos of a recipe")).toHaveAttribute("multiple", "");
  await expect(sheet.getByRole("link", { name: /Manual entry/ })).toBeVisible();
  await expect(sheet.getByRole("link", { name: /Drop a .cook file/ })).toBeVisible();
  await sheet.getByLabel("Paste a web recipe link").fill(url);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
});

test("a photo of a recipe becomes a recipe; Gemini not set up says where to set it up (R4.37)", { tag: ["@R4.37"] }, async ({ page, household }) => {
  test.setTimeout(120_000);
  const title = uniqueTitle("Gemini Card Toast");
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ recipe: "```cooklang\n" + cook(title) + "```" });
  let sheet = await openAddSheet(page);
  await sheet.getByLabel("Upload photos of a recipe").setInputFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) });
  const chosen = sheet.getByTestId("gemini-photo");
  await expect(chosen.getByRole("img", { name: "Photo 1" })).toHaveCount(1);
  await chosen.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 60_000 });
  const recipe = (await adminDb.collection("recipes").where("title", "==", title).get()).docs[0]!.data();
  expect(recipe.imagePaths).toEqual([]);

  await adminDb.doc(`_stubLlm/${household.uid}`).set({ mode: "off" });
  sheet = await openAddSheet(page);
  await expect(sheet.getByTestId("add-with-gemini")).toContainText("Gemini isn't set up yet", { timeout: 20_000 });
  await expect(sheet.getByRole("link", { name: "Settings → Gemini" })).toBeVisible();
  await expect(sheet.getByLabel("Paste a web recipe link")).toBeDisabled();
});

test("a photo can go with the recipe's text: a dish photo becomes its picture; a site that refuses apps says so (R4.37)", { tag: ["@R4.37"] }, async ({ page, household }) => {
  test.setTimeout(120_000);
  const title = uniqueTitle("Gemini Dish Toast");
  const blocked = "https://blocked.example.com/toast";
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ pages: { [blocked]: "!403" }, recipe: "DISH: 1\n```cooklang\n" + cook(title) + "```" });
  const sheet = await openAddSheet(page);
  await sheet.getByLabel("Paste a web recipe link").fill(blocked);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet.getByRole("alert")).toContainText("doesn't let apps read its recipes (HTTP 403)", { timeout: 30_000 });

  const png = readFileSync(fileURLToPath(new URL("../../data/recipes/obsidian/attachments/Pasted image 20240116181103.png", import.meta.url)));
  await sheet.getByLabel("Upload photos of a recipe").setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: png });
  const chosen = sheet.getByTestId("gemini-photo");
  await expect(chosen.getByRole("img", { name: "Photo 1" })).toBeVisible();
  await expect(sheet.getByLabel("Take photos of a recipe")).toHaveCount(0);
  await chosen.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(chosen).toHaveCount(0);
  await sheet.getByLabel("Upload photos of a recipe").setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: png });
  await chosen.getByLabel("Recipe text").fill("Buttered toast. 1 tbsp butter, 2 slices bread. Toast the bread and butter it.");
  await chosen.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 60_000 });
  const recipe = (await adminDb.collection("recipes").where("title", "==", title).get()).docs[0]!.data();
  expect(recipe.imagePaths).toHaveLength(1);
});

test("several photos go together: pages of a recipe and the dish, added one after another; Gemini names the dish (R4.37)", { tag: ["@R4.37"] }, async ({ page, household }) => {
  test.setTimeout(120_000);
  const title = uniqueTitle("Gemini Pages Toast");
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ recipe: "DISH: 3\n```cooklang\n" + cook(title) + "```" });
  const png = readFileSync(fileURLToPath(new URL("../../data/recipes/obsidian/attachments/Pasted image 20240116181103.png", import.meta.url)));
  const sheet = await openAddSheet(page);
  await sheet.getByLabel("Upload photos of a recipe").setInputFiles([
    { name: "page1.png", mimeType: "image/png", buffer: png },
    { name: "page2.png", mimeType: "image/png", buffer: png },
  ]);
  const chosen = sheet.getByTestId("gemini-photo");
  await expect(chosen.getByRole("img", { name: "Photo 2" })).toBeVisible();
  await expect(chosen.getByLabel("Take another photo")).toHaveAttribute("capture", "environment");
  await chosen.getByLabel("Add another photo").setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: png });
  await expect(chosen.getByRole("list", { name: "Chosen photos" }).getByRole("listitem")).toHaveCount(3);
  // Up to six: the seventh is refused with a message, and the add buttons go away when full.
  await chosen.getByLabel("Add another photo").setInputFiles([4, 5, 6, 7].map((i) => ({ name: `p${i}.png`, mimeType: "image/png", buffer: png })));
  await expect(sheet.getByRole("alert")).toContainText("Up to 6 photos for one recipe");
  await expect(chosen.getByRole("listitem")).toHaveCount(6);
  await expect(chosen.getByLabel("Add another photo")).toHaveCount(0);
  for (const n of [6, 5, 4]) await chosen.getByRole("button", { name: `Remove photo ${n}` }).click();
  await expect(chosen.getByRole("listitem")).toHaveCount(3);
  await chosen.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 60_000 });
  const recipe = (await adminDb.collection("recipes").where("title", "==", title).get()).docs[0]!.data();
  expect(recipe.imagePaths).toHaveLength(1);
});
