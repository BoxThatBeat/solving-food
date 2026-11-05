// From a receipt (PRD R7.15–R7.17; TECHNICAL_SPECS §8 "From a receipt", §9 Gemini; Planning/M25): a photo of a till
// receipt, or an order confirmation (a screenshot, or the email's text pasted), is read by Gemini into lines with a JSON
// response schema, and each line is matched to the ordered list's lines (`matchReceipt`, packages/core/src/receipt.ts)
// so the confirm sheet can be prefilled. Nothing is written: no Supply, no list, no upload. The photo comes inline in the
// call (downscaled by the browser), lives only in this function's memory, and goes to Gemini once. Allowlisted members
// of the household; the owner's Gemini key; RECEIPTS_PER_HOUR per person (`receiptRate/{uid}`). Logs counts only.
import { logger } from "firebase-functions";
import { matchReceipt, readReceipt, receiptGenerationConfig, receiptInstruction, RECEIPT_MAX_IMAGE_BYTES, RECEIPT_MAX_TEXT, RECEIPTS_PER_HOUR, type MatchedLine, type OrderedLine } from "@solving-food/core";
import { db } from "../admin";
import { ingredientData } from "../dropFolder";
import { CallError, rateLimit, requireMember } from "../pcx";
import { AI_NOT_SET_UP, AiError, geminiJson, geminiReady, type GeminiPart } from "./gemini";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ID = /^(?!\.\.?$)[^/]{1,200}$/;

type ReadInput = { hid: string; listId: string } & ({ image: { mimeType: string; data: string } } | { text: string });

function parseInput(data: unknown): ReadInput {
  const d = (data ?? {}) as { hid?: unknown; listId?: unknown; image?: { mimeType?: unknown; data?: unknown }; text?: unknown };
  if (typeof d.hid !== "string" || !ID.test(d.hid) || typeof d.listId !== "string" || !ID.test(d.listId)) throw new CallError("invalid-argument", "Bad request");
  const base = { hid: d.hid, listId: d.listId };
  if (d.image && typeof d.image === "object") {
    const { mimeType, data: b64 } = d.image;
    if (typeof mimeType !== "string" || !IMAGE_TYPES.has(mimeType) || typeof b64 !== "string" || !b64.length) throw new CallError("invalid-argument", "That isn't a photo the app can read (JPEG, PNG, WebP, HEIC)");
    // base64 is 4 characters per 3 bytes.
    if (b64.length > Math.ceil(RECEIPT_MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new CallError("invalid-argument", "That photo is too large");
    return { ...base, image: { mimeType, data: b64 } };
  }
  if (typeof d.text === "string") {
    // eslint-disable-next-line no-control-regex
    const text = d.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, RECEIPT_MAX_TEXT);
    if (text.length < 10) throw new CallError("invalid-argument", "Paste the order confirmation's text first");
    return { ...base, text };
  }
  throw new CallError("invalid-argument", "Bad request");
}

export interface ReadReceiptResult {
  store: string | null;
  date: string | null;
  totalCents: number | null;
  lines: MatchedLine[];
  /** Ordered lines nothing on the receipt says arrived. */
  missing: string[];
}

export async function readReceiptCall(uid: string, data: unknown): Promise<ReadReceiptResult> {
  const req = parseInput(data);
  await requireMember(uid, req.hid);
  const list = await db.doc(`households/${req.hid}/groceryLists/${req.listId}`).get();
  if (!list.exists) throw new CallError("invalid-argument", "That order is gone");
  if (list.data()!.status !== "ordered") throw new CallError("invalid-argument", "That order has already been confirmed");
  if (!(await geminiReady(uid))) throw new CallError("invalid-argument", AI_NOT_SET_UP);
  await rateLimit(uid, Date.now(), { collection: "receiptRate", limit: RECEIPTS_PER_HOUR, message: `That's ${RECEIPTS_PER_HOUR} receipts with Gemini this hour; try again later` });

  const items = (list.data()!.items ?? {}) as Record<string, { productName?: string; ingredientId?: string; packLabel?: string; packs?: number }>;
  const ordered: OrderedLine[] = Object.entries(items).map(([itemId, it]) => ({ itemId, productName: String(it.productName ?? itemId), ingredientId: it.ingredientId ?? null, packLabel: it.packLabel ?? null, packs: Number(it.packs ?? 1) }));
  const parts: GeminiPart[] =
    "image" in req
      ? [{ inlineData: { mimeType: req.image.mimeType, data: req.image.data } }, { text: "List what this receipt or order confirmation says was bought." }]
      : [{ text: `The order confirmation's text:\n${req.text}` }];

  let answer: string;
  try {
    answer = await geminiJson(uid, receiptInstruction(ordered), [{ role: "user", parts }], receiptGenerationConfig());
  } catch (e) {
    if (e instanceof AiError) throw new CallError("invalid-argument", e.message);
    throw e;
  }
  const receipt = readReceipt(answer);
  if (!receipt) throw new CallError("invalid-argument", "Gemini's answer couldn't be read; try again");
  if (!receipt.lines.length) throw new CallError("invalid-argument", "image" in req ? "Gemini found no receipt or order in that photo" : "Gemini found no order in that text");

  const { index } = await ingredientData();
  const m = matchReceipt(receipt, ordered, index);
  // Counts only: never the receipt's lines, store or prices.
  logger.info("receipt read", {
    uid,
    source: "image" in req ? "photo" : "text",
    lines: m.lines.length,
    matched: m.lines.filter((l) => l.itemId).length,
    notOnList: m.lines.filter((l) => !l.itemId && !l.notAvailable).length,
    missing: m.missing.length,
    ordered: ordered.length,
  });
  return { store: receipt.store, date: receipt.date, totalCents: receipt.totalCents, lines: m.lines, missing: m.missing };
}
