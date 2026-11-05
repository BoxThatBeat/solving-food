// Substitutions (M28): table integrity against the seed, ratio maths, swaps over Supply, applying accepted swaps, the
// suggestion factor and reason, and "can make" with swaps.
import { describe, expect, it } from "vitest";
import { loadIngredients } from "../../../data/scripts/ingredients";
import {
  applySwaps,
  findSwaps,
  isBaking,
  substituteInSupply,
  substitutesFor,
  substitutionRatio,
  SUBSTITUTIONS,
  SWAP_PENALTY,
  swapText,
} from "./substitutions";
import { supplyCoverage } from "./cooking";
import { emptyScoreContext, missingIngredients, score, DEFAULT_WEIGHTS, type ScoreRecipe } from "./scoring";
import { finishCookingPayload } from "./commands";

const seed = new Map(loadIngredients().items.map((i) => [i.id, i]));
const ML = { ml: 1, tsp: 4.92892, tbsp: 14.7868 } as const;
function grams(id: string, qty: number, unit: (typeof SUBSTITUTIONS)[number]["basis"][1]): number {
  const i = seed.get(id)!;
  if (unit === "g") return qty;
  if (unit === "each") return qty * i.unitWeightG!;
  return qty * ML[unit] * i.densityGPerMl!;
}

describe("the substitution table", () => {
  it("has about forty curated swaps", () => {
    expect(SUBSTITUTIONS.length).toBeGreaterThanOrEqual(40);
  });

  it("only names seed ingredients, all weighed in grams", () => {
    for (const s of SUBSTITUTIONS) {
      for (const id of [s.from, s.to]) {
        expect(seed.has(id), `${id} is not in data/ingredients`).toBe(true);
        expect(seed.get(id)!.canonicalUnit).toBe("g");
      }
    }
  });

  it("has every ratio follow from its kitchen rule and the seed's densities and unit weights", () => {
    for (const s of SUBSTITUTIONS) {
      const [fq, fu, tq, tu] = s.basis;
      if (fu === "each") expect(seed.get(s.from)!.unitWeightG, `${s.from} needs a unit weight`).toBeGreaterThan(0);
      if (tu === "each") expect(seed.get(s.to)!.unitWeightG, `${s.to} needs a unit weight`).toBeGreaterThan(0);
      if (fu !== "g" && fu !== "each") expect(seed.get(s.from)!.densityGPerMl, `${s.from} needs a density`).toBeGreaterThan(0);
      if (tu !== "g" && tu !== "each") expect(seed.get(s.to)!.densityGPerMl, `${s.to} needs a density`).toBeGreaterThan(0);
      const want = grams(s.to, tq, tu) / grams(s.from, fq, fu);
      expect(Math.abs(s.ratio - want) / want, `${s.from} → ${s.to}`).toBeLessThan(0.01);
    }
  });

  it("has no pair twice, no swap of an ingredient for itself, and positive ratios", () => {
    const seen = new Set<string>();
    for (const s of SUBSTITUTIONS) {
      expect(s.from).not.toBe(s.to);
      expect(s.ratio).toBeGreaterThan(0);
      for (const k of [`${s.from}>${s.to}`, ...(s.both ? [`${s.to}>${s.from}`] : [])]) {
        expect(seen.has(k), k).toBe(false);
        seen.add(k);
      }
    }
  });

  it("works both ways for `both` entries, with the reverse ratio", () => {
    expect(substitutionRatio("shallot", "onion")).toBe(1);
    expect(substitutionRatio("onion", "shallot")).toBe(1);
    expect(substitutionRatio("fresh-basil", "dried-basil")).toBeCloseTo(0.233);
    expect(substitutionRatio("dried-basil", "fresh-basil")).toBeCloseTo(1 / 0.233);
    // One way only: garlic powder stands in for garlic, not the other way.
    expect(substitutionRatio("garlic", "garlic-powder")).toBeCloseTo(0.0776);
    expect(substitutionRatio("garlic-powder", "garlic")).toBeNull();
    expect(substitutesFor("onion").map((o) => o.to)).toEqual(["shallot", "red-onion", "sweet-onion", "onion-powder"]);
  });

  it("knows a baking recipe by its tags", () => {
    expect(isBaking(["dessert", "cookies"])).toBe(true);
    expect(isBaking(["Baking"])).toBe(true);
    expect(isBaking(["dinner"])).toBe(false);
    expect(isBaking(undefined)).toBe(false);
  });
});

describe("findSwaps", () => {
  it("covers a missing ingredient with the first substitute that has enough to spare", () => {
    // Two cloves (10 g) of garlic, none in Supply; 5 g of garlic powder.
    const swaps = findSwaps(new Map([["garlic", 10]]), new Map([["garlic-powder", 5]]));
    expect(swaps).toEqual([{ ingredientId: "garlic", withIngredientId: "garlic-powder", replaces: 10, amount: 10 * 0.0776 }]);
  });

  it("swaps only the shortfall and leaves what the recipe already uses of the substitute", () => {
    // 200 g onion, 60 g in Supply; 150 g shallot, of which the recipe needs 100 g itself: 50 g spare < 140 g.
    expect(findSwaps(new Map([["onion", 200], ["shallot", 100]]), new Map([["onion", 60], ["shallot", 150]]))).toEqual([]);
    const ok = findSwaps(new Map([["onion", 200]]), new Map([["onion", 60], ["shallot", 150]]));
    expect(ok).toEqual([{ ingredientId: "onion", withIngredientId: "shallot", replaces: 140, amount: 140 }]);
  });

  it("doesn't count one substitute twice", () => {
    // Lime and lemon juice both want the lemon juice... only one gets it.
    const swaps = findSwaps(new Map([["lime-juice", 30], ["lemon", 100]]), new Map([["lemon-juice", 50]]));
    expect(swaps.map((s) => s.ingredientId)).toEqual(["lime-juice"]);
  });

  it("falls through to the next substitute in table order", () => {
    const swaps = findSwaps(new Map([["onion", 150]]), new Map([["shallot", 20], ["red-onion", 200]]));
    expect(swaps[0]).toMatchObject({ withIngredientId: "red-onion", amount: 150 });
  });

  it("never offers a cooking-only swap to a baking recipe", () => {
    const needs = new Map([["butter", 50]]);
    const have = new Map([["olive-oil", 500]]);
    expect(findSwaps(needs, have)).toHaveLength(1);
    expect(findSwaps(needs, have, { baking: true })).toEqual([]);
  });

  it("carries the entry's tip", () => {
    expect(findSwaps(new Map([["buttermilk", 250]]), new Map([["milk", 1000]]))[0]!.note).toMatch(/vinegar/);
  });

  it("finds a substitute already in Supply for a grocery line, ignoring the line's own ingredient", () => {
    expect(substituteInSupply("shallot", 80, new Map([["shallot", 500], ["onion", 100]]))).toMatchObject({ withIngredientId: "onion", amount: 80 });
    expect(substituteInSupply("shallot", 80, new Map([["onion", 50]]))).toBeNull();
    expect(substituteInSupply("shallot", 0, new Map([["onion", 50]]))).toBeNull();
  });

  it("reads like the suggestion reason", () => {
    const [s] = findSwaps(new Map([["garlic", 10]]), new Map([["garlic-powder", 5]]));
    expect(swapText(s!, (id) => id.replace(/-/g, " "), (_, n) => `${n.toFixed(1)} g`)).toBe("garlic: use 0.8 g garlic powder from Supply");
  });
});

describe("applySwaps", () => {
  it("deducts the substitute in place of the original", () => {
    const out = applySwaps(new Map([["garlic", 10], ["chicken-thigh", 600]]), [{ ingredientId: "garlic", withIngredientId: "garlic-powder", amount: 0.776 }]);
    expect([...out]).toEqual([["chicken-thigh", 600], ["garlic-powder", 0.776]]);
  });

  it("drops the original when a rounded swap amount leaves a sliver of it", () => {
    // 25 g garlic → 1.94 g powder, sent as 1.94 (3 decimals): 0.0005 g short of the exact swap.
    const out = applySwaps(new Map([["garlic", 25]]), [{ ingredientId: "garlic", withIngredientId: "garlic-powder", amount: 1.94 }]);
    expect(out.has("garlic")).toBe(false);
  });

  it("keeps the part of the original the swap doesn't replace", () => {
    const out = applySwaps(new Map([["onion", 200]]), [{ ingredientId: "onion", withIngredientId: "shallot", amount: 140 }]);
    expect(out.get("onion")).toBeCloseTo(60);
    expect(out.get("shallot")).toBe(140);
  });

  it("ignores pairs the table doesn't have and ingredients the meal doesn't use", () => {
    const needs = new Map([["onion", 200]]);
    expect([...applySwaps(needs, [{ ingredientId: "onion", withIngredientId: "chicken-thigh", amount: 100 }])]).toEqual([["onion", 200]]);
    expect([...applySwaps(needs, [{ ingredientId: "garlic", withIngredientId: "garlic-powder", amount: 1 }])]).toEqual([["onion", 200]]);
  });
});

describe("swaps in suggestions and Can make (R6.35)", () => {
  const r: ScoreRecipe = { id: "r", title: "Garlic chicken", cuisine: "other", mainProtein: "chicken", tags: ["dinner"], ingredientIds: ["chicken-thigh", "garlic", "lemon"], servings: 4, proteinPerServingG: 30, tools: [], lines: { "chicken-thigh": 150, garlic: 2.5, lemon: 25 } };
  const names: Record<string, string> = { "chicken-thigh": "chicken thighs", garlic: "garlic", "garlic-powder": "garlic powder", lemon: "lemon" };
  const ctx = (substitute: boolean) =>
    emptyScoreContext({
      servings: 4,
      projected: new Map([["chicken-thigh", 600], ["garlic-powder", 50]]),
      ingredient: (id) => (names[id] ? { name: names[id], category: "produce", canonicalUnit: "g" } : undefined),
      substitute,
    });

  it("counts a swapped ingredient as a small part of a missing one", () => {
    const needs = new Map([["chicken-thigh", 600], ["garlic", 10], ["lemon", 100]]);
    const swaps = findSwaps(needs, ctx(true).projected);
    expect(missingIngredients(needs, ctx(true))).toBeCloseTo(2 / 3);
    expect(missingIngredients(needs, ctx(true), swaps)).toBeCloseTo((1 + SWAP_PENALTY) / 3);
  });

  it("explains the swap: Missing lemon · garlic: use 0.8 g garlic powder from Supply", () => {
    const on = score(r, ctx(true), { ...DEFAULT_WEIGHTS });
    expect(on.swaps?.map((s) => s.withIngredientId)).toEqual(["garlic-powder"]);
    expect(on.reasons.find((x) => x.key === "missingIngredients")?.label).toBe("Missing lemon · garlic: use 0.8 g garlic powder from Supply");
    const off = score(r, ctx(false), { ...DEFAULT_WEIGHTS });
    expect(off.swaps).toBeUndefined();
    expect(off.reasons.find((x) => x.key === "missingIngredients")?.label).toBe("Missing garlic, lemon");
    expect(on.raw).toBeGreaterThan(off.raw);
  });

  it("makes a recipe 'can make' with swaps, only when asked", () => {
    const lines = [
      { ingredientId: "chicken-thigh", canonicalAmount: 600, optional: false },
      { ingredientId: "garlic", canonicalAmount: 10, optional: false },
    ];
    const have = new Map([["chicken-thigh", 600], ["garlic-powder", 50]]);
    const strict = supplyCoverage(lines, have, () => undefined);
    expect(strict).toMatchObject({ canMake: false, missing: ["garlic"], swaps: [] });
    const loose = supplyCoverage(lines, have, () => undefined, { substitute: true });
    expect(loose.canMake).toBe(true);
    expect(loose.fraction).toBe(1);
    expect(loose.swaps.map((s) => s.withIngredientId)).toEqual(["garlic-powder"]);
  });
});

describe("the finishCooking payload (M28)", () => {
  const base = { cookEventId: "e1", recipes: [{ recipeId: "r", servingsMultiplier: 1 }], servings: 4 };
  it("takes substitutions and step notes", () => {
    expect(finishCookingPayload.safeParse({ ...base, substitutions: [{ ingredientId: "garlic", withIngredientId: "garlic-powder", amount: 0.8 }], stepNotes: [{ recipeId: "r", step: 2, text: "More lemon" }, { recipeId: "r", step: 3, text: "" }] }).success).toBe(true);
  });
  it("refuses a zero swap, a path in an ID, a long note and a negative step", () => {
    expect(finishCookingPayload.safeParse({ ...base, substitutions: [{ ingredientId: "garlic", withIngredientId: "garlic-powder", amount: 0 }] }).success).toBe(false);
    expect(finishCookingPayload.safeParse({ ...base, substitutions: [{ ingredientId: "a/b", withIngredientId: "garlic-powder", amount: 1 }] }).success).toBe(false);
    expect(finishCookingPayload.safeParse({ ...base, stepNotes: [{ recipeId: "r", step: 0, text: "x".repeat(201) }] }).success).toBe(false);
    expect(finishCookingPayload.safeParse({ ...base, stepNotes: [{ recipeId: "r", step: -1, text: "x" }] }).success).toBe(false);
  });
});
