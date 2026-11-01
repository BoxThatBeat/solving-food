// Ingredient names decided by an LLM (Planning/M15, PRD R4.27, R4.35, R4.36, R8.16, R4.16): an import asks Gemini
// (the functions' stub here, `_stubLlm/config`) about names the matcher can't place, before creating anything: one it
// places uses the existing ingredient and teaches it the wording; new and unsure ones are created and say so. The owner
// sets the Gemini key and runs Check names, which merges the waiting names Gemini is sure about (Supply moves); anyone
// can Copy for Claude and paste its answer. No review cards, banners or counts. Test runs share the stub doc, so each
// test merges in answers for its own unique names.
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
const word = () => `quandong${Math.random().toString(36).slice(2, 7)}`;

/** What the stub Gemini answers for these names (merged into the shared doc). */
async function geminiSays(answers: Record<string, string>) {
  await adminDb.doc("_stubLlm/config").set({ answers }, { merge: true });
}

/** A household-made ingredient waiting for a decision (flagged before M15, never checked). */
async function waitingIngredient(name: string): Promise<string> {
  const id = newIngredientId(name);
  await adminDb.doc(`ingredients/${id}`).set({
    name,
    aliases: [],
    category: "condiments",
    defaultLocation: "fridge",
    allowedMeasures: ["weight", "volume"],
    canonicalUnit: "g",
    densityGPerMl: 1.3,
    shelfLifeDays: { fridge: 180 },
    freezable: false,
    isStaple: false,
    freeUse: false,
    needsReview: true,
    createdBy: "e2e-importer",
  });
  return id;
}

test("an import asks Gemini first: a known ingredient is reused and learns the name; new and unsure names are created and say so", { tag: ["@R4.27", "@R4.16"] }, async ({ page, household: _ }) => {
  test.setTimeout(120_000);
  const w = word();
  const [same, fresh, unsure] = [`strawberry jam ${w}`, `${w} fruit`, `${w} dust`];
  await geminiSays({ [same]: "strawberry-jam", [fresh]: "new" });
  const title = uniqueTitle("Gemini Toast");
  const cook = ["---", `title: ${title}`, "servings: 2", "cuisine: other", "main_protein: none", "prep_time: 5 minutes", "cook_time: 5 minutes", "tags: [snack]", "---", `Spread @${same}{3%tbsp} with @${fresh}{2} and @${unsure}{1%tsp}.`, ""].join("\n");
  await dropFiles(page, [{ name: "gemini.cook", body: cook, mimeType: "text/plain" }]);

  const ok = statusBanner(page, `Imported "${title}"`);
  await expect(ok).toBeVisible({ timeout: 45_000 });
  await expect(ok).toContainText(`matched by Gemini: ${same} → strawberry jam`);
  await expect(ok).toContainText(`new ingredient: ${fresh}`);
  await expect(ok).toContainText(`not sure whether ${unsure}`);
  await expect(ok.getByRole("link", { name: "Review ingredients" })).toHaveCount(0);

  const recipe = (await adminDb.collection("recipes").where("title", "==", title).get()).docs[0]!.data();
  expect(recipe.ingredientIds).toContain("strawberry-jam");
  expect((await adminDb.doc(`ingredients/${newIngredientId(same)}`).get()).exists).toBe(false);
  expect((await adminDb.doc("ingredients/strawberry-jam").get()).data()!.aliases).toContain(same);
  expect((await adminDb.doc(`ingredients/${newIngredientId(fresh)}`).get()).data()).toMatchObject({ nameCheck: "new" });
  expect((await adminDb.doc(`ingredients/${newIngredientId(unsure)}`).get()).data()).toMatchObject({ nameCheck: "unsure" });

  // No review banner or counts anywhere; the unsure name is listed on the Ingredients page.
  await page.goto("/recipes");
  await expect(page.getByTestId("recipe-count")).toBeVisible();
  await expect(page.getByTestId("ingredient-review-banner")).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByTestId("review-count")).toHaveCount(0);
  await page.goto("/ingredients");
  await expect(page.getByRole("list", { name: "Names to decide" }).getByRole("link", { name: unsure })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Merge into…" })).toHaveCount(0);
});

test("Check with Gemini (owner only) merges what Gemini is sure about, moving Supply (R8.16)", { tag: ["@R8.16", "@R4.27"] }, async ({ page, household }) => {
  test.setTimeout(150_000);
  const name = `strawberry jam ${word()}`;
  const id = await waitingIngredient(name);
  await seedSupply(household.hid, id, [{ amount: 250, expiresInDays: 30 }], { label: name });
  await geminiSays({ [name]: "strawberry-jam" });

  // Not the owner: no Check with Gemini (the key lives in Settings → Gemini since M16).
  await page.goto("/ingredients");
  await expect(page.getByTestId("waiting-names")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ai-key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check with Gemini" })).toHaveCount(0);

  await adminDb.doc(`_stubPcx/${household.hid}`).set({ ownerUid: household.uid });
  await page.reload();
  await page.getByRole("button", { name: "Check with Gemini" }).click({ timeout: 20_000 });
  await expect(statusBanner(page, /Gemini checked \d+/)).toBeVisible({ timeout: 120_000 });
  await expect.poll(async () => (await adminDb.doc(`ingredients/${id}`).get()).data()?.mergedInto, { timeout: 30_000 }).toBe("strawberry-jam");
  expect((await supplyDoc(household.hid, "strawberry-jam"))?.canonicalAmount).toBe(250);
  const txs = await adminDb.collection(`households/${household.hid}/supply/strawberry-jam/transactions`).get();
  expect(txs.docs.reduce((s, d) => s + Number(d.data().delta), 0)).toBe(250);
  // The merged ingredient's page says where it went.
  await page.goto(`/ingredients/${id}`);
  await expect(page.getByRole("status").filter({ hasText: "Merged into" })).toContainText("strawberry jam");
});

test("Copy for Claude, then paste its answer: sure answers are merged or kept, the rest wait (R4.35)", { tag: ["@R4.35"] }, async ({ page, household: _ }) => {
  test.setTimeout(120_000);
  const w = word();
  const [dup, own] = [`strawberry jam ${w}`, `${w} leaf`];
  const dupId = await waitingIngredient(dup);
  const ownId = await waitingIngredient(own);
  await page.goto("/ingredients");
  const card = page.getByTestId("waiting-names");
  await expect(card.getByRole("link", { name: dup })).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole("button", { name: "Copy for Claude" })).toBeEnabled();
  await card.getByRole("button", { name: "Paste Claude's answer" }).click();
  const answer = `Here you go:\n\`\`\`json\n${JSON.stringify({ answers: [{ name: dup, verdict: "same", id: "strawberry-jam" }, { name: own, verdict: "new" }, { name: "something else", verdict: "same", id: "nope" }] })}\n\`\`\``;
  await card.getByLabel("Claude's answer").fill(answer);
  await expect(card.getByTestId("claude-plan")).toContainText(/Merge 1 · keep 1 as new/i);
  await expect(card).toContainText(`${dup} → strawberry jam`);
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(statusBanner(page, "1 merged, 1 kept as new")).toBeVisible({ timeout: 90_000 });
  expect((await adminDb.doc(`ingredients/${dupId}`).get()).data()).toMatchObject({ mergedInto: "strawberry-jam" });
  expect((await adminDb.doc(`ingredients/${ownId}`).get()).data()).toMatchObject({ nameCheck: "new" });
  await expect(card.getByRole("link", { name: own })).toHaveCount(0);
});

test("the More sheet links to Ingredients on phones", { tag: ["@R4.27"] }, async ({ page, household: _ }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "phones only: wider screens reach it from Settings");
  await page.goto("/plan");
  await page.getByRole("button", { name: "More pages" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: /Ingredients/ }).click();
  await expect(page).toHaveURL(/\/ingredients/);
  await expect(page.getByRole("heading", { name: "Ingredients", level: 1 })).toBeVisible();
});
