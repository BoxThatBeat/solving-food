import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addedCost,
  buildList,
  copyText,
  DEFAULT_STORES,
  groupByStore,
  incomingFrom,
  itemCosts,
  manualItem,
  mergeDraft,
  needsFor,
  packLabel,
  storeFor,
  type BuildContext,
  type GroceryIngredient,
  type MappingEntry,
  type PlanItemInput,
  type RecipeLines,
  type RuleEntry,
} from "./grocery";
import { budgetState } from "./budget";
import { resolvePrice, costPerServing, formatCents } from "./pricing";

const ING: Record<string, GroceryIngredient> = {
  tomato: { id: "tomato", name: "canned tomatoes", category: "pantry", freeUse: false, allowedMeasures: ["weight"], canonicalUnit: "g", defaultPackAmount: 796, defaultPackMeasure: "weight" },
  spinach: { id: "spinach", name: "baby spinach", category: "produce", freeUse: false, allowedMeasures: ["weight"], canonicalUnit: "g" },
  chicken: { id: "chicken", name: "chicken thighs", category: "meat", freeUse: false, allowedMeasures: ["weight"], canonicalUnit: "g", defaultPackAmount: 900, defaultPackMeasure: "weight" },
  oil: { id: "oil", name: "olive oil", category: "condiments", freeUse: true, allowedMeasures: ["volume"], canonicalUnit: "g", densityGPerMl: 0.92, defaultPackAmount: 1000, defaultPackMeasure: "volume" },
  milk: { id: "milk", name: "milk", category: "dairy", freeUse: false, allowedMeasures: ["volume"], canonicalUnit: "g", densityGPerMl: 1.03, defaultPackAmount: 4000, defaultPackMeasure: "volume" },
  bay: { id: "bay", name: "bay leaf", category: "spices", freeUse: false, allowedMeasures: ["count"], canonicalUnit: "count" },
};

const RECIPES: Record<string, RecipeLines> = {
  pasta: { servings: 4, ingredients: [{ ingredientId: "tomato", canonicalAmount: 400, optional: false }, { ingredientId: "oil", canonicalAmount: 30, optional: false }, { ingredientId: "spinach", canonicalAmount: 140, optional: false }, { ingredientId: "bay", canonicalAmount: 2, optional: true }] },
  curry: { servings: 2, ingredients: [{ ingredientId: "tomato", canonicalAmount: 200, optional: false }, { ingredientId: "chicken", canonicalAmount: 300, optional: false }, { ingredientId: "milk", canonicalAmount: 0, optional: false }] },
};

const STORES = [...DEFAULT_STORES];

function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    recipes: (id) => RECIPES[id],
    ingredients: (id) => ING[id],
    supply: new Map(),
    incoming: new Map(),
    mappings: new Map(),
    rules: [],
    stores: STORES,
    defaultStoreId: "pc-express",
    prices: {
      estimates: {
        tomato: { priceCents: 299, packAmount: 796, packMeasure: "weight" },
        chicken: { priceCents: 1499, packAmount: 1000, packMeasure: "weight" },
        milk: { priceCents: 699, packAmount: 4000, packMeasure: "volume" },
      },
    },
    ...over,
  };
}

const plan = (id: string, recipeId: string, servings = 4, status = "planned"): PlanItemInput => ({ id, status, servings, recipes: [{ recipeId, servingsMultiplier: 1 }] });

describe("needs", () => {
  it("scales by servings × multiplier, skips free-use, optional, vague, and non-planned items", () => {
    const n = needsFor([plan("a", "pasta", 8), plan("b", "curry", 4), plan("c", "curry", 4, "cooked"), { id: "d", status: "planned", servings: 2, recipes: [{ recipeId: "curry", servingsMultiplier: 0.5 }] }], ctx());
    expect(Object.fromEntries(n)).toEqual({ tomato: 800 + 400 + 100, spinach: 280, chicken: 600 + 150 });
  });
});

describe("buildList", () => {
  it("rounds up to packs: mapping, then default pack, then the raw amount", () => {
    const mappings = new Map<string, MappingEntry>([["tomato", { productName: "Mutti Polpa", packAmount: 400, packMeasure: "weight", storeId: "pc-express" }]]);
    const { items } = buildList([plan("a", "pasta", 8)], ctx({ mappings }));
    expect(items.tomato).toMatchObject({ productName: "Mutti Polpa", packs: 2, packAmount: 400, amount: 800, packLabel: "400 g", need: 800 });
    expect(items.spinach).toMatchObject({ productName: "Baby spinach", packs: 1, packAmount: null, amount: 280, estPriceCents: null, priceSource: "unknown" });
    const def = buildList([plan("a", "pasta", 8)], ctx()).items.tomato!;
    expect(def).toMatchObject({ packs: 2, packAmount: 796, packLabel: "796 g", estPriceCents: 598 });
  });

  it("subtracts unexpired supply and incoming", () => {
    const c = ctx({ supply: new Map([["tomato", 500]]), incoming: new Map([["chicken", 900], ["spinach", 100]]) });
    const { items } = buildList([plan("a", "pasta", 4), plan("b", "curry", 4)], c);
    expect(items.tomato).toMatchObject({ need: 300, packs: 1 }); // 800 − 500
    expect(items.chicken).toBeUndefined(); // 600 − 900
    expect(items.spinach).toMatchObject({ need: 40 });
  });

  it("free-use ingredients never appear from planned meals (R8.14)", () => {
    expect(buildList([plan("a", "pasta")], ctx()).items.oil).toBeUndefined();
  });

  it("resolves the store: mapping beats ingredient rule beats category rule beats default", () => {
    const rules: RuleEntry[] = [
      { match: { category: "meat" }, storeId: "costco" },
      { match: { category: "pantry" }, storeId: "costco" },
      { match: { ingredientId: "spinach" }, storeId: "costco" },
    ];
    const mappings = new Map<string, MappingEntry>([["tomato", { productName: "Mutti", packAmount: 400, packMeasure: "weight", storeId: "pc-express" }]]);
    const c = ctx({ rules, mappings });
    expect(storeFor(ING.tomato!, c)).toBe("pc-express"); // mapping wins over the pantry → Costco rule
    expect(storeFor(ING.chicken!, c)).toBe("costco");
    expect(storeFor(ING.spinach!, c)).toBe("costco");
    expect(storeFor(ING.milk!, c)).toBe("pc-express");
    // A rule pointing at a deleted store falls through.
    expect(storeFor(ING.chicken!, ctx({ rules: [{ match: { category: "meat" }, storeId: "gone" }] }))).toBe("pc-express");
    expect(storeFor(ING.chicken!, ctx({ stores: [], defaultStoreId: undefined }))).toBe("unassigned");
  });

  it("prices whole packs and totals the budget's spent", () => {
    const built = buildList([plan("a", "curry", 4)], ctx());
    // tomato 400 g → 1 × 796 g at $2.99; chicken 600 g → 1 × 900 g at $14.99/kg = $13.49
    expect(built.items.tomato!.estPriceCents).toBe(299);
    expect(built.items.chicken!.estPriceCents).toBe(1349);
    expect(built.totalCents).toBe(299 + 1349);
    expect(built.unknownPrices).toBe(0);
    const b = budgetState(1000, built);
    expect(b).toMatchObject({ remainingCents: 1000 - 1648, over: true, fractionLeft: 0 });
    expect(formatCents(b.remainingCents)).toBe("−$6.48");
  });

  it("property: packs always cover the shortfall with less than one spare pack", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 2000 }), (servings, supply, incoming) => {
        const c = ctx({ supply: new Map([["chicken", supply]]), incoming: new Map([["chicken", incoming]]) });
        const need = needsFor([plan("a", "curry", servings)], c).get("chicken")!;
        const line = buildList([plan("a", "curry", servings)], c).items.chicken;
        const shortfall = Math.max(0, need - supply - incoming);
        if (shortfall < 1e-6) expect(line).toBeUndefined();
        else {
          expect(line!.amount).toBeGreaterThanOrEqual(shortfall - 1e-6);
          expect(line!.amount - shortfall).toBeLessThan(900 + 1e-6);
          expect(line!.packs).toBe(Math.ceil(shortfall / 900 - 1e-9));
        }
      }),
    );
  });
});

describe("marginal costs", () => {
  it("the first recipe that needs a pack pays for it; costs sum to the total", () => {
    const items = [plan("a", "curry", 2), plan("b", "pasta", 4)];
    const costs = itemCosts(items, ctx());
    // curry@2: tomato 200 (one can), chicken 300 (one pack). pasta@4: tomato 400 → total 600, still one can → free.
    expect(costs.get("a")!.cents).toBe(299 + 1349);
    expect(costs.get("b")).toEqual({ cents: 0, unknown: 1 }); // spinach has no price
    expect([...costs.values()].reduce((a, c) => a + c.cents, 0)).toBe(buildList(items, ctx()).totalCents);
    expect(addedCost([plan("a", "curry", 2)], plan("x", "curry", 10), ctx()).cents).toBeGreaterThan(0);
  });

  it("incoming ingredients cost nothing extra (R6.3)", () => {
    const incoming = incomingFrom([
      { status: "ordered", items: { chicken: { ingredientId: "chicken", amount: 900 }, m: { amount: 0 } } },
      { status: "draft", items: { tomato: { ingredientId: "tomato", amount: 796 } } },
    ]);
    expect(Object.fromEntries(incoming)).toEqual({ chicken: 900 });
    expect(buildList([plan("a", "curry", 4)], ctx({ incoming })).totalCents).toBe(299);
  });
});

describe("draft regeneration", () => {
  it("keeps manual lines and ticks; updates changed lines; removes lines no longer needed", () => {
    const c = ctx();
    const gen1 = buildList([plan("a", "curry", 4)], c).items;
    const manual = manualItem({ freeText: "bananas", packs: 2 }, c);
    const stored = { ...gen1, manual_x: manual, tomato: { ...gen1.tomato!, checked: true, checkedBy: "u2" } };
    // Unchanged plan: nothing to write.
    expect(mergeDraft(stored, gen1)).toEqual({ set: {}, remove: [] });
    const gen2 = buildList([plan("a", "curry", 6)], c).items; // more chicken and tomato needed, same packs
    const { set, remove } = mergeDraft(stored, gen2);
    expect(Object.keys(set).sort()).toEqual(["chicken", "tomato"]);
    expect(set.tomato).toMatchObject({ checked: true, checkedBy: "u2", packs: 1, need: 600 });
    expect(remove).toEqual([]);
    const { set: set3, remove: remove3 } = mergeDraft(stored, {});
    expect(set3).toEqual({});
    expect(remove3.sort()).toEqual(["chicken", "tomato"]);
    // A changed tomato line keeps its tick.
    const gen4 = buildList([plan("a", "curry", 20)], c).items;
    expect(mergeDraft(stored, gen4).set.tomato).toMatchObject({ checked: true, checkedBy: "u2", packs: 3 }); // 2000 g in 796 g cans
  });

  it("manual lines: ingredients in packs, free text as is", () => {
    const c = ctx();
    expect(manualItem({ ingredientId: "milk", packs: 1 }, c)).toMatchObject({ productName: "Milk", packs: 1, packLabel: "4 L", amount: 4120, estPriceCents: 699, source: "manual" });
    expect(manualItem({ freeText: " bananas ", packs: 0 }, c)).toMatchObject({ productName: "Bananas", freeText: "bananas", packs: 1, storeId: "pc-express", estPriceCents: null });
  });
});

describe("copy text (R7.5)", () => {
  it("only the PC Express section, LLM-friendly", () => {
    const c = ctx({ rules: [{ match: { category: "meat" }, storeId: "costco" }], mappings: new Map([["tomato", { productName: "Mutti Polpa chopped tomatoes", packAmount: 400, packMeasure: "weight", storeId: "pc-express" }]]) });
    const items = { ...buildList([plan("a", "pasta", 8), plan("b", "curry", 4)], c).items, manual_1: manualItem({ freeText: "bananas", packs: 1 }, c) };
    expect(copyText(items, STORES)).toBe(
      [
        "Please add these to my PC Express cart:",
        "- Baby spinach, 280 g",
        "- Mutti Polpa chopped tomatoes, 400 g × 3",
        "- Bananas × 1",
        "Substitutions: closest equivalent size; skip if unavailable.",
      ].join("\n"),
    );
    const groups = groupByStore(items, STORES);
    expect(groups.map((g) => g.store.id)).toEqual(["pc-express", "costco"]);
    expect(groups[1]!.items.map(([id]) => id)).toEqual(["chicken"]);
  });
  it("pack labels", () => {
    expect(packLabel(400, "weight")).toBe("400 g");
    expect(packLabel(2000, "weight")).toBe("2 kg");
    expect(packLabel(4000, "volume")).toBe("4 L");
    expect(packLabel(946, "volume")).toBe("946 ml");
    expect(packLabel(12, "count")).toBe("12 ct");
  });
});

describe("prices", () => {
  it("estimate → cents per canonical unit; live only for mapped products when fresh", () => {
    const est = { milk: { priceCents: 700, packAmount: 4000, packMeasure: "volume" as const } };
    expect(resolvePrice(ING.milk!, undefined, undefined, est).centsPerUnit).toBeCloseTo(700 / 4120);
    expect(resolvePrice(ING.spinach!, undefined, undefined, est)).toEqual({ centsPerUnit: null, source: "unknown" });
    const now = 1_000_000_000_000;
    const live = { priceCents: 500, packAmount: 2000, packMeasure: "volume" as const, fetchedAtMs: now - 86_400_000 };
    expect(resolvePrice(ING.milk!, { productCode: "x" }, live, est, now).source).toBe("live");
    expect(resolvePrice(ING.milk!, { productCode: "x" }, { ...live, fetchedAtMs: now - 15 * 86_400_000 }, est, now).source).toBe("estimate");
    expect(resolvePrice(ING.milk!, {}, live, est, now).source).toBe("estimate");
  });
  it("cost per serving", () => {
    expect(costPerServing([["a", 100], ["b", 50]], (id) => (id === "a" ? 1.5 : 2))).toBe(250);
    expect(costPerServing([["a", 100], ["c", 1]], (id) => (id === "a" ? 1 : null))).toBeNull();
  });
});
