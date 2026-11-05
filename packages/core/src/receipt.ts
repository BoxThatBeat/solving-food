// From a receipt (PRD R7.15–R7.17; TECHNICAL_SPECS §8 "From a receipt"; Planning/M25-receipt-import.md). A photo of a
// till receipt, or an online order confirmation (a screenshot or the email's text), is read by Gemini into lines with a
// JSON response schema; this module holds the pure parts: the instruction and schema, normalising the answer, matching
// each receipt line to the ordered list's lines (the product name first, then the ingredient matcher, then Gemini's
// own guess), and what arrived on a matched line (packs, an exact weight, the price paid). Nothing here touches Supply:
// the confirm sheet is prefilled and the person's Confirm sends the usual receiveGroceries command.

import { matchIngredient, type IngredientIndex } from "./ingredientMatch";
import { normalizeName } from "./names";
import { packToCanonical } from "./pricing";
import type { Measure } from "./taxonomy";
import { parseUnit, toCanonical, type ConvertibleIngredient } from "./units";

/** Lines kept from one receipt (a big Costco run is ~60). */
export const RECEIPT_MAX_LINES = 150;
/** Pasted order-confirmation text, characters. */
export const RECEIPT_MAX_TEXT = 30_000;
/** A downscaled photo sent inline, bytes (the app sends ~0.3–1 MB JPEGs; the cap is for anything else). */
export const RECEIPT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Receipts read per person per hour (`receiptRate/{uid}`). */
export const RECEIPTS_PER_HOUR = 10;

export interface ReceiptLine {
  /** The product as printed. */
  description: string;
  /** The plain food it is ("chicken thighs"), from Gemini; null when it couldn't tell or it isn't food. */
  name: string | null;
  /** Units bought (1 when not printed); 0 for a line that didn't come. */
  quantity: number;
  /** One unit's size as printed ("400 g", "4 L", "12 ct"), or the weight of something sold by weight ("1.234 kg"). */
  packSize: string | null;
  unitPriceCents: number | null;
  /** What the line cost after any discount folded into it. */
  lineTotalCents: number | null;
  /** The ordered item this one replaced (an order confirmation's substitution). */
  substitutedFor: string | null;
  /** Ordered but out of stock, unavailable or refunded. */
  notAvailable: boolean;
  /** Gemini's guess at the ordered line ("L3"), checked against the list before it's used. */
  listLine: string | null;
}

export interface Receipt {
  store: string | null;
  /** YYYY-MM-DD as printed. */
  date: string | null;
  totalCents: number | null;
  lines: ReceiptLine[];
}

/** An ordered list's line as the prompt and the matcher see it. */
export interface OrderedLine {
  itemId: string;
  productName: string;
  ingredientId?: string | null | undefined;
  packLabel?: string | null | undefined;
  packs: number;
}

/** "L1", "L2"…: short keys for the ordered lines in the prompt (item IDs are ingredient IDs; these are shorter). */
export const listLineKey = (i: number) => `L${i + 1}`;

/** The instruction (system prompt): what to read and how, then the ordered lines Gemini may point at. */
export function receiptInstruction(ordered: readonly OrderedLine[]): string {
  const lines = ordered.map((l, i) => `${listLineKey(i)}: ${l.productName}${l.packLabel && !l.productName.includes(l.packLabel) ? `, ${l.packLabel}` : ""} × ${l.packs || 1}`);
  return [
    "You read a grocery store's till receipt or an online grocery order confirmation (a photo, a screenshot, or the email's text) and list what it says was bought, as JSON.",
    "Rules:",
    "- One entry per product line. Leave out subtotals, taxes, payments, change, deposits, bag fees, loyalty points, and the store's address and phone lines.",
    "- description: the product as printed. name: the plain food it is, in a few lowercase words with no brand and no size (\"chicken thighs\", \"baby spinach\", \"basmati rice\"); leave it out when it isn't food.",
    "- quantity: how many units were bought (1 when not printed). Something sold by weight is quantity 1 with its weight as packSize (\"1.234 kg\").",
    "- packSize: the size of one unit when printed (\"400 g\", \"4 L\", \"12 ct\"); leave it out otherwise.",
    "- unitPrice and lineTotal: dollars as numbers (4.99). Fold an instant saving, coupon or discount line into the line it applies to, so lineTotal is what that line really cost.",
    "- substitutedFor: when the confirmation says this item replaced an ordered one, the ordered item's name.",
    "- notAvailable: true for an ordered item the confirmation says was out of stock, unavailable, not delivered or refunded (quantity 0).",
    "- listLine: the ordered line below (L1, L2…) this entry is, when it clearly is one; for a substitution, the line it replaced. Leave it out otherwise.",
    "- store, date (YYYY-MM-DD) and total (dollars, what was paid in the end) when printed.",
    "- If it isn't a receipt or an order confirmation, answer {\"lines\": []}.",
    "",
    "The ordered lines:",
    ...(lines.length ? lines : ["(none)"]),
  ].join("\n");
}

/** Gemini's generationConfig for a receipt: JSON with this schema, temperature 0. */
export function receiptGenerationConfig() {
  return {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        store: { type: "STRING" },
        date: { type: "STRING" },
        total: { type: "NUMBER" },
        lines: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              description: { type: "STRING" },
              name: { type: "STRING" },
              quantity: { type: "NUMBER" },
              packSize: { type: "STRING" },
              unitPrice: { type: "NUMBER" },
              lineTotal: { type: "NUMBER" },
              substitutedFor: { type: "STRING" },
              notAvailable: { type: "BOOLEAN" },
              listLine: { type: "STRING" },
            },
            required: ["description"],
          },
        },
      },
      required: ["lines"],
    },
  };
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};

/** Dollars (a number, or "$4.99", "4,99", "-3.00") → cents; null when it isn't an amount. */
export function dollarsToCents(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const t = v.replace(/[$\s]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
    n = /^-?\d+(\.\d+)?-?$/.test(t) ? (t.endsWith("-") ? -Number(t.slice(0, -1)) : Number(t)) : NaN;
  } else return null;
  if (!Number.isFinite(n) || Math.abs(n) > 100_000) return null;
  return Math.round(n * 100);
}

/** The answer's JSON: an object, or text with the JSON in it (a ```json fence is fine). */
function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o: unknown = JSON.parse(t.slice(start, end + 1));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Gemini's answer, normalised: strings trimmed, dollars to cents, a missing line total from unit price × quantity, a
 * quantity of 1 when none is given, a bare discount line (negative, no food name) folded into the line before it,
 * lines past RECEIPT_MAX_LINES dropped. Null when the answer isn't JSON with a `lines` list.
 */
export function readReceipt(value: unknown): Receipt | null {
  const o = asObject(value);
  if (!o || !Array.isArray(o.lines)) return null;
  const lines: ReceiptLine[] = [];
  for (const raw of o.lines) {
    if (lines.length >= RECEIPT_MAX_LINES) break;
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name, 80);
    const description = str(r.description, 200) ?? name;
    if (!description) continue;
    const notAvailable = r.notAvailable === true;
    const q = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? Math.min(999, Math.max(0, r.quantity)) : typeof r.quantity === "string" && Number.isFinite(Number(r.quantity)) ? Math.min(999, Math.max(0, Number(r.quantity))) : 1;
    const quantity = notAvailable ? 0 : q;
    const unitPriceCents = dollarsToCents(r.unitPrice);
    let lineTotalCents = dollarsToCents(r.lineTotal);
    if (lineTotalCents === null && unitPriceCents !== null && quantity > 0) lineTotalCents = Math.round(unitPriceCents * quantity);
    // A discount printed as its own line ("TPD/1234 3.00-"): it belongs to the line above.
    if (lineTotalCents !== null && lineTotalCents < 0 && !name) {
      const prev = lines[lines.length - 1];
      if (prev && prev.lineTotalCents !== null) prev.lineTotalCents = Math.max(0, prev.lineTotalCents + lineTotalCents);
      continue;
    }
    const listLine = str(r.listLine, 8);
    lines.push({
      description,
      name,
      quantity,
      packSize: str(r.packSize, 40),
      unitPriceCents: unitPriceCents !== null && unitPriceCents >= 0 ? unitPriceCents : null,
      lineTotalCents: lineTotalCents !== null ? Math.max(0, lineTotalCents) : null,
      substitutedFor: str(r.substitutedFor, 200),
      notAvailable,
      listLine: listLine && /^L\d{1,3}$/i.test(listLine) ? listLine.toUpperCase() : null,
    });
  }
  const date = str(o.date, 10);
  const total = dollarsToCents(o.total);
  return { store: str(o.store, 80), date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, totalCents: total !== null && total >= 0 ? total : null, lines };
}

// ---------- matching

export type MatchHow = "product" | "ingredient" | "gemini";

export interface MatchedLine extends ReceiptLine {
  /** The ordered line it is (for a substitution, the one it replaced); null = not on the list. */
  itemId: string | null;
  how: MatchHow | null;
  /** The ingredient the receipt line itself is (the substitute, for a substitution), when the matcher knows it. */
  ingredientId: string | null;
}

export interface ReceiptMatch {
  lines: MatchedLine[];
  /** Ordered lines nothing on the receipt says arrived: prefilled as "didn't come". */
  missing: string[];
}

const words = (s: string) => new Set(normalizeName(s).split(" ").filter((w) => w.length > 1 && !/^\d/.test(w)));

/**
 * How well a receipt's wording names a product (0..1): every word of the shorter in the longer (at least two words, or
 * one word that is the whole of both) is 1; otherwise the shared share of words (Jaccard).
 */
export function productScore(product: string, text: string): number {
  const a = words(product);
  const b = words(text);
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const shared = [...small].filter((w) => big.has(w)).length;
  if (shared === small.size && (small.size >= 2 || big.size === 1)) return 1;
  return shared / (a.size + b.size - shared);
}

const PRODUCT_MIN = 0.6;

function ingredientOf(texts: ReadonlyArray<string | null>, index: IngredientIndex): string | null {
  for (const t of texts) {
    if (!t) continue;
    const m = matchIngredient(t, index);
    if (m.id) return m.id;
  }
  return null;
}

/**
 * Each receipt line's ordered line: the brand mapping's product name on the list (a close wording match), then the
 * ingredient the matcher finds in its words (the list line for that ingredient), then Gemini's `listLine` if it names a
 * real line. A substitution is matched by what it replaced. Lines nothing matches are "not on the list". Ordered lines
 * no arriving receipt line covers are `missing`.
 */
export function matchReceipt(receipt: Receipt, ordered: readonly OrderedLine[], index: IngredientIndex): ReceiptMatch {
  const byKey = new Map(ordered.map((l, i) => [listLineKey(i), l]));
  const used = new Map<string, number>();
  const pick = (cands: OrderedLine[]) => [...cands].sort((x, y) => (used.get(x.itemId) ?? 0) - (used.get(y.itemId) ?? 0))[0];
  const lines = receipt.lines.map((r): MatchedLine => {
    const own = ingredientOf([r.name, r.description], index);
    const target = r.substitutedFor ? [r.substitutedFor] : [r.description, r.name];
    let hit: OrderedLine | undefined;
    let how: MatchHow | null = null;
    // 1. The product name on the list (the brand mapping's, or the ingredient's own).
    let best = 0;
    let bestLines: OrderedLine[] = [];
    for (const l of ordered) {
      const s = Math.max(...target.map((t) => (t ? productScore(l.productName, t) : 0)));
      if (s >= PRODUCT_MIN && s > best) {
        best = s;
        bestLines = [l];
      } else if (s >= PRODUCT_MIN && s === best) bestLines.push(l);
    }
    if (bestLines.length) {
      hit = pick(bestLines);
      how = "product";
    }
    // 2. The ingredient behind the wording.
    if (!hit) {
      const want = r.substitutedFor ? ingredientOf([r.substitutedFor], index) : own;
      const cands = want ? ordered.filter((l) => l.ingredientId === want) : [];
      if (cands.length) {
        hit = pick(cands);
        how = "ingredient";
      }
    }
    // 3. Gemini's guess, when it names a line.
    if (!hit && r.listLine && byKey.has(r.listLine)) {
      hit = byKey.get(r.listLine);
      how = "gemini";
    }
    if (hit) used.set(hit.itemId, (used.get(hit.itemId) ?? 0) + 1);
    return { ...r, itemId: hit?.itemId ?? null, how, ingredientId: own };
  });
  const arrived = new Set(lines.filter((l) => l.itemId && !l.notAvailable && l.quantity > 0).map((l) => l.itemId!));
  return { lines, missing: ordered.filter((l) => !arrived.has(l.itemId)).map((l) => l.itemId) };
}

// ---------- what arrived

/**
 * A printed size in the ingredient's canonical unit: "400 g", "1.234 kg", "4 L", "6 x 355 ml", "12 ct". Null when it
 * can't be read or converted (a volume without a density).
 */
export function packSizeToCanonical(text: string | null | undefined, ing: ConvertibleIngredient): number | null {
  if (!text) return null;
  const m = /^\s*(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zA-Z][a-zA-Z .]*?)\.?\s*$/.exec(text);
  if (!m) return null;
  const times = m[1] ? Number(m[1]) : 1;
  const amount = Number(m[2]!.replace(",", ".")) * times;
  const unit = m[3]!.trim().toLowerCase();
  const measure = /^(ct|pk|pc|pcs|each|ea|count|un)$/.test(unit) ? "count" : parseUnit(unit).measure;
  const r = toCanonical(amount, measure, ing);
  return r.ok && r.canonicalAmount > 0 ? r.canonicalAmount : null;
}

/** An ordered line's shape for `receiptArrival`. */
export interface ArrivalItem {
  /** Canonical amount per pack; null when the raw amount was listed. */
  packAmount?: number | null | undefined;
  packs: number;
  amount: number;
}

export interface Arrival {
  /** Packs to prefill (at least 1). */
  packs: number;
  /** An exact canonical amount when the receipt's sizes don't come to whole packs (sold by weight); else null. */
  amount: number | null;
  /** Σ line totals paid; null when the receipt printed no prices for it. */
  paidCents: number | null;
}

/**
 * What arrived on one ordered line from the receipt lines matched to it: the printed sizes × quantities when they can
 * be read (whole packs when they come within 10 % of them, else the exact amount), otherwise the quantities as packs.
 * `ing` is the ingredient that arrived (the substitute's, for a substitution).
 */
export function receiptArrival(item: ArrivalItem, lines: readonly ReceiptLine[], ing?: ConvertibleIngredient): Arrival {
  const got = lines.filter((l) => !l.notAvailable && l.quantity > 0);
  const priced = got.filter((l) => l.lineTotalCents !== null);
  const paidCents = priced.length ? priced.reduce((s, l) => s + l.lineTotalCents!, 0) : null;
  const sizes = ing ? got.map((l) => packSizeToCanonical(l.packSize, ing)) : [];
  const count = got.reduce((s, l) => s + l.quantity, 0);
  if (ing && got.length && sizes.every((s) => s !== null)) {
    const total = got.reduce((s, l, i) => s + sizes[i]! * l.quantity, 0);
    const per = item.packAmount && item.packAmount > 0 ? item.packAmount : null;
    if (per) {
      const packs = Math.max(1, Math.round(total / per));
      return { packs, amount: Math.abs(packs * per - total) <= total * 0.1 ? null : round3(total), paidCents };
    }
    return { packs: 1, amount: Math.abs(total - item.amount) <= total * 0.1 ? null : round3(total), paidCents };
  }
  return { packs: Math.max(1, Math.round(count) || 1), amount: null, paidCents };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The canonical amount of a "not on the list" line: its printed size × quantity, else the ingredient's usual pack ×
 * quantity; null when neither is known (the person adds it from Supply instead).
 */
export function extraAmount(line: ReceiptLine, ing: ConvertibleIngredient & { defaultPackAmount?: number | undefined; defaultPackMeasure?: Measure | undefined }): number | null {
  const q = line.quantity > 0 ? line.quantity : 1;
  const size = packSizeToCanonical(line.packSize, ing);
  if (size) return round3(size * q);
  if (ing.defaultPackAmount && ing.defaultPackMeasure) {
    const c = packToCanonical(ing.defaultPackAmount, ing.defaultPackMeasure, ing);
    if (c) return round3(c * q);
  }
  if (ing.canonicalUnit === "count") return q;
  return null;
}
