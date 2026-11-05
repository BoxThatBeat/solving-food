import { describe, expect, it } from "vitest";
import {
  appendObservation,
  cleanHistory,
  dealLabel,
  dealsFromMappings,
  mealDeal,
  DEAL_MIN_OBSERVATIONS,
  DEAL_THRESHOLD,
  median,
  priceDeal,
  priceMovers,
  PRICE_HISTORY_MAX,
  type PriceObservation,
} from "./priceHistory";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 9);
const weekly = (cents: number[], endMs = NOW): PriceObservation[] => cents.map((c, i) => ({ atMs: endMs - (cents.length - 1 - i) * 7 * DAY, cents: c, source: "pcx" }));

describe("price history (M27, R6.32)", () => {
  it("appends oldest first, bounded, and a second PC Express price the same week replaces the first", () => {
    let h: PriceObservation[] = [];
    for (let i = 0; i < PRICE_HISTORY_MAX + 4; i++) h = appendObservation(h, { atMs: NOW + i * 7 * DAY, cents: 500 + i, source: "pcx" });
    expect(h).toHaveLength(PRICE_HISTORY_MAX);
    expect(h[0]!.cents).toBe(504);
    const again = appendObservation(h, { atMs: h.at(-1)!.atMs + DAY, cents: 1, source: "pcx" });
    expect(again).toHaveLength(PRICE_HISTORY_MAX);
    expect(again.at(-1)).toMatchObject({ cents: 1 });
    // A receipt the same day is its own observation.
    expect(appendObservation(h, { atMs: h.at(-1)!.atMs + DAY, cents: 450, source: "receipt" }).at(-1)).toMatchObject({ source: "receipt" });
  });

  it("cleans what it reads: bad entries dropped, sorted", () => {
    expect(cleanHistory([{ atMs: 2, cents: 3, source: "pcx" }, { atMs: 1, cents: 0, source: "pcx" }, { atMs: 1, cents: 4, source: "x" }, null, { atMs: 1, cents: 5.4, source: "receipt" }])).toEqual([
      { atMs: 1, cents: 5, source: "receipt" },
      { atMs: 2, cents: 3, source: "pcx" },
    ]);
    expect(cleanHistory("nope")).toEqual([]);
  });

  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("usual price and deals", () => {
  it("usual is the median of the history before the newest; 15 % below with 4 observations is on sale", () => {
    const d = priceDeal(weekly([1000, 1100, 1000, 800]), null, NOW)!;
    expect(d).toMatchObject({ cents: 800, usualCents: 1000, observations: 4, onSale: true });
    expect(d.dealPct).toBeCloseTo(0.2);
    expect(dealLabel(d)).toBe("20% below usual");
    // Exactly the threshold counts; just above doesn't.
    expect(priceDeal(weekly([1000, 1000, 1000, 1000 * (1 - DEAL_THRESHOLD)]), null, NOW)!.onSale).toBe(true);
    expect(priceDeal(weekly([1000, 1000, 1000, 860]), null, NOW)!.onSale).toBe(false);
  });

  it("needs DEAL_MIN_OBSERVATIONS observations", () => {
    expect(DEAL_MIN_OBSERVATIONS).toBe(4);
    expect(priceDeal(weekly([1000, 1000, 500]), null, NOW)!).toMatchObject({ observations: 3, onSale: false });
    expect(priceDeal(weekly([1000]), null, NOW)).toBeNull();
    expect(priceDeal([], null, NOW)).toBeNull();
  });

  it("the live price is the current one when given; the history before it is usual", () => {
    const h = weekly([1000, 1000, 1000], NOW - 2 * DAY);
    expect(priceDeal(h, { cents: 750, atMs: NOW }, NOW)).toMatchObject({ cents: 750, usualCents: 1000, observations: 4, onSale: true });
    // The weekly observation written with the live price (same moment) isn't counted twice.
    const withSame = [...h, { atMs: NOW, cents: 750, source: "pcx" as const }];
    expect(priceDeal(withSame, { cents: 750, atMs: NOW }, NOW)).toMatchObject({ observations: 4, usualCents: 1000 });
  });

  it("a stale price or a receipt as the newest isn't a deal now", () => {
    expect(priceDeal(weekly([1000, 1000, 1000, 700], NOW - 20 * DAY), null, NOW)!.onSale).toBe(false);
    const receipt = [...weekly([1000, 1000, 1000], NOW - DAY), { atMs: NOW, cents: 600, source: "receipt" as const }];
    expect(priceDeal(receipt, null, NOW)!.onSale).toBe(false);
    // …but a receipt counts toward usual.
    expect(priceDeal([...receipt, { atMs: NOW + DAY, cents: 1000, source: "pcx" as const }], null, NOW + DAY)!.usualCents).toBe(1000);
  });

  it("dealsFromMappings keeps only the products on sale, against the live price at the store", () => {
    const live = (code: string) => (code === "C1" ? { priceCents: 700, fetchedAtMs: NOW } : undefined);
    const m = dealsFromMappings(
      [
        ["chicken", { productCode: "C1", priceHistory: weekly([1000, 1000, 1000], NOW - DAY) }],
        ["rice", { productCode: "R1", priceHistory: weekly([500, 500, 500, 490]) }],
        ["milk", {}],
      ],
      live,
      NOW,
    );
    expect([...m.keys()]).toEqual(["chicken"]);
    expect(m.get("chicken")!.dealPct).toBeCloseTo(0.3);
  });

  it("priceMovers: this week's biggest moves up or down, at most five", () => {
    const rows: Array<[string, { priceHistory: PriceObservation[] }]> = [
      ["a", { priceHistory: weekly([1000, 1000, 1000, 1300]) }],
      ["b", { priceHistory: weekly([1000, 1000, 1000, 800]) }],
      ["c", { priceHistory: weekly([1000, 1000, 1000, 1000]) }],
      ["d", { priceHistory: weekly([1000, 1000, 1000, 500], NOW - 10 * DAY) }],
      ["e", { priceHistory: weekly([1000, 1000, 1100]) }],
      ...["f", "g", "h", "i", "j"].map((id, i) => [id, { priceHistory: weekly([1000, 1000, 1000, 1010 + i]) }] as [string, { priceHistory: PriceObservation[] }]),
    ];
    const m = priceMovers(rows, () => undefined, NOW);
    expect(m.map((x) => x.id)).toEqual(["a", "b", "j", "i", "h"]);
    expect(m[0]!.changePct).toBeCloseTo(0.3);
    expect(m[1]!.changePct).toBeCloseTo(-0.2);
  });
});

describe("the Deal chip of a planned meal (R6.33)", () => {
  const deals = new Map([["chicken", { dealPct: 0.2 }], ["rice", { dealPct: 0.4 }], ["cream", { dealPct: 0.3 }]]);
  const meta = (id: string) => ({ chicken: { category: "meat", name: "chicken thighs, boneless" }, rice: { category: "grains", name: "rice" }, cream: { category: "dairy", name: "cream" } })[id];
  it("the main protein or the costliest line, only what the order buys", () => {
    const cents = (m: Record<string, number>) => (id: string) => m[id] ?? null;
    expect(mealDeal(["chicken", "rice"], deals, meta, cents({ chicken: 900, rice: 300 }))).toMatchObject({ ingredientId: "chicken", label: "Chicken thighs 20% below usual" });
    // Cream is the costliest line: on sale, so it is the chip (no protein to buy).
    expect(mealDeal(["cream", "rice"], deals, meta, cents({ cream: 900, rice: 300 }))).toMatchObject({ ingredientId: "cream" });
    // Cheap rice on sale alone isn't worth a chip.
    expect(mealDeal(["cream", "rice"], deals, meta, cents({ cream: 900, rice: 300 }))?.ingredientId).not.toBe("rice");
    expect(mealDeal(["cream", "rice"], new Map([["rice", { dealPct: 0.4 }]]), meta, cents({ cream: 900, rice: 300 }))).toBeNull();
    // Not bought (no line): nothing.
    expect(mealDeal(["chicken"], deals, meta, cents({}))).toBeNull();
  });
});
