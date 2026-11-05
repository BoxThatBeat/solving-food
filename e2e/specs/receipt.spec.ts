// receipt.spec.ts (Planning/M25): From a receipt on the confirm sheet. Gemini is the functions' stub
// (`_stubLlm/{uid}.receipt`, a canned answer): an order email's text or a receipt photo is read (R7.15), its lines
// prefill the sheet: a matched line's packs and price, a substitution, a line that didn't come, and a line that wasn't
// on the list, each marked "from receipt" and editable, nothing written until Confirm (R7.16); Confirm stores the paid
// prices and History's spend says "actual" (R7.17).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { seedPeriod } from "../pages/plan";
import { commandsSettled, expectSupply, groceryLine, seedOrderedList, supplyDoc } from "../pages/supply";

const RECEIPT = {
  store: "PC Express",
  date: "2026-11-04",
  total: 33.97,
  lines: [
    { description: "PC Organics Baby Spinach 312 g", name: "baby spinach", quantity: 2, packSize: "312 g", unitPrice: 4.99, lineTotal: 9.98, listLine: "L1" },
    { description: "PC Basmati Rice 8 kg", name: "basmati rice", quantity: 1, packSize: "8 kg", lineTotal: 21.99, substitutedFor: "Jasmine rice 8 kg" },
    { description: "Krinos Greek Feta 200 g", notAvailable: true },
    { description: "Bananas", name: "bananas", quantity: 1, packSize: "1.2 kg", lineTotal: 2.0 },
  ],
};

async function seedOrder(hid: string) {
  const pid = await seedPeriod(hid);
  return seedOrderedList(hid, pid, {
    "baby-spinach": groceryLine({ ingredientId: "baby-spinach", amount: 312, packAmount: 312, packLabel: "312 g", productName: "Organic baby spinach", storeId: "pc-express", estPriceCents: 499 }),
    "feta-cheese": groceryLine({ ingredientId: "feta-cheese", amount: 200, packAmount: 200, packLabel: "200 g", productName: "Krinos Greek feta", storeId: "pc-express", estPriceCents: 599 }),
    "jasmine-rice": groceryLine({ ingredientId: "jasmine-rice", amount: 8000, packAmount: 8000, packLabel: "8 kg", productName: "Jasmine rice", storeId: "pc-express", estPriceCents: 1999 }),
  });
}

async function openReceiptStep(page: Page) {
  await page.goto("/grocery");
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("button", { name: /Groceries arrived\? Confirm/ }).click();
  const sheet = page.getByRole("dialog", { name: "Confirm groceries" });
  await expect(sheet.getByTestId("receive-line")).toHaveCount(3);
  await sheet.getByRole("button", { name: /From a receipt/ }).click();
  const step = page.getByRole("dialog", { name: "From a receipt" });
  await expect(step.getByTestId("receipt-step")).toBeVisible();
  return step;
}

const line = (page: Page, item: string) => page.getByRole("dialog", { name: "Confirm groceries" }).locator(`[data-testid="receive-line"][data-item="${item}"]`);

test("an order email's text prefills the confirm sheet, marked and editable; Confirm adds it with the paid prices (R7.15, R7.16, R7.17)", { tag: ["@R7.15", "@R7.16", "@R7.17"] }, async ({ page, household }) => {
  test.setTimeout(120_000);
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ receipt: RECEIPT });
  const listId = await seedOrder(household.hid);
  const step = await openReceiptStep(page);
  await expect(step.getByLabel("Upload a photo of the receipt")).toHaveAttribute("accept", "image/*");
  await expect(step.getByLabel("Take a photo of the receipt")).toHaveAttribute("capture", "environment");
  await step.getByLabel("Or paste the order email").fill("Your PC Express order is ready. PC Organics Baby Spinach 312 g x2 $9.98 …");
  await step.getByRole("button", { name: "Read it" }).click();

  const sheet = page.getByRole("dialog", { name: "Confirm groceries" });
  await expect(sheet.getByTestId("receipt-summary")).toContainText("2 matched", { timeout: 30_000 });
  await expect(sheet.getByTestId("receipt-summary")).toContainText("1 didn't come · 1 not on the list");
  await expect(sheet.getByTestId("receipt-summary")).toContainText("total $33.97");

  // Matched: two bags, $9.98, marked.
  const spinach = line(page, "baby-spinach");
  await expect(spinach.getByRole("group", { name: "Packs of Organic baby spinach" }).locator("output")).toHaveText("2");
  await expect(spinach).toContainText("620 g"); // 624 g, shown rounded
  await expect(spinach.getByLabel("Paid for Organic baby spinach")).toHaveValue("9.98");
  await expect(spinach.getByTestId("from-receipt")).toHaveText(/packs · price/i);
  // The substitution.
  const rice = line(page, "jasmine-rice");
  await expect(rice).toContainText("Basmati rice");
  await expect(rice).toContainText(/instead of Jasmine rice/i);
  await expect(rice.getByTestId("from-receipt")).toContainText(/substitution/i);
  // Didn't come.
  const feta = line(page, "feta-cheese");
  await expect(feta.getByRole("button", { name: "Krinos Greek feta didn't come" })).toHaveAttribute("aria-pressed", "true");
  await expect(feta.getByTestId("from-receipt")).toContainText(/didn't come/i);
  // Not on the list: ignored until chosen.
  const extra = sheet.getByTestId("receipt-extra");
  await expect(extra).toHaveCount(1);
  await expect(extra).toContainText("Bananas");
  await expect(extra).toContainText(/banana · 1\.2 kg · \$2\.00/i);
  await expect(extra.getByRole("button", { name: "Add Bananas to Supply" })).toHaveAttribute("aria-pressed", "false");
  await extra.getByRole("button", { name: "Add Bananas to Supply" }).click();
  await expect(extra.getByRole("button", { name: "Add Bananas to Supply" })).toHaveAttribute("aria-pressed", "true");

  // Editable: a corrected price drops its mark.
  await rice.getByLabel("Paid for Jasmine rice").fill("20.99");
  await rice.getByLabel("Paid for Jasmine rice").blur();
  await expect(rice.getByTestId("from-receipt")).not.toContainText(/price/i);

  // Nothing written before Confirm.
  expect((await adminDb.collection(`households/${household.hid}/commands`).get()).size).toBe(0);
  expect((await adminDb.doc(`households/${household.hid}/groceryLists/${listId}`).get()).data()!.status).toBe("ordered");

  await sheet.getByRole("button", { name: "Confirm with changes" }).click();
  await expect(page.getByTestId("notifications")).toContainText(/Supply updated · 3 items added/);
  expect(await commandsSettled(household.hid)).toEqual([]);
  await expectSupply(household.hid, "baby-spinach", 624);
  await expectSupply(household.hid, "basmati-rice", 8000);
  await expectSupply(household.hid, "banana", 1200);
  expect(await supplyDoc(household.hid, "feta-cheese")).toBeUndefined();
  expect(await supplyDoc(household.hid, "jasmine-rice")).toBeUndefined();
  const list = (await adminDb.doc(`households/${household.hid}/groceryLists/${listId}`).get()).data()!;
  expect(list.status).toBe("received");
  expect(list.items["baby-spinach"].paidCents).toBe(998);
  expect(list.items["jasmine-rice"].paidCents).toBe(2099);
  expect(list.items["feta-cheese"].paidCents).toBeUndefined();
  expect(Object.values(list.receiptExtras as Record<string, { name: string; paidCents: number }>)).toEqual([expect.objectContaining({ name: "Bananas", ingredientId: "banana", receivedAmount: 1200, paidCents: 200 })]);
  expect(list.paidCents).toBe(998 + 2099 + 200);
  expect(list.paidComplete).toBe(true);
  expect(list.receiptTotalCents).toBe(3397);

  // History's spend uses what was paid and says so.
  await page.goto("/history");
  const spend = page.getByTestId("stat-spend");
  await expect(spend).toContainText("$32.97");
  await expect(spend.getByTestId("spend-value")).toContainText(/actual/i);
});

test("a receipt photo is read the same way; Back keeps the sheet as it was; Gemini not set up says where (R7.15)", { tag: ["@R7.15"] }, async ({ page, household }) => {
  test.setTimeout(120_000);
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ receipt: RECEIPT });
  await seedOrder(household.hid);
  let step = await openReceiptStep(page);
  await step.getByRole("button", { name: "Back to the list" }).click();
  const sheet = page.getByRole("dialog", { name: "Confirm groceries" });
  await expect(sheet.getByTestId("receipt-summary")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Everything arrived · add to supply" })).toBeVisible();

  await sheet.getByRole("button", { name: /From a receipt/ }).click();
  step = page.getByRole("dialog", { name: "From a receipt" });
  const png = readFileSync(fileURLToPath(new URL("../../data/recipes/obsidian/attachments/Pasted image 20240116181103.png", import.meta.url)));
  await step.getByLabel("Upload a photo of the receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await expect(sheet.getByTestId("receipt-summary")).toContainText("2 matched · 1 didn't come · 1 not on the list", { timeout: 30_000 });
  await expect(line(page, "feta-cheese").getByRole("button", { name: "Krinos Greek feta didn't come" })).toBeVisible();
  // Changing it by hand: the mark goes.
  await line(page, "feta-cheese").getByRole("button", { name: "Krinos Greek feta didn't come" }).click();
  await expect(line(page, "feta-cheese").getByTestId("from-receipt")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await adminDb.doc(`_stubLlm/${household.uid}`).set({ mode: "off" });
  step = await openReceiptStep(page);
  await expect(step).toContainText("Gemini isn't set up yet", { timeout: 20_000 });
  await expect(step.getByRole("link", { name: "Settings → Gemini" })).toBeVisible();
  await expect(step.getByLabel("Or paste the order email")).toBeDisabled();
});
