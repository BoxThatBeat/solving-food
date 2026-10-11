// Drop folder (TECHNICAL_SPECS §14.1 drop-folder.spec.ts): .cook files uploaded on the Drop page are imported by the
// dropFolder function (photos saved into the app), errors are reported on whatever page is open, processed files are
// deleted, and look-alike imports wait in the review list for keep existing / keep new / keep both. Also checks that
// the Claude skill's fixed lists and examples are what the app accepts (R4.17).
import { readdirSync, readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { CUISINES, MAIN_PROTEINS, taxonomyLabel } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { ATTACHMENTS_DIR, bucket, makeRecipe, uniqueCook, uniqueTitle, waitForIndexed } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { detail, RecipesPage } from "../pages/recipes";

const SKILL_DIR = fileURLToPath(new URL("../../.claude/skills/solving-food-skill/", import.meta.url));

async function dropFiles(page: Page, files: Array<{ name: string; body: string | Buffer; mimeType: string }>) {
  await page.goto("/drop");
  await page.getByLabel("Choose .cook files and photos").setInputFiles(files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body) })));
}

const banner = (page: Page, text: string | RegExp) => page.getByTestId("notifications").getByRole("status").filter({ hasText: text });

test("a .cook file with its photo imports with the photo saved into the app; the files are deleted", { tag: ["@R4.16", "@R12.1"] }, async ({ page, household }) => {
  const title = uniqueTitle("Dropped Brownies");
  const photo = "Pasted image 20240116181103.png"; // a name with spaces
  const cook = uniqueCook("cake-mix-brownies.cook", { title, image: `../obsidian/attachments/${photo}` });
  await dropFiles(page, [
    { name: photo, body: readFileSync(join(ATTACHMENTS_DIR, photo)), mimeType: "image/png" },
    { name: "dropped-brownies.cook", body: cook, mimeType: "text/plain" },
  ]);
  const uploaded = page.getByRole("list", { name: "Uploaded files" });
  await expect(uploaded).toContainText("dropped-brownies.cook");

  const ok = banner(page, `Imported "${title}" from dropped-brownies.cook.`);
  await expect(ok).toBeVisible({ timeout: 45_000 });
  await ok.getByRole("link", { name: "Open recipe" }).click();
  await expect(detail(page).locator("#recipe-title")).toHaveText(title);
  const img = detail(page).getByRole("img", { name: title });
  await expect(img).toHaveAttribute("src", /\/o\/recipes%2F[^%]+%2F[^%]+%2F960\.webp/);
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  await expect(detail(page).locator("section[aria-labelledby=ing-h] li")).toHaveCount(6); // 5 + the unique water line

  // Both files are gone from the drop folder.
  await expect.poll(async () => (await bucket().getFiles({ prefix: `recipe-drop/${household.uid}/` }))[0].length, { timeout: 20_000 }).toBe(0);
});

test("an invalid file shows an error banner, on whatever page is open, until dismissed", { tag: ["@R4.16", "@R12.1"] }, async ({ page, household }) => {
  await dropFiles(page, [{ name: "broken-recipe.cook", body: "---\ntitle: Broken\nservings: 2\n---\nStir @salt{}.", mimeType: "text/plain" }]);
  await page.getByRole("link", { name: "Recipes" }).first().click();
  await expect(page).toHaveURL(/\/recipes/);
  const err = page.getByTestId("notifications").getByRole("alert").filter({ hasText: "broken-recipe.cook" });
  await expect(err).toBeVisible({ timeout: 45_000 });
  await expect(err).toContainText(/missing cuisine/);
  await expect(err).toContainText(/missing main_protein/);
  await page.waitForTimeout(7000); // past the success auto-dismiss
  await expect(err).toBeVisible();
  await err.getByRole("button", { name: "Dismiss" }).click();
  await expect(err).toBeHidden();
  await expect.poll(async () => (await bucket().getFiles({ prefix: `recipe-drop/${household.uid}/` }))[0].length, { timeout: 20_000 }).toBe(0);
});

test.describe("duplicates wait for review", () => {
  async function dropDuplicate(page: Page, from: string) {
    const title = uniqueTitle("Review Me");
    // The same text twice: once already in the library, once dropped. Its extra random ingredient keeps it from
    // matching the seed recipe or a parallel run's copy.
    const cook = uniqueCook(from, { title, cuisine: "other", image: null });
    const existing = await makeRecipe(title, { cook });
    await waitForIndexed(existing);
    await dropFiles(page, [{ name: "again.cook", body: cook, mimeType: "text/plain" }]);
    const info = banner(page, `"${title}" looks like a duplicate of "${title}"`);
    await expect(info).toBeVisible({ timeout: 45_000 });
    await info.getByRole("link", { name: "Review" }).click();
    const sheet = page.getByRole("dialog", { name: "Needs review" });
    await expect(sheet).toBeVisible();
    const item = sheet.getByRole("article", { name: `Possible duplicate: ${title}` });
    await expect(item).toContainText(/Same|similar/i);
    await expect(item).toContainText("New (import)");
    await expect(item).toContainText("Existing");
    const pending = (await adminDb.collection("recipes").where("title", "==", title).where("status", "==", "pendingDuplicateReview").get()).docs[0]!;
    // Hidden from the library while it waits.
    expect((await adminDb.collection("recipeIndex").get()).docs.some((d) => !!(d.data().recipes ?? {})[pending.id])).toBe(false);
    return { title, existing, pendingId: pending.id, item, sheet };
  }

  test("keep existing discards the import", { tag: ["@R4.20"] }, async ({ page, household: _ }) => {
    const { existing, pendingId, item } = await dropDuplicate(page, "greek-salad.cook");
    await item.getByRole("button", { name: "Keep existing" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Import discarded" })).toBeVisible();
    await expect(item).toBeHidden();
    await expect.poll(async () => (await adminDb.doc(`recipes/${pendingId}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`recipes/${existing}`).get()).data()!.version).toBe(1);
  });

  test("keep new saves the import as the next version of the existing recipe", { tag: ["@R4.20"] }, async ({ page, household: _ }) => {
    const { existing, pendingId, item } = await dropDuplicate(page, "taco-seasoning.cook");
    await item.getByRole("button", { name: "Keep new" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Import saved as a new version of the existing recipe" })).toBeVisible();
    await expect.poll(async () => (await adminDb.doc(`recipes/${pendingId}`).get()).exists).toBe(false);
    const doc = (await adminDb.doc(`recipes/${existing}`).get()).data()!;
    expect(doc.version).toBe(2);
    expect(doc.status).toBe("active");
  });

  test("keep both makes the import a recipe of its own", { tag: ["@R4.20"] }, async ({ page, household: _ }) => {
    const { title, pendingId, item, sheet } = await dropDuplicate(page, "tzatziki-sauce.cook");
    await item.getByRole("button", { name: "Keep both" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Both kept" })).toBeVisible();
    await expect.poll(async () => (await adminDb.doc(`recipes/${pendingId}`).get()).data()?.status).toBe("active");
    await waitForIndexed(pendingId);
    await sheet.getByRole("button", { name: "Close" }).click();
    const r = new RecipesPage(page);
    await r.goto(`?q=${encodeURIComponent(title)}`);
    await expect(r.list.getByRole("heading", { name: title, exact: true })).toHaveCount(2);
  });
});

test("the Claude skill embeds the same fixed lists as the app, and its examples import", { tag: ["@R4.17", "@R4.25"] }, async ({ page, household: _ }) => {
  const taxonomy = readFileSync(join(SKILL_DIR, "references/taxonomy.md"), "utf8");
  const section = (h: string) => [...taxonomy.split(`## ${h}`)[1]!.split("\n## ")[0]!.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
  expect(section("cuisine")).toEqual([...CUISINES]);
  expect(section("main_protein")).toEqual([...MAIN_PROTEINS]);

  // The editor offers exactly those.
  await page.goto("/recipes/new");
  await expect(page.getByRole("radiogroup", { name: "Cuisine" }).getByRole("radio")).toHaveText(CUISINES.map((c) => taxonomyLabel(c)));

  // The skill's photo example, dropped as an LLM would deliver it (with a photo of its own).
  const example = readFileSync(join(SKILL_DIR, "examples/photo.md"), "utf8").match(/```cooklang\n([\s\S]*?)```/)![1]!;
  const title = uniqueTitle("Skill Banana Bread");
  const cook = example
    .replace(/^title: .*$/m, `title: ${title}`)
    .replace(/^image: .*$/m, "image: banana.jpg")
    .concat(`\nRinse everything with @water{${1000 + 100 * Math.floor(Math.random() * 400)}%ml}.\n`); // unique fingerprint per run
  await dropFiles(page, [
    { name: "banana.jpg", body: readFileSync(join(ATTACHMENTS_DIR, "oat-flour-banana-muffins.jpg")), mimeType: "image/jpeg" },
    { name: "grandmas-banana-bread.cook", body: cook, mimeType: "text/plain" },
  ]);
  const ok = banner(page, `Imported "${title}"`);
  await expect(ok).toBeVisible({ timeout: 45_000 });
  await expect(ok).not.toContainText("new ingredient");
  await ok.getByRole("link", { name: "Open recipe" }).click();
  await expect(detail(page).getByText("AMERICAN").first()).toBeVisible();
  await expect(detail(page).locator("section[aria-labelledby=ing-h]")).toContainText(/walnuts/i);
});

test("Download skill hands out the repo's skill folder, byte for byte, so any AI can be taught the format", { tag: ["@R4.17"] }, async ({ page, household: _ }) => {
  await page.goto("/drop");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download skill (.zip)" }).click()]);
  expect(download.suggestedFilename()).toBe("solving-food-skill.zip");
  const zip = unzipSync(new Uint8Array(readFileSync((await download.path())!)));

  const expected: Record<string, string> = {};
  for (const rel of readdirSync(SKILL_DIR, { recursive: true }) as string[]) {
    if (rel.endsWith(".md")) expected[`solving-food-skill/${rel.replaceAll("\\", "/")}`] = readFileSync(join(SKILL_DIR, rel), "utf8");
  }
  expect(Object.keys(expected).length).toBeGreaterThanOrEqual(8); // SKILL.md, references, examples
  expect(Object.keys(zip).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, body] of Object.entries(expected)) expect(strFromU8(zip[name]!), name).toBe(body);
});
