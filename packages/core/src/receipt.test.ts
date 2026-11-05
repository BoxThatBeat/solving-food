// From a receipt (M25, R7.15–R7.17): the instruction and schema, normalising Gemini's answer, matching receipt lines to
// the ordered list, and what arrived.
import { describe, expect, it } from "vitest";
import { buildIngredientIndex } from "./ingredientMatch";
import {
  dollarsToCents,
  extraAmount,
  matchReceipt,
  packSizeToCanonical,
  productScore,
  readReceipt,
  receiptArrival,
  receiptGenerationConfig,
  receiptInstruction,
  type OrderedLine,
  type ReceiptLine,
} from "./receipt";

const index = buildIngredientIndex([
  { id: "baby-spinach", name: "baby spinach", aliases: [] },
  { id: "jasmine-rice", name: "jasmine rice", aliases: [] },
  { id: "basmati-rice", name: "basmati rice", aliases: [] },
  { id: "feta-cheese", name: "feta cheese", aliases: ["feta"] },
  { id: "chicken-thigh", name: "chicken thigh", aliases: ["chicken thighs"] },
  { id: "bananas", name: "banana", aliases: [] },
  { id: "milk", name: "milk", aliases: [] },
]);

const ordered: OrderedLine[] = [
  { itemId: "baby-spinach", productName: "Organic baby spinach", ingredientId: "baby-spinach", packLabel: "312 g", packs: 1 },
  { itemId: "feta-cheese", productName: "Krinos Greek feta", ingredientId: "feta-cheese", packLabel: "200 g", packs: 1 },
  { itemId: "jasmine-rice", productName: "Jasmine rice", ingredientId: "jasmine-rice", packLabel: "8 kg", packs: 1 },
  { itemId: "chicken-thigh", productName: "Kirkland boneless thighs", ingredientId: "chicken-thigh", packLabel: "3 kg", packs: 1 },
  { itemId: "manual_x", productName: "Birthday candles", ingredientId: null, packs: 1 },
];

const line = (o: Partial<ReceiptLine> & { description: string }): ReceiptLine => ({
  name: null,
  quantity: 1,
  packSize: null,
  unitPriceCents: null,
  lineTotalCents: null,
  substitutedFor: null,
  notAvailable: false,
  listLine: null,
  ...o,
});

const weighed = { allowedMeasures: ["weight"] as const, canonicalUnit: "g" as const };
const milk = { allowedMeasures: ["weight", "volume"] as const, canonicalUnit: "g" as const, densityGPerMl: 1.03 };
const eggs = { allowedMeasures: ["count", "weight"] as const, canonicalUnit: "count" as const, unitWeightG: 50 };

describe("the request (R7.15)", () => {
  it("names the ordered lines by L-keys and asks for JSON with a schema", () => {
    const text = receiptInstruction(ordered);
    expect(text).toContain("L1: Organic baby spinach, 312 g × 1");
    expect(text).toContain("L5: Birthday candles × 1");
    expect(text).toMatch(/Fold an instant saving/);
    expect(receiptInstruction([])).toContain("(none)");
    const cfg = receiptGenerationConfig();
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseSchema.required).toEqual(["lines"]);
    expect(Object.keys(cfg.responseSchema.properties.lines.items.properties)).toEqual(expect.arrayContaining(["description", "quantity", "packSize", "unitPrice", "lineTotal", "substitutedFor", "notAvailable"]));
  });
});

describe("normalising the answer", () => {
  it("dollars to cents in the shapes receipts print", () => {
    expect(dollarsToCents(4.99)).toBe(499);
    expect(dollarsToCents("$12.50")).toBe(1250);
    expect(dollarsToCents("3,49")).toBe(349);
    expect(dollarsToCents("3.00-")).toBe(-300);
    expect(dollarsToCents("1,299.00")).toBe(129900);
    expect(dollarsToCents("free")).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
  });

  it("reads JSON text or an object; trims, defaults, totals, folds a discount line, caps", () => {
    const r = readReceipt(
      "```json\n" +
        JSON.stringify({
          store: "  Costco Merivale ",
          date: "2026-11-04",
          total: 61.47,
          lines: [
            { description: "KS CHKN THIGH", name: "chicken thighs", packSize: "3 kg", unitPrice: 24.99 },
            { description: "TPD/1234567", lineTotal: -3 },
            { description: "  BANANAS ", name: "bananas", quantity: "2", lineTotal: "3.38" },
            { description: "", name: "" },
            { description: "Feta", notAvailable: true, quantity: 1, lineTotal: 5.99 },
            { description: "Odd", listLine: "l3" },
            { description: "Odder", listLine: "zz" },
          ],
        }) +
        "\n```",
    )!;
    expect(r.store).toBe("Costco Merivale");
    expect(r.date).toBe("2026-11-04");
    expect(r.totalCents).toBe(6147);
    expect(r.lines.map((l) => [l.description, l.quantity, l.lineTotalCents])).toEqual([
      ["KS CHKN THIGH", 1, 2199],
      ["BANANAS", 2, 338],
      ["Feta", 0, 599],
      ["Odd", 1, null],
      ["Odder", 1, null],
    ]);
    expect(r.lines[2]!.notAvailable).toBe(true);
    expect(r.lines[3]!.listLine).toBe("L3");
    expect(r.lines[4]!.listLine).toBeNull();
    expect(readReceipt({ date: "Nov 4", lines: [] })).toEqual({ store: null, date: null, totalCents: null, lines: [] });
    expect(readReceipt("not json")).toBeNull();
    expect(readReceipt({ items: [] })).toBeNull();
    expect(readReceipt({ lines: Array.from({ length: 400 }, (_, i) => ({ description: `x${i}` })) })!.lines).toHaveLength(150);
  });
});

describe("matching to the ordered list (R7.16)", () => {
  it("product name first, then the ingredient, then Gemini's line; substitutions by what they replaced; the rest missing or not on the list", () => {
    const m = matchReceipt(
      {
        store: null,
        date: null,
        totalCents: null,
        lines: [
          line({ description: "ORGANIC BABY SPINACH 312G", name: "baby spinach", lineTotalCents: 499 }),
          line({ description: "KS BNLS THIGHS", name: "chicken thighs", packSize: "3.2 kg", lineTotalCents: 2499 }),
          line({ description: "Basmati Rice 8kg", name: "basmati rice", substitutedFor: "Jasmine rice 8 kg", lineTotalCents: 2199 }),
          line({ description: "Krinos Greek feta", notAvailable: true }),
          line({ description: "BANANAS", name: "bananas", quantity: 2, lineTotalCents: 338 }),
          line({ description: "CANDLES 24PK", listLine: "L5", lineTotalCents: 199 }),
        ],
      },
      ordered,
      index,
    );
    expect(m.lines.map((l) => [l.description, l.itemId, l.how, l.ingredientId])).toEqual([
      ["ORGANIC BABY SPINACH 312G", "baby-spinach", "product", "baby-spinach"],
      ["KS BNLS THIGHS", "chicken-thigh", "ingredient", "chicken-thigh"],
      ["Basmati Rice 8kg", "jasmine-rice", "product", "basmati-rice"],
      ["Krinos Greek feta", "feta-cheese", "product", null],
      ["BANANAS", null, null, "bananas"],
      ["CANDLES 24PK", "manual_x", "gemini", null],
    ]);
    // Feta didn't come (only an unavailable line names it).
    expect(m.missing).toEqual(["feta-cheese"]);
  });

  it("a line absent from the receipt is missing; a stale Gemini key is ignored", () => {
    const m = matchReceipt({ store: null, date: null, totalCents: null, lines: [line({ description: "Mystery", listLine: "L9" })] }, ordered, index);
    expect(m.lines[0]!.itemId).toBeNull();
    expect(m.missing).toEqual(ordered.map((l) => l.itemId));
  });

  it("product wording score", () => {
    expect(productScore("Organic baby spinach", "ORGANIC BABY SPINACH 312G")).toBe(1);
    expect(productScore("Milk", "MILK 2% 4L")).toBe(1);
    expect(productScore("Milk", "Chocolate milk")).toBe(0.5);
    expect(productScore("Milk", "milk")).toBe(1);
    expect(productScore("Jasmine rice", "Basmati rice")).toBeLessThan(0.6);
  });
});

describe("what arrived", () => {
  it("printed sizes in canonical units", () => {
    expect(packSizeToCanonical("400 g", weighed)).toBe(400);
    expect(packSizeToCanonical("1.234 kg", weighed)).toBeCloseTo(1234);
    expect(packSizeToCanonical("1,5 kg", weighed)).toBeCloseTo(1500);
    expect(packSizeToCanonical("4 L", milk)).toBeCloseTo(4120);
    expect(packSizeToCanonical("6 x 355 ml", milk)).toBeCloseTo(2193.9);
    expect(packSizeToCanonical("12 ct", eggs)).toBe(12);
    expect(packSizeToCanonical("1 lb", weighed)).toBeCloseTo(453.6, 0);
    expect(packSizeToCanonical("4 L", weighed)).toBeNull();
    expect(packSizeToCanonical("large", weighed)).toBeNull();
    expect(packSizeToCanonical(null, weighed)).toBeNull();
  });

  it("whole packs when the sizes come to them, an exact weight when they don't, quantities otherwise; prices summed", () => {
    expect(receiptArrival({ packAmount: 312, packs: 1, amount: 312 }, [line({ description: "a", quantity: 2, packSize: "312 g", lineTotalCents: 998 })], weighed)).toEqual({ packs: 2, amount: null, paidCents: 998 });
    expect(receiptArrival({ packAmount: 3000, packs: 1, amount: 3000 }, [line({ description: "a", packSize: "3.4 kg", lineTotalCents: 2499 })], weighed)).toEqual({ packs: 1, amount: 3400, paidCents: 2499 });
    expect(receiptArrival({ packAmount: 200, packs: 1, amount: 200 }, [line({ description: "a", quantity: 3 })], weighed)).toEqual({ packs: 3, amount: null, paidCents: null });
    expect(receiptArrival({ packAmount: null, packs: 1, amount: 500 }, [line({ description: "a", packSize: "750 g" })], weighed)).toEqual({ packs: 1, amount: 750, paidCents: null });
    // Two receipt lines for one ordered line; an unavailable one doesn't count.
    expect(
      receiptArrival({ packAmount: 312, packs: 2, amount: 624 }, [line({ description: "a", lineTotalCents: 499 }), line({ description: "b", lineTotalCents: 499 }), line({ description: "c", notAvailable: true, quantity: 0, lineTotalCents: 499 })], weighed),
    ).toEqual({ packs: 2, amount: null, paidCents: 998 });
    expect(receiptArrival({ packAmount: 312, packs: 1, amount: 312 }, [line({ description: "a", quantity: 1.5 })])).toEqual({ packs: 2, amount: null, paidCents: null });
  });

  it("a not-on-the-list line's amount: its size, else the usual pack, else a count", () => {
    expect(extraAmount(line({ description: "x", quantity: 2, packSize: "1 kg" }), weighed)).toBe(2000);
    expect(extraAmount(line({ description: "x", quantity: 2 }), { ...weighed, defaultPackAmount: 500, defaultPackMeasure: "weight" })).toBe(1000);
    expect(extraAmount(line({ description: "x", quantity: 6 }), eggs)).toBe(6);
    expect(extraAmount(line({ description: "x" }), weighed)).toBeNull();
  });
});
