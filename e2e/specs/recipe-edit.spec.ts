// Recipe editing (TECHNICAL_SPECS §14.1 recipe-edit.spec.ts): manual create with the fixed cuisine and protein lists
// and the ingredient picker's allowed measurements, edits with version history and restore, the concurrent-edit
// warning, the offline draft, duplicate check on save, and delete → Trash → restore. The 30-day purge and its cleanup
// run in the weekly maintenance function and are covered by the functions emulator tests (functions/test/
// maintenance.test.ts), since a scheduled function can't be triggered from the browser.
import type { Page } from "@playwright/test";
import { CUISINES, MAIN_PROTEINS, taxonomyLabel } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { makeRecipe, uniqueCook, uniqueTitle, waitForIndexed } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { detail, RecipesPage } from "../pages/recipes";

async function pickIngredient(page: Page, n: number, typed: string, option: RegExp) {
  const box = page.getByRole("combobox", { name: `Ingredient ${n}`, exact: true });
  await box.fill(typed);
  await page.getByRole("option", { name: option }).first().click();
}

test("manual entry: title, fixed cuisine and protein lists, tags, tools, ingredients in allowed measures, steps with inline ingredients", { tag: ["@R4.15", "@R4.25", "@R8.3", "@R4.18"] }, async ({ page, household }) => {
  await page.goto("/recipes");
  await page.getByRole("button", { name: "+ Add recipe" }).click();
  await page.getByRole("link", { name: /Manual entry/ }).click();
  await expect(page).toHaveURL(/\/recipes\/new$/);
  const form = page.getByRole("form", { name: "New recipe" });

  const title = uniqueTitle("Weeknight Chicken Thighs");
  await form.getByLabel("Title").fill(title);
  const servings = 3;
  await form.getByLabel("Servings").fill(String(servings));
  await form.getByLabel("Prep min").fill("10");
  await form.getByLabel("Cook min").fill("35");

  // Cuisine and main protein are chosen from the fixed lists only (taxonomy.ts).
  const cuisine = form.getByRole("radiogroup", { name: "Cuisine" });
  await expect(cuisine.getByRole("radio")).toHaveText(CUISINES.map((c) => taxonomyLabel(c)));
  await cuisine.getByRole("radio", { name: "Korean" }).click();
  const protein = form.getByRole("radiogroup", { name: "Main protein" });
  await expect(protein.getByRole("radio")).toHaveText(MAIN_PROTEINS.map((c) => taxonomyLabel(c)));
  await protein.getByRole("radio", { name: "Chicken" }).click();
  await expect(protein.getByRole("radio", { name: "Chicken" })).toHaveAttribute("aria-checked", "true");

  await form.getByPlaceholder("Add tags and press Enter").fill("sheet pan");
  await form.getByPlaceholder("Add tags and press Enter").press("Enter");
  await form.getByPlaceholder("Add tools and press Enter").fill("oven");
  await form.getByPlaceholder("Add tools and press Enter").press("Enter");

  // Ingredient 1: chicken thighs allow weight and count only, so the unit list has no volumes (R8.3).
  await form.getByRole("button", { name: "Add ingredient" }).click();
  await pickIngredient(page, 1, "chicken thigh", /^Chicken thigh/i);
  const unit1 = form.getByRole("combobox", { name: "Unit for ingredient 1" });
  const units = await unit1.locator("option").allTextContents();
  expect(units).toEqual(expect.arrayContaining(["g", "lb", "pieces"]));
  expect(units).not.toContain("cups");
  expect(units).not.toContain("tsp");
  await form.getByLabel("Amount for ingredient 1").fill("6");
  await unit1.selectOption({ label: "pieces" });

  // Ingredient 2: garlic allows weight, volume, and count.
  await form.getByRole("button", { name: "Add ingredient" }).click();
  await pickIngredient(page, 2, "garlic", /^Garlic\b/i);
  const unit2 = form.getByRole("combobox", { name: "Unit for ingredient 2" });
  expect(await unit2.locator("option").allTextContents()).toEqual(expect.arrayContaining(["g", "tsp", "pieces"]));
  await form.getByLabel("Amount for ingredient 2").fill("2");
  await unit2.selectOption({ label: "tsp" });

  // Steps: insert ingredients where they're used.
  const step1 = form.getByRole("textbox", { name: "Step 1", exact: true });
  await step1.fill("Rub the ");
  await form.getByRole("button", { name: /^Insert chicken thigh/ }).click();
  await expect(step1).toHaveValue(/^Rub the \{\{ing:[^}]+\}\}$/);
  await expect(step1).toBeFocused(); // the chip puts the caret back in the step
  await step1.press("End");
  await step1.pressSequentially(" with ");
  await form.getByRole("button", { name: /^Insert garlic/ }).click();
  await expect(step1).toHaveValue(/^Rub the \{\{ing:[^}]+\}\} with \{\{ing:[^}]+\}\}$/);
  await expect(step1).toBeFocused();
  await form.getByLabel("Step 1 timer minutes").fill("35");
  await form.getByRole("button", { name: "Save recipe" }).click();
  // The same test runs in several projects at once with identical ingredients, so the duplicate check may (rightly)
  // find the other run's recipe; that flow is covered below, so keep both here.
  const dupe = page.getByRole("alertdialog", { name: "Possible duplicate" }).or(page.getByRole("dialog", { name: "Possible duplicate" }));
  await expect(dupe.or(page.locator("#recipe-title"))).toBeVisible();
  if (await dupe.isVisible()) await dupe.getByRole("button", { name: "Keep both" }).click();

  await expect(page).toHaveURL(/\/recipes\/(?!new)[^/]+$/);
  const d = detail(page);
  await expect(d.locator("#recipe-title")).toHaveText(title);
  await expect(d.getByText("KOREAN", { exact: true }).or(d.getByText("Korean", { exact: true })).first()).toBeVisible();
  await expect(d.locator("section[aria-labelledby=ing-h] li")).toHaveCount(2);
  await expect(d.locator("section[aria-labelledby=ing-h]")).toBeVisible();
  // A count reads as written, with no metric after it (R8.13 v3).
  await expect(d.locator("section[aria-labelledby=ing-h] li").filter({ hasText: /chicken thigh/i }).getByTestId("ingredient-amount")).toHaveText(/^6( pieces)?$/);
  await expect(d.locator("section[aria-labelledby=ing-h]")).not.toContainText("(660 g)");
  await expect(d.locator("section[aria-labelledby=steps-h]")).toContainText(/Rub the chicken thigh\s*6.*with garlic\s*2 tsp/i);
  await expect(d.getByText("⏱ 35 min")).toBeVisible();
  await expect(d.getByText("oven", { exact: true })).toBeVisible();

  const id = page.url().split("/").pop()!;
  const doc = (await adminDb.doc(`recipes/${id}`).get()).data()!;
  expect(doc).toMatchObject({ title, cuisine: "korean", mainProtein: "chicken", prepMin: 10, cookMin: 35, version: 1, status: "active", createdBy: household.uid, servings });
  expect(doc.tags).toEqual(expect.arrayContaining(["dinner", "sheet pan"]));
  expect(doc.ingredients[0]).toMatchObject({ ingredientId: "chicken-thigh", amount: 6, measure: "count", canonicalAmount: 660 });
  expect((await adminDb.doc(`recipes/${id}/versions/1`).get()).exists).toBe(true);
  await waitForIndexed(id);
});

test("the picker creates a new ingredient with its measurements and flags it for review", { tag: ["@R8.3"] }, async ({ page, household: _ }) => {
  await page.goto("/recipes/new");
  const form = page.getByRole("form", { name: "New recipe" });
  await form.getByRole("button", { name: "Add ingredient" }).click();
  const name = `e2e kumquat ${Math.random().toString(36).slice(2, 6)}`;
  await page.getByRole("combobox", { name: "Ingredient 1", exact: true }).fill(name);
  await page.getByRole("option", { name: new RegExp(`Create “${name}”`) }).click();
  const box = form.getByRole("group", { name: "New ingredient" });
  await box.getByLabel("Category").selectOption("produce");
  const measures = box.getByRole("group", { name: "Allowed measurements" });
  for (const m of ["Weight", "Volume", "Count"]) {
    const chip = measures.getByRole("button", { name: m });
    if ((await chip.getAttribute("aria-pressed")) === "true") await chip.click();
  }
  await measures.getByRole("button", { name: "Count" }).click();
  await box.getByLabel("Grams per piece").fill("20");
  await box.getByRole("button", { name: "Add ingredient" }).click();
  await expect(page.getByRole("status").filter({ hasText: /flagged for review \(missing.*protein/i })).toBeVisible();
  const unit = form.getByRole("combobox", { name: "Unit for ingredient 1" });
  expect(await unit.locator("option").allTextContents()).not.toContain("g");
  const id = name.replace(/ /g, "-");
  await expect.poll(async () => (await adminDb.doc(`ingredients/${id}`).get()).data()).toMatchObject({ allowedMeasures: ["count"], unitWeightG: 20, needsReview: true, category: "produce" });

  // The ingredient editor edits its measurements and conversions.
  await page.goto(`/ingredients/${id}`);
  await expect(page.getByRole("heading", { name: new RegExp(name, "i") })).toBeVisible();
});

test("anyone can edit; every save is a version and an old version can be restored", { tag: ["@R4.19"] }, async ({ page, household: _ }) => {
  const title = uniqueTitle("Versioned Tzatziki");
  const id = await makeRecipe(title);
  await page.goto(`/recipes/${id}`);
  await detail(page).getByRole("link", { name: "Edit", exact: true }).click();
  const form = page.getByRole("form", { name: "Edit recipe" });
  await form.getByLabel("Title").fill(`${title} (garlicky)`);
  await form.getByLabel("Servings").fill("6");
  await form.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as v2 for everyone" })).toBeVisible();
  await expect(detail(page).locator("#recipe-title")).toHaveText(`${title} (garlicky)`);
  await expect(detail(page).getByText(/SHARED LIBRARY · V2/)).toBeVisible();
  expect((await adminDb.doc(`recipes/${id}/versions/2`).get()).data()).toMatchObject({ title: `${title} (garlicky)`, servings: 6 });

  await detail(page).getByRole("button", { name: "Version history" }).click();
  const sheet = page.getByRole("dialog", { name: "Version history" });
  await sheet.getByRole("button", { name: "Restore version 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Restored v1 as v3 for everyone" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail(page).locator("#recipe-title")).toHaveText(title);
  await expect(detail(page).getByText(/SHARED LIBRARY · V3/)).toBeVisible();
  expect((await adminDb.doc(`recipes/${id}`).get()).data()).toMatchObject({ version: 3, title, servings: 2 });
});

test("a recipe imported through the drop folder keeps its v1: edit it, see v1 and v2 in the history, restore v1", { tag: ["@R4.19", "@R4.16"] }, async ({ page, household }) => {
  // The live library arrived through the drop folder (M7 review: "editing creates a v2 but there is no more v1").
  const title = uniqueTitle("Dropped Flatbread");
  const cook = uniqueCook("easy-flatbread-no-yeast.cook", { title, image: null });
  await page.goto("/drop");
  await page.getByLabel("Choose .cook files and photos").setInputFiles([{ name: "dropped-flatbread.cook", mimeType: "text/plain", buffer: Buffer.from(cook) }]);
  const ok = page.getByTestId("notifications").getByRole("status").filter({ hasText: `Imported "${title}"` });
  await expect(ok).toBeVisible({ timeout: 45_000 });
  const id = (await adminDb.collection("recipes").where("title", "==", title).get()).docs[0]!.id;
  expect((await adminDb.doc(`recipes/${id}/versions/1`).get()).data()).toMatchObject({ title, version: 1, editedBy: household.uid });

  await ok.getByRole("link", { name: "Open recipe" }).click();
  await expect(detail(page).locator("#recipe-title")).toHaveText(title);
  // Open the history once before editing, as a phone that has been browsing the library would have.
  await detail(page).getByRole("button", { name: "Version history" }).click();
  const sheet = page.getByRole("dialog", { name: "Version history" });
  await expect(sheet.getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await detail(page).getByRole("link", { name: "Edit", exact: true }).click();
  const form = page.getByRole("form", { name: "Edit recipe" });
  await form.getByLabel("Title").fill(`${title} (thin)`);
  await form.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as v2 for everyone" })).toBeVisible();
  await expect(detail(page).locator("#recipe-title")).toHaveText(`${title} (thin)`);

  await detail(page).getByRole("button", { name: "Version history" }).click();
  await expect(sheet.getByRole("listitem")).toHaveCount(2);
  await expect(sheet.getByRole("listitem").first()).toContainText(`v2 · ${title} (thin)`);
  await expect(sheet.getByRole("listitem").last()).toContainText(`v1 · ${title}`);
  await sheet.getByRole("button", { name: "Restore version 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Restored v1 as v3 for everyone" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail(page).locator("#recipe-title")).toHaveText(title);
  expect((await adminDb.doc(`recipes/${id}`).get()).data()).toMatchObject({ version: 3, title });
});

test("someone else saving while you edit shows \"edited elsewhere\" with reload or overwrite", { tag: ["@R4.19"] }, async ({ page, household: _ }) => {
  const title = uniqueTitle("Contested Salad");
  const id = await makeRecipe(title);
  await page.goto(`/recipes/${id}/edit`);
  const form = page.getByRole("form", { name: "Edit recipe" });
  await expect(form.getByLabel("Title")).toHaveValue(title);

  // Another member saves v2 meanwhile (as their client would: the doc and its snapshot).
  const cur = (await adminDb.doc(`recipes/${id}`).get()).data()!;
  const theirs = { ...cur, title: `${title} (theirs)`, version: 2, updatedBy: "someone-else", updatedAt: new Date() };
  await adminDb.batch().set(adminDb.doc(`recipes/${id}`), theirs).set(adminDb.doc(`recipes/${id}/versions/2`), theirs).commit();

  await form.getByLabel("Title").fill(`${title} (mine)`);
  await form.getByRole("button", { name: "Save recipe" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Edited elsewhere" }).or(page.getByRole("dialog", { name: "Edited elsewhere" }));
  await expect(dialog).toContainText("Someone saved v2 while you were editing");
  await dialog.getByRole("button", { name: "Overwrite" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as v3 for everyone" })).toBeVisible();
  expect((await adminDb.doc(`recipes/${id}`).get()).data()).toMatchObject({ version: 3, title: `${title} (mine)` });
});

test("offline: saving waits, the draft is kept, and it saves when back online", { tag: ["@R4.19"] }, async ({ page, context, household: _ }) => {
  const title = uniqueTitle("Offline Muffins");
  const id = await makeRecipe(title);
  await page.goto(`/recipes/${id}/edit`);
  const form = page.getByRole("form", { name: "Edit recipe" });
  await expect(form.getByLabel("Title")).toHaveValue(title);
  await context.setOffline(true);
  await expect(form.getByText(/You're offline\. Your draft is kept on this device/)).toBeVisible();
  await form.getByLabel("Title").fill(`${title} v2`);
  await expect(form.getByRole("button", { name: "Will save when online" })).toBeDisabled();

  // The draft survives a reload on this device.
  await page.waitForTimeout(600); // draft write is debounced 400 ms
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(/You have an unsaved draft/)).toBeVisible();
  await page.getByRole("button", { name: "Restore draft" }).click();
  await expect(form.getByLabel("Title")).toHaveValue(`${title} v2`);
  await form.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as v2 for everyone" })).toBeVisible();
});

test("saving a recipe that looks like an existing one asks: keep existing, keep new, or keep both", { tag: ["@R4.20"] }, async ({ page, household: _ }) => {
  const url = `https://example.com/recipes/dupe-${Math.random().toString(36).slice(2, 8)}`;
  const existingTitle = uniqueTitle("Existing Flatbread");
  const existing = await makeRecipe(existingTitle, { from: "easy-flatbread-no-yeast.cook", content: { sourceUrl: url } });
  await waitForIndexed(existing);

  await page.goto("/recipes/new");
  const form = page.getByRole("form", { name: "New recipe" });
  const title = uniqueTitle("My Flatbread");
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Source URL").fill(`${url}?utm_source=newsletter`);
  await form.getByRole("button", { name: "Add ingredient" }).click();
  await pickIngredient(page, 1, "all-purpose flour", /^All-purpose flour/i);
  // One serving of a random weight, so this recipe's fingerprint (amounts per serving, 5 g buckets) matches nothing
  // else, not even another run of this test; the source URL is what makes it a duplicate.
  await form.getByLabel("Servings").fill("1");
  await form.getByLabel("Amount for ingredient 1").fill(String(1000 + 10 * Math.floor(Math.random() * 900)));
  await form.getByRole("combobox", { name: "Unit for ingredient 1" }).selectOption("g");
  await form.getByRole("textbox", { name: "Step 1", exact: true }).fill("Mix and cook.");
  await form.getByRole("button", { name: "Save recipe" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Possible duplicate" }).or(page.getByRole("dialog", { name: "Possible duplicate" }));
  await expect(dialog).toContainText(existingTitle);
  await expect(dialog.getByRole("button", { name: "Keep existing" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep new" })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(detail(page).locator("#recipe-title")).toHaveText(title);
  const newId = page.url().split("/").pop()!;
  expect(newId).not.toBe(existing);
  expect((await adminDb.doc(`recipes/${existing}`).get()).data()!.title).toBe(existingTitle);
});

test("delete warns it's for everyone, moves to Trash (hidden from search), and Trash restores it", { tag: ["@R4.26"] }, async ({ page, household: _ }) => {
  const title = uniqueTitle("Doomed Brownies");
  const id = await makeRecipe(title, { from: "cake-mix-brownies.cook" });
  await waitForIndexed(id);
  await page.goto(`/recipes/${id}`);
  await detail(page).getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete for everyone?" }).or(page.getByRole("dialog", { name: "Delete for everyone?" }));
  await expect(dialog).toContainText("This removes the recipe for everyone, in every household. It stays in Trash for 30 days.");
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("status").filter({ hasText: `"${title}" moved to Trash for 30 days` })).toBeVisible();
  await expect(page).toHaveURL(/\/recipes$/);
  expect((await adminDb.doc(`recipes/${id}`).get()).data()).toMatchObject({ status: "trashed", version: 2 });
  // Its page still opens (plans and meals that reference it keep working), marked as in Trash.
  await page.goto(`/recipes/${id}`);
  await expect(detail(page).getByText(/Recipe in Trash · deleted for everyone · purged in 30 days/)).toBeVisible();

  // Gone from the library and search.
  await waitForIndexed(id, false);
  const r = new RecipesPage(page);
  await r.goto(`?q=${encodeURIComponent(title)}`);
  await expect(page.getByText("No recipes match.")).toBeVisible();

  await page.getByRole("link", { name: "Trash" }).click();
  await expect(page).toHaveURL(/\/recipes\/trash$/);
  const item = page.getByRole("list", { name: "Trashed recipes" }).getByRole("listitem").filter({ hasText: title });
  await expect(item).toContainText("30 days left");
  await item.getByRole("button", { name: `Restore ${title}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `“${title}” restored` })).toBeVisible();
  await expect(item).toBeHidden();

  await waitForIndexed(id, true);
  await r.goto(`?q=${encodeURIComponent(title)}`);
  await expect(r.card(title)).toBeVisible();
  expect((await adminDb.doc(`recipes/${id}`).get()).data()).toMatchObject({ status: "active", version: 3 });
});

test("a photo added in the editor is resized in the browser to three WebP sizes and shown on the recipe", { tag: ["@R4.15"] }, async ({ page, household: _ }) => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { ATTACHMENTS_DIR, bucket } = await import("../fixtures/recipes");
  const title = uniqueTitle("Photographed Salad");
  const id = await makeRecipe(title);
  await page.goto(`/recipes/${id}/edit`);
  const form = page.getByRole("form", { name: "Edit recipe" });
  await form.getByLabel("Add photo").setInputFiles({ name: "salad.jpeg", mimeType: "image/jpeg", buffer: readFileSync(join(ATTACHMENTS_DIR, "IMG_6374.jpeg")) });
  await expect(form.getByText("MAIN", { exact: true })).toBeVisible({ timeout: 20_000 });
  await form.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as v2 for everyone" })).toBeVisible();
  const img = detail(page).getByRole("img", { name: title });
  await expect(img).toHaveAttribute("srcset", /480\.webp\S* 480w.*960\.webp\S* 960w.*1920\.webp\S* 1920w/);
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  const base = ((await adminDb.doc(`recipes/${id}`).get()).data()!.imagePaths as string[])[0]!;
  expect(base).toMatch(new RegExp(`^recipes/${id}/`));
  const [files] = await bucket().getFiles({ prefix: `${base}/` });
  expect(files.map((f) => f.name.split("/").pop()).sort()).toEqual(["1920.webp", "480.webp", "960.webp"]);
  // Each size within the 2 MB Storage rule.
  for (const f of files) expect(Number(f.metadata.size)).toBeLessThan(2 * 1024 * 1024);
});
