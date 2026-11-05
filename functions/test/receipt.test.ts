// From a receipt against the Gemini stub (M25, R7.15, R7.16): a photo (inline, never stored) or pasted text goes to
// Gemini with the ordered lines in the instruction; the answer is normalised and matched (product name, ingredient,
// Gemini's line), unlisted ordered lines come back missing; nothing is written; members only, a list still ordered,
// not set up, bad input and the hourly limit.
process.env.PCX_STUB = "1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RECEIPTS_PER_HOUR } from "@solving-food/core";
import { bucket, clearFirestore, db, seedIngredients } from "./helpers";
import { readReceiptCall } from "../src/ai/receipt";
import { stubGenerateRequests } from "../src/ai/gemini";
import { resetIngredientCache } from "../src/dropFolder";

const UID = "receipt-reader";
const HID = "hh-receipt";

const RECEIPT = {
  store: "PC Express",
  date: "2026-11-04",
  total: 39.97,
  lines: [
    { description: "PC Organics Baby Spinach 312 g", name: "baby spinach", quantity: 2, packSize: "312 g", unitPrice: 4.99, lineTotal: 9.98 },
    { description: "Basmati Rice 8 kg", name: "basmati rice", packSize: "8 kg", lineTotal: 21.99, substitutedFor: "Jasmine rice" },
    { description: "Krinos Greek Feta 200 g", notAvailable: true },
    { description: "Bananas", name: "bananas", quantity: 1, packSize: "1.2 kg", lineTotal: 2.0 },
  ],
};

async function seedList(status = "ordered") {
  await db.doc(`households/${HID}/groceryLists/ord1`).set({
    periodId: "2026-11-02",
    status,
    createdAt: new Date(),
    items: {
      "baby-spinach": { ingredientId: "baby-spinach", amount: 312, measure: "g", packAmount: 312, packLabel: "312 g", packs: 1, productName: "Organic baby spinach", storeId: "pc-express", estPriceCents: 499, source: "plan", checked: false },
      "feta-cheese": { ingredientId: "feta-cheese", amount: 200, measure: "g", packAmount: 200, packLabel: "200 g", packs: 1, productName: "Krinos Greek feta", storeId: "pc-express", estPriceCents: 599, source: "plan", checked: false },
      "jasmine-rice": { ingredientId: "jasmine-rice", amount: 8000, measure: "g", packAmount: 8000, packLabel: "8 kg", packs: 1, productName: "Jasmine rice", storeId: "pc-express", estPriceCents: 1999, source: "plan", checked: false },
      "chicken-thigh": { ingredientId: "chicken-thigh", amount: 1000, measure: "g", packAmount: 1000, packLabel: "1 kg", packs: 1, productName: "Chicken thighs", storeId: "pc-express", estPriceCents: 1299, source: "plan", checked: false },
    },
  });
}

beforeAll(async () => {
  await clearFirestore();
  await seedIngredients();
});

beforeEach(async () => {
  resetIngredientCache();
  stubGenerateRequests.length = 0;
  await db.doc(`receiptRate/${UID}`).delete();
  await db.doc(`households/${HID}/members/${UID}`).set({ uid: UID, displayName: "R", joinedAt: new Date() });
  await db.doc(`_stubLlm/${UID}`).set({ receipt: RECEIPT });
  await seedList();
});

describe("readReceipt", () => {
  it("a photo: inline to Gemini with the ordered lines, matched and normalised; nothing written or stored", async () => {
    const before = (await db.collection(`households/${HID}/commands`).get()).size;
    const [filesBefore] = await bucket().getFiles();
    const r = await readReceiptCall(UID, { hid: HID, listId: "ord1", image: { mimeType: "image/jpeg", data: Buffer.from("not really a jpeg").toString("base64") } });
    const req = stubGenerateRequests[0]!;
    expect(req.system).toContain("L1: Organic baby spinach, 312 g × 1");
    expect(req.contents[0]!.parts[0]).toMatchObject({ inlineData: { mimeType: "image/jpeg" } });
    expect(r).toMatchObject({ store: "PC Express", date: "2026-11-04", totalCents: 3997 });
    expect(r.lines.map((l) => [l.description, l.itemId, l.ingredientId, l.lineTotalCents])).toEqual([
      ["PC Organics Baby Spinach 312 g", "baby-spinach", "baby-spinach", 998],
      ["Basmati Rice 8 kg", "jasmine-rice", "basmati-rice", 2199],
      ["Krinos Greek Feta 200 g", "feta-cheese", null, null],
      ["Bananas", null, "banana", 200],
    ]);
    expect(r.missing.sort()).toEqual(["chicken-thigh", "feta-cheese"]);
    expect((await db.collection(`households/${HID}/commands`).get()).size).toBe(before);
    expect((await db.doc(`households/${HID}/groceryLists/ord1`).get()).data()!.status).toBe("ordered");
    const [filesAfter] = await bucket().getFiles();
    expect(filesAfter.length).toBe(filesBefore.length);
  });

  it("pasted text goes as text", async () => {
    const r = await readReceiptCall(UID, { hid: HID, listId: "ord1", text: "Your order is on its way!\nPC Organics Baby Spinach 312 g x2 $9.98" });
    expect(JSON.stringify(stubGenerateRequests[0]!.contents)).toContain("The order confirmation's text:\\nYour order is on its way!");
    expect(r.lines).toHaveLength(4);
  });

  it("refuses outsiders, received lists, bad input, an empty answer, not set up, and past the hourly limit", async () => {
    const photo = { mimeType: "image/png", data: "aGVsbG8=" };
    await expect(readReceiptCall("someone-else", { hid: HID, listId: "ord1", image: photo })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", image: { mimeType: "image/gif", data: "aGVsbG8=" } })).rejects.toMatchObject({ message: expect.stringMatching(/isn't a photo/) });
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", image: { mimeType: "image/png", data: "a".repeat(6_000_000) } })).rejects.toMatchObject({ message: "That photo is too large" });
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", text: "hi" })).rejects.toMatchObject({ message: expect.stringMatching(/Paste/) });
    await expect(readReceiptCall(UID, { hid: HID, listId: "../x", text: "hello there friend" })).rejects.toMatchObject({ message: "Bad request" });
    await db.doc(`_stubLlm/${UID}`).set({ receipt: { lines: [] } });
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", image: photo })).rejects.toMatchObject({ message: "Gemini found no receipt or order in that photo" });
    await db.doc(`_stubLlm/${UID}`).set({ mode: "off" });
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", image: photo })).rejects.toMatchObject({ message: expect.stringMatching(/Gemini isn't set up/) });
    await db.doc(`_stubLlm/${UID}`).set({ receipt: RECEIPT });
    await seedList("received");
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", image: photo })).rejects.toMatchObject({ message: "That order has already been confirmed" });
    await seedList();
    await db.doc(`receiptRate/${UID}`).set({ windowStart: Date.now(), count: RECEIPTS_PER_HOUR });
    await expect(readReceiptCall(UID, { hid: HID, listId: "ord1", image: photo })).rejects.toMatchObject({ code: "resource-exhausted" });
  });
});
