// Add with Gemini against the stubs (M16, R4.37): a link with Recipe JSON-LD becomes a recipe through the importer
// (the prompt is the skill plus the page's recipe data), a page that won't open, a photo (sent inline, deleted
// after, never the recipe's image), a file that fails the checks gets one repair round, not set up, the rate limit.
process.env.PCX_STUB = "1";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENTS_DIR, bucket, clearFirestore, db, fileExists, seedIngredients } from "./helpers";
import { addRecipeWithGemini, ADD_PER_HOUR } from "../src/ai/addRecipe";
import { stubGenerateRequests } from "../src/ai/gemini";
import { resetIngredientCache } from "../src/dropFolder";

const UID = "adder";
const URL1 = "https://recipes.example.com/jam-toast";

const cook = (title: string, extra = "") => `---
title: ${title}
servings: 2
cuisine: other
main_protein: none
prep_time: 5 minutes
cook_time: 0 minutes
tags: [snack]
${extra}---

Spread @butter{1%tbsp} on @bread{2%slices}.
`;

async function stub(fields: Record<string, unknown>) {
  await db.doc(`_stubLlm/${UID}`).set(fields);
}

beforeEach(async () => {
  await clearFirestore();
  await seedIngredients();
  resetIngredientCache();
  stubGenerateRequests.length = 0;
});

describe("from a link", () => {
  it("the page's Recipe JSON-LD goes to Gemini with the skill, and its .cook file is imported", async () => {
    const ld = { "@context": "https://schema.org", "@type": "Recipe", name: "Buttered Toast", recipeIngredient: ["1 tbsp butter", "2 slices bread"] };
    await stub({ pages: { [URL1]: `<html><script type="application/ld+json">${JSON.stringify(ld)}</script><body>story</body></html>` }, recipe: "Sure!\n```cooklang\n" + cook("Buttered Toast", `source: ${URL1}\n`) + "```" });
    const r = await addRecipeWithGemini(UID, { source: "link", url: URL1 });
    expect(r).toMatchObject({ status: "imported", title: "Buttered Toast" });
    const recipe = (await db.doc(`recipes/${r.recipeId}`).get()).data()!;
    expect(recipe).toMatchObject({ title: "Buttered Toast", createdBy: UID, sourceUrl: URL1 });
    const req = stubGenerateRequests[0]!;
    expect(req.system).toContain("===== SKILL.md =====");
    expect(req.system).toContain(URL1);
    expect(JSON.stringify(req.contents)).toContain("Recipe data (schema.org JSON-LD)");
    const n = (await db.collection(`users/${UID}/notifications`).get()).docs.map((d) => d.data().message);
    expect(n.join(" ")).toContain('Imported "Buttered Toast" from recipes.example.com');
  });

  it("refuses private addresses, says when a page won't open or has no recipe", async () => {
    await stub({ pages: { [URL1]: "!403", "https://x.example.com/gone": "!404", "https://x.example.com/empty": "<p>hi</p>" }, recipe: cook("Nope") });
    await expect(addRecipeWithGemini(UID, { source: "link", url: "http://localhost/r" })).rejects.toMatchObject({ code: "invalid-argument", message: expect.stringMatching(/public site/) });
    await expect(addRecipeWithGemini(UID, { source: "link", url: URL1 })).rejects.toMatchObject({ message: expect.stringMatching(/doesn't let apps read its recipes \(HTTP 403\)\. Add a photo instead/) });
    await expect(addRecipeWithGemini(UID, { source: "link", url: "https://x.example.com/gone" })).rejects.toMatchObject({ message: "Couldn't open that page (HTTP 404)" });
    await expect(addRecipeWithGemini(UID, { source: "link", url: "https://x.example.com/empty" })).rejects.toMatchObject({ message: "That page has no recipe the app can read" });
    expect(stubGenerateRequests).toHaveLength(0);
  });

  it("a file that fails the checks goes back once with the reason; Gemini saying no recipe is reported", async () => {
    const page = `<html><body><p>${"Toast the bread and butter it while hot. ".repeat(10)}</p></body></html>`;
    await stub({ pages: { [URL1]: page }, recipe: ["```cooklang\n---\ntitle: Broken\n---\nToast.\n```", "```cooklang\n" + cook("Fixed Toast") + "```"] });
    const r = await addRecipeWithGemini(UID, { source: "link", url: URL1 });
    expect(r.title).toBe("Fixed Toast");
    expect(stubGenerateRequests).toHaveLength(2);
    expect(JSON.stringify(stubGenerateRequests[1]!.contents)).toMatch(/couldn't import that file: Front matter/);
    await stub({ pages: { [URL1]: page }, recipe: "NOT A RECIPE" });
    await expect(addRecipeWithGemini(UID, { source: "link", url: URL1 })).rejects.toMatchObject({ message: "Gemini found no recipe on that page" });
  });
});

describe("from a photo", () => {
  it("is sent inline, imported without the photo as its image, and deleted; other people's photos are refused", async () => {
    const path = `recipe-photos/${UID}/p1.jpg`;
    await bucket().file(path).save(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { contentType: "image/jpeg", resumable: false });
    await stub({ recipe: "```cooklang\n" + cook("Card Toast", "image: card.jpg\n") + "```" });
    const r = await addRecipeWithGemini(UID, { source: "photo", path });
    expect(r.title).toBe("Card Toast");
    expect((await db.doc(`recipes/${r.recipeId}`).get()).data()!.imagePaths).toEqual([]);
    const part = stubGenerateRequests[0]!.contents[0]!.parts[0] as { inlineData: { mimeType: string; data: string } };
    expect(part.inlineData.mimeType).toBe("image/jpeg");
    expect(part.inlineData.data).toBe(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64"));
    expect(await fileExists(path)).toBe(false);
    await expect(addRecipeWithGemini(UID, { source: "photo", path: "recipe-photos/someone/p.jpg" })).rejects.toMatchObject({ message: "That photo isn't yours" });
  });
});

describe("a photo with the recipe's text", () => {
  const png = () => readFileSync(join(ATTACHMENTS_DIR, "Pasted image 20240116181103.png"));
  it("the text goes with the photo; a dish photo becomes the recipe's picture, a photo of the recipe doesn't", async () => {
    const dishPath = `recipe-photos/${UID}/dish.png`;
    await bucket().file(dishPath).save(png(), { contentType: "image/png", resumable: false });
    await stub({ recipe: "PHOTO: dish\n```cooklang\n" + cook("Dish Toast") + "```" });
    const r = await addRecipeWithGemini(UID, { source: "photo", path: dishPath, text: "Buttered toast\r\n\r\n\r\n1 tbsp butter, 2 slices bread  " });
    expect(r.title).toBe("Dish Toast");
    expect((await db.doc(`recipes/${r.recipeId}`).get()).data()!.imagePaths).toHaveLength(1);
    expect(stubGenerateRequests[0]!.system).toContain("PHOTO: dish");
    expect(JSON.stringify(stubGenerateRequests[0]!.contents)).toContain("The recipe's text:\\nButtered toast\\n\\n1 tbsp butter, 2 slices bread");
    expect(await fileExists(dishPath)).toBe(false);

    const pagePath = `recipe-photos/${UID}/page.png`;
    await bucket().file(pagePath).save(png(), { contentType: "image/png", resumable: false });
    await stub({ recipe: "PHOTO: recipe\n```cooklang\n" + cook("Page Toast") + "```" });
    const p = await addRecipeWithGemini(UID, { source: "photo", path: pagePath, text: "Toast, butter." });
    expect((await db.doc(`recipes/${p.recipeId}`).get()).data()!.imagePaths).toEqual([]);
    await expect(addRecipeWithGemini(UID, { source: "photo", path: pagePath, text: 5 })).rejects.toMatchObject({ message: "Bad request" });
  });
});

describe("limits", () => {
  it("not set up: says so; and at most ADD_PER_HOUR an hour per person", async () => {
    await stub({ mode: "off" });
    await expect(addRecipeWithGemini(UID, { source: "link", url: URL1 })).rejects.toMatchObject({ message: expect.stringMatching(/Gemini isn't set up/) });
    await stub({ pages: { [URL1]: "!500" } });
    await db.doc(`aiRate/${UID}`).set({ windowStart: Date.now(), count: ADD_PER_HOUR });
    await expect(addRecipeWithGemini(UID, { source: "link", url: URL1 })).rejects.toMatchObject({ code: "resource-exhausted" });
  });
});
