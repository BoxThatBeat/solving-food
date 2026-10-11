import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { baseSetScore, defaultCap, Optimiser, prng, setScore, sharedIngredients, withinCaps, type OptimiserCandidate, type SetCost } from "./optimiser";
import { jaccard } from "./dedupe";
import { costOfNeeds, needsFor, type BuildContext, type GroceryIngredient } from "./grocery";

const CUISINES = ["italian", "indian", "thai", "mexican", "japanese", "greek"];
const PROTEINS = ["chicken", "fish", "beef", "tofu", "pork", "legumes"];

function cand(i: number, over: Partial<OptimiserCandidate> = {}): OptimiserCandidate {
  return { id: `r${i}`, score: 40 + ((i * 37) % 60), cuisine: CUISINES[i % 6]!, mainProtein: PROTEINS[(i * 5) % 6]!, ingredientIds: [`ing${i % 7}`, `ing${(i + 3) % 11}`], ...over };
}

/** Cost: each recipe $8 + $2 per ingredient not shared with another in the set (a shared bag is bought once). */
const simpleCost: SetCost = (ids) => {
  const count = new Map<string, number>();
  for (const id of ids) {
    const i = Number(id.slice(1));
    for (const g of [`ing${i % 7}`, `ing${(i + 3) % 11}`]) count.set(g, (count.get(g) ?? 0) + 1);
  }
  return ids.length * 800 + count.size * 200;
};

function drain(o: Optimiser, max = 1000) {
  const out = [];
  for (let i = 0; i < max; i++) {
    const s = o.next();
    if (!s) break;
    out.push(s);
  }
  return out;
}

describe("set score", () => {
  it("rewards shared ingredients and penalises repeated cuisine or protein", () => {
    const a = cand(0, { score: 50, ingredientIds: ["spinach", "feta"] });
    const b = cand(1, { score: 50, ingredientIds: ["spinach", "rice"] });
    const c = cand(2, { score: 50, ingredientIds: ["beef"] });
    expect(sharedIngredients([a, b, c])).toEqual(["spinach"]);
    expect(baseSetScore([a, b])).toBeGreaterThan(baseSetScore([a, c]));
    const repeat = { ...c, cuisine: a.cuisine };
    expect(baseSetScore([a, repeat])).toBeLessThan(baseSetScore([a, c]));
    expect(setScore([a, b], 1000, 2000)).toBeCloseTo(baseSetScore([a, b]) - 0.25);
  });

  it("caps per cuisine and protein; 'other' and 'none' are never capped", () => {
    expect(defaultCap(4)).toBe(2);
    expect(defaultCap(1)).toBe(1);
    const x = (cuisine: string, mainProtein: string) => cand(0, { cuisine, mainProtein });
    expect(withinCaps([x("thai", "fish"), x("thai", "tofu")], 1, 2)).toBe(false);
    expect(withinCaps([x("other", "none"), x("other", "none")], 1, 1)).toBe(true);
  });
});

describe("Optimiser", () => {
  const cands = Array.from({ length: 24 }, (_, i) => cand(i));

  it("returns sets of exactly n under budget within caps, best first, each new one distinct", () => {
    const o = new Optimiser(cands, simpleCost, { n: 4, maxCents: 6000, seed: 7, timeBudgetMs: Infinity, fruitlessLimit: 60 });
    const sets = drain(o, 12);
    expect(sets.length).toBeGreaterThan(2);
    for (const s of sets) {
      expect(new Set(s.ids).size).toBe(4);
      expect(s.costCents).toBeLessThanOrEqual(6000);
      expect(withinCaps(s.ids.map((id) => cands.find((c) => c.id === id)!), 2, 2)).toBe(true);
    }
    for (let i = 0; i < sets.length; i++) for (let j = 0; j < i; j++) expect(jaccard(sets[i]!.ids, sets[j]!.ids)).toBeLessThan(0.5);
    expect(sets[0]!.setScore).toBeGreaterThanOrEqual(Math.max(...sets.map((s) => s.setScore)) - 1e-9);
  });

  it("every shown set is good: ≥ 80 % of the best found", () => {
    const o = new Optimiser(cands, simpleCost, { n: 3, maxCents: 5000, seed: 3, timeBudgetMs: Infinity, fruitlessLimit: 80 });
    const sets = drain(o, 50);
    const best = Math.max(...sets.map((s) => s.setScore));
    for (const s of sets) expect(s.setScore).toBeGreaterThanOrEqual(0.8 * best - 1e-9);
  });

  it("is deterministic with a seed", () => {
    const run = () => drain(new Optimiser(cands, simpleCost, { n: 4, maxCents: 6000, seed: 42, timeBudgetMs: Infinity, fruitlessLimit: 50 }), 6).map((s) => s.ids.join(","));
    expect(run()).toEqual(run());
  });

  it("exhausts: 'no more good combinations' when the space runs out, and Back keeps history", () => {
    const few = cands.slice(0, 5);
    const o = new Optimiser(few, simpleCost, { n: 4, maxCents: 100_000, seed: 1, timeBudgetMs: Infinity, fruitlessLimit: 30, cuisineCap: 4, proteinCap: 4 });
    const sets = drain(o);
    // Five recipes choose four: any two such sets share three of four recipes (Jaccard 0.6), so only one is distinct.
    expect(sets).toHaveLength(1);
    expect(o.next()).toBeNull();
    expect(o.exhausted).toBe(true);
    expect(o.history).toHaveLength(1);
  });

  it("finds nothing when the budget is too small or there are fewer candidates than n", () => {
    expect(new Optimiser(cands, simpleCost, { n: 4, maxCents: 1000, seed: 1, timeBudgetMs: Infinity, fruitlessLimit: 20 }).next()).toBeNull();
    const o = new Optimiser(cands.slice(0, 2), simpleCost, { n: 3, maxCents: 100_000, seed: 1 });
    expect(o.next()).toBeNull();
    expect(o.exhausted).toBe(true);
  });

  it("stops at the time budget and says so", () => {
    let t = 0;
    const o = new Optimiser(cands, () => 999_999, { n: 4, maxCents: 100, seed: 1, timeBudgetMs: 10, fruitlessLimit: 1e9, now: () => (t += 5) });
    expect(o.next()).toBeNull();
    expect(o.exhausted).toBe(true);
  });

  it("respects the budget and the count for any inputs (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ score: fc.integer({ min: 0, max: 100 }), c: fc.integer({ min: 0, max: 5 }), p: fc.integer({ min: 0, max: 5 }), g: fc.array(fc.integer({ min: 0, max: 8 }), { maxLength: 4 }) }), { minLength: 0, maxLength: 14 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 8000 }),
        fc.integer(),
        (raw, n, max, seed) => {
          const cs = raw.map((x, i) => ({ id: `c${i}`, score: x.score, cuisine: CUISINES[x.c]!, mainProtein: PROTEINS[x.p]!, ingredientIds: x.g.map((g) => `g${g}`) }));
          const cost: SetCost = (ids) => ids.reduce((t, id) => t + 300 + (Number(id.slice(1)) % 4) * 250, 0);
          const o = new Optimiser(cs, cost, { n, maxCents: max, seed, timeBudgetMs: Infinity, fruitlessLimit: 15 });
          for (const s of drain(o, 6)) {
            expect(s.ids).toHaveLength(n);
            expect(new Set(s.ids).size).toBe(n);
            expect(cost(s.ids)).toBeLessThanOrEqual(max);
            expect(withinCaps(s.ids.map((id) => cs.find((c) => c.id === id)!), defaultCap(n), defaultCap(n))).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("works with the grocery builder's marginal cost: a shared pack is bought once", () => {
    const ings: Record<string, GroceryIngredient> = {
      spinach: { id: "spinach", name: "spinach", category: "produce", freeUse: false, canonicalUnit: "g", allowedMeasures: ["weight"], defaultPackAmount: 300, defaultPackMeasure: "weight" } as GroceryIngredient,
      beef: { id: "beef", name: "beef", category: "meat", freeUse: false, canonicalUnit: "g", allowedMeasures: ["weight"] } as GroceryIngredient,
    };
    const recipes: Record<string, { servings: number; ingredients: Array<{ ingredientId: string; canonicalAmount: number; optional: boolean }> }> = {
      s1: { servings: 4, ingredients: [{ ingredientId: "spinach", canonicalAmount: 100, optional: false }] },
      s2: { servings: 4, ingredients: [{ ingredientId: "spinach", canonicalAmount: 100, optional: false }] },
      b1: { servings: 4, ingredients: [{ ingredientId: "beef", canonicalAmount: 500, optional: false }] },
    };
    const ctx: BuildContext = {
      recipes: (id) => recipes[id],
      ingredients: (id) => ings[id],
      supply: new Map(),
      incoming: new Map(),
      mappings: new Map(),
      rules: [],
      stores: [{ id: "pc", name: "PC", kind: "pcExpress", bulk: false }],
      prices: { estimates: { spinach: { priceCents: 500, packAmount: 300, packMeasure: "weight" }, beef: { priceCents: 1500, packAmount: 500, packMeasure: "weight" } } },
    };
    const cost: SetCost = (ids) => costOfNeeds(needsFor(ids.map((id) => ({ id, status: "planned", servings: 4, recipes: [{ recipeId: id, servingsMultiplier: 1 }] })), ctx), ctx).cents;
    expect(cost(["s1"])).toBe(500);
    expect(cost(["s1", "s2"])).toBe(500);
    const o = new Optimiser(
      [
        { id: "s1", score: 50, cuisine: "italian", mainProtein: "none", ingredientIds: ["spinach"] },
        { id: "s2", score: 50, cuisine: "greek", mainProtein: "none", ingredientIds: ["spinach"] },
        { id: "b1", score: 55, cuisine: "korean", mainProtein: "beef", ingredientIds: ["beef"] },
      ],
      cost,
      { n: 2, maxCents: 1000, seed: 5, timeBudgetMs: Infinity, fruitlessLimit: 30 },
    );
    expect(o.next()).toMatchObject({ ids: ["s1", "s2"], costCents: 500, shared: ["spinach"] });
  });

  it("prng is seeded and in [0, 1)", () => {
    const a = prng(9);
    const b = prng(9);
    for (let i = 0; i < 20; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
