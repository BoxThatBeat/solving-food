import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  costFactor,
  DEFAULT_WEIGHTS,
  emptyScoreContext,
  expiringSpare,
  expiryUrgency,
  FACTOR_KEYS,
  FACTORS,
  historicalPref,
  meetsProteinGoal,
  missingIngredients,
  PRESETS,
  presetOf,
  preferencesFactor,
  proteinGoal,
  rank,
  ratingFactor,
  recentlyCooked,
  recipeNeeds,
  resolveWeights,
  sameCuisine,
  sameProtein,
  score,
  suggest,
  supplyUtilisation,
  tally,
  variety,
  type ScoreContext,
  type ScoreRecipe,
  type Weights,
} from "./index";
import type { LedgerLot } from "../ledger";

const DAY = 86_400_000;
const TZ = "America/Toronto";
const NOW = Date.UTC(2026, 9, 10, 16); // Sat 10 Oct 2026, noon in Toronto

function recipe(id: string, over: Partial<ScoreRecipe> = {}): ScoreRecipe {
  return {
    id,
    title: id,
    cuisine: "italian",
    mainProtein: "chicken",
    tags: ["dinner"],
    ingredientIds: Object.keys(over.lines ?? { pasta: 100 }),
    servings: 4,
    proteinPerServingG: 30,
    tools: [],
    lines: { pasta: 100 },
    ...over,
  };
}

const META: Record<string, { category: string; name: string; freeUse?: boolean }> = {
  "salmon-fillet": { category: "fish", name: "salmon fillet" },
  pasta: { category: "grains", name: "pasta" },
  spinach: { category: "produce", name: "baby spinach" },
  "olive-oil": { category: "pantry", name: "olive oil", freeUse: true },
  olives: { category: "produce", name: "olives" },
  "chicken-breast": { category: "meat", name: "chicken breast" },
  rice: { category: "grains", name: "rice" },
};

function ctx(over: Partial<ScoreContext> = {}): ScoreContext {
  return emptyScoreContext({ nowMs: NOW, ingredient: (id) => META[id], remainingBudgetCents: 100_00, ...over });
}

describe("factors stay in [0, 1]", () => {
  const arbRecipe = fc.record({
    id: fc.constantFrom("a", "b", "c"),
    title: fc.string(),
    cuisine: fc.constantFrom("italian", "indian", "other"),
    mainProtein: fc.constantFrom("chicken", "fish", "none"),
    tags: fc.array(fc.constantFrom("dinner", "lunch", "breakfast", "quick")),
    ingredientIds: fc.constant([] as string[]),
    servings: fc.integer({ min: 1, max: 12 }),
    proteinPerServingG: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: null }),
    lines: fc.dictionary(fc.constantFrom("salmon-fillet", "pasta", "spinach", "olive-oil"), fc.double({ min: 0, max: 2000, noNaN: true })),
  });
  const arbCtx = fc.record({
    servings: fc.integer({ min: 1, max: 12 }),
    projected: fc.dictionary(fc.constantFrom("salmon-fillet", "pasta", "spinach"), fc.double({ min: -500, max: 5000, noNaN: true })),
    expiring: fc.dictionary(fc.constantFrom("salmon-fillet", "pasta", "spinach"), fc.record({ amount: fc.double({ min: 0.01, max: 3000, noNaN: true }), daysLeft: fc.integer({ min: 0, max: 30 }) })),
    timesCooked: fc.integer({ min: 0, max: 100 }),
    daysAgo: fc.option(fc.double({ min: 0, max: 400, noNaN: true }), { nil: null }),
    ratingSum: fc.integer({ min: 0, max: 200 }),
    ratingCount: fc.integer({ min: 0, max: 20 }),
    planned: fc.integer({ min: 0, max: 6 }),
    recent: fc.integer({ min: 0, max: 20 }),
    goal: fc.option(fc.integer({ min: 1, max: 80 }), { nil: undefined }),
    cost: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
    remaining: fc.integer({ min: -5000, max: 50_000 }),
  });

  it("every factor of every recipe, in every context", () => {
    fc.assert(
      fc.property(arbRecipe, arbCtx, (r0, x) => {
        const r = { ...r0, ingredientIds: Object.keys(r0.lines) };
        const c = ctx({
          servings: x.servings,
          projected: new Map(Object.entries(x.projected)),
          expiring: new Map(Object.entries(x.expiring).map(([k, v]) => [k, { ...v, expiresMs: NOW + v.daysLeft * DAY }])),
          stats: new Map([[r.id, { timesCooked: x.timesCooked, lastCookedAtMs: x.daysAgo === null ? null : NOW - x.daysAgo * DAY, ratingSum: Math.min(x.ratingSum, x.ratingCount * 10), ratingCount: x.ratingCount }]]),
          plannedProteins: new Map([[r.mainProtein, x.planned]]),
          plannedCuisines: new Map([[r.cuisine, x.planned]]),
          recentCuisines: new Map([[r.cuisine, Math.min(x.recent, x.recent)]]),
          recentProteins: new Map([[r.mainProtein, x.recent]]),
          recentTotal: x.recent,
          proteinGoals: x.goal ? { dinner: x.goal } : {},
          costOf: () => x.cost,
          remainingBudgetCents: x.remaining,
        });
        const res = score(r, c, DEFAULT_WEIGHTS);
        for (const k of FACTOR_KEYS) {
          const v = res.factors[k];
          if (v === undefined) continue;
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
      }),
      { numRuns: 300 },
    );
  });
});

describe("weights", () => {
  it("resolves stored weights: clamps, rounds, ignores unknown keys, defaults to Balanced", () => {
    const w = resolveWeights({ cost: 9, rating: -2, variety: 2.6, bogus: 3 });
    expect(w.cost).toBe(5);
    expect(w.rating).toBe(0);
    expect(w.variety).toBe(3);
    expect(w.expiryUrgency).toBe(PRESETS.Balanced.expiryUrgency);
    expect("bogus" in w).toBe(false);
    expect(resolveWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
  });

  it("names presets and Custom", () => {
    expect(presetOf(PRESETS["Use it up"])).toBe("Use it up");
    expect(presetOf({ ...PRESETS.Balanced, cost: 0 })).toBe("Custom");
  });

  it("has one entry per factor with a sign", () => {
    expect(FACTORS.map((f) => f.key)).toEqual([...FACTOR_KEYS]);
    expect(FACTORS.filter((f) => f.sign < 0).map((f) => f.key)).toEqual(["missingIngredients", "cost", "sameProtein", "sameCuisine", "recentlyCooked"]);
  });

  it("raw score is monotone in every weight (property)", () => {
    const r = recipe("r", { lines: { "salmon-fillet": 150, spinach: 50 }, ingredientIds: ["salmon-fillet", "spinach"] });
    const c = ctx({
      projected: new Map([["salmon-fillet", 300]]),
      expiring: new Map([["salmon-fillet", { amount: 300, daysLeft: 2, expiresMs: NOW + 2 * DAY }]]),
      stats: new Map([["r", { timesCooked: 3, lastCookedAtMs: NOW - 10 * DAY, ratingSum: 16, ratingCount: 2 }]]),
      plannedProteins: new Map([["chicken", 1]]),
      plannedCuisines: new Map([["italian", 2]]),
      proteinGoals: { dinner: 35 },
      costOf: () => 800,
      preferences: { likes: ["cuisine:italian"], dislikes: [], diets: [] },
    });
    const arbW = fc.record(Object.fromEntries(FACTOR_KEYS.map((k) => [k, fc.integer({ min: 0, max: 5 })])) as Record<keyof Weights, fc.Arbitrary<number>>);
    fc.assert(
      fc.property(arbW, fc.constantFrom(...FACTOR_KEYS), fc.integer({ min: 1, max: 5 }), (w, k, bump) => {
        const before = score(r, c, w as Weights).raw;
        const after = score(r, c, { ...(w as Weights), [k]: Math.min(5, w[k] + bump) }).raw;
        const sign = FACTORS.find((f) => f.key === k)!.sign;
        if (sign > 0) expect(after).toBeGreaterThanOrEqual(before - 1e-9);
        else expect(after).toBeLessThanOrEqual(before + 1e-9);
      }),
      { numRuns: 300 },
    );
  });

  it("raising a weight never drops a recipe below one that is worse on that factor and equal otherwise (property)", () => {
    const a = recipe("a", { lines: { "salmon-fillet": 150 }, ingredientIds: ["salmon-fillet"] });
    const b = recipe("b", { lines: { pasta: 150 }, ingredientIds: ["pasta"] });
    const c = ctx({ expiring: new Map([["salmon-fillet", { amount: 150, daysLeft: 1, expiresMs: NOW + DAY }]]), projected: new Map([["salmon-fillet", 150], ["pasta", 150]]) });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (we) => {
        const w = { ...DEFAULT_WEIGHTS, expiryUrgency: we };
        const ranked = rank([b, a], c, w).map((x) => x.id);
        if (we > 0) expect(ranked[0]).toBe("a");
      }),
    );
  });
});

describe("individual factors", () => {
  it("expiryUrgency: more of the spare, sooner, is more urgent", () => {
    const c = ctx({ expiring: new Map([["salmon-fillet", { amount: 300, daysLeft: 2, expiresMs: 0 }]]) });
    expect(expiryUrgency(new Map([["salmon-fillet", 300]]), c)).toBeCloseTo(0.6);
    expect(expiryUrgency(new Map([["salmon-fillet", 150]]), c)).toBeCloseTo(0.3);
    expect(expiryUrgency(new Map([["pasta", 300]]), c)).toBe(0);
    const today = ctx({ expiring: new Map([["salmon-fillet", { amount: 300, daysLeft: 0, expiresMs: 0 }]]) });
    expect(expiryUrgency(new Map([["salmon-fillet", 600]]), today)).toBe(1);
  });

  it("supplyUtilisation and missingIngredients from projected supply", () => {
    const c = ctx({ projected: new Map([["pasta", 400], ["spinach", 50]]) });
    const needs = new Map([["pasta", 400], ["spinach", 100]]);
    expect(supplyUtilisation(needs, c)).toBeCloseTo(450 / 500);
    expect(missingIngredients(needs, c)).toBeCloseTo(0.5);
    expect(supplyUtilisation(new Map(), c)).toBe(0);
    expect(missingIngredients(new Map(), c)).toBe(0);
  });

  it("recipeNeeds scales to the household's servings and skips free-use", () => {
    const r = recipe("r", { lines: { pasta: 100, "olive-oil": 10 } });
    expect([...recipeNeeds(r, ctx({ servings: 2 }))]).toEqual([["pasta", 200]]);
  });

  it("rating: Bayesian prior for unrated", () => {
    expect(ratingFactor(undefined)).toBeCloseTo(0.6);
    expect(ratingFactor({ timesCooked: 1, lastCookedAtMs: null, ratingSum: 10, ratingCount: 1 })).toBeCloseTo((10 + 12) / 3 / 10);
    expect(ratingFactor({ timesCooked: 9, lastCookedAtMs: null, ratingSum: 90, ratingCount: 9 })).toBeGreaterThan(0.9);
  });

  it("historicalPref grows with frequency and recency; favourites get a bonus", () => {
    const never = historicalPref(undefined, false, NOW);
    const often = historicalPref({ timesCooked: 10, lastCookedAtMs: NOW - 5 * DAY, ratingSum: 0, ratingCount: 0 }, false, NOW);
    const longAgo = historicalPref({ timesCooked: 10, lastCookedAtMs: NOW - 400 * DAY, ratingSum: 0, ratingCount: 0 }, false, NOW);
    expect(never).toBe(0);
    expect(often).toBeGreaterThan(longAgo);
    expect(historicalPref(undefined, true, NOW)).toBeCloseTo(0.4);
  });

  it("variety: novel recipes, cuisines, and proteins score higher", () => {
    const r = recipe("r");
    const fresh = variety(r, undefined, ctx());
    expect(fresh).toBe(1);
    const repetitive = variety(r, { timesCooked: 3, lastCookedAtMs: NOW - 3 * DAY, ratingSum: 0, ratingCount: 0 }, ctx({ recentCuisines: new Map([["italian", 4]]), recentProteins: new Map([["chicken", 4]]), recentTotal: 4 }));
    expect(repetitive).toBeLessThan(0.1);
  });

  it("preferences: likes matched by cuisine, protein, ingredient, or word", () => {
    const r = recipe("r", { lines: { "salmon-fillet": 100 }, ingredientIds: ["salmon-fillet"], cuisine: "japanese", mainProtein: "fish", title: "Miso salmon" });
    expect(preferencesFactor(r, ctx())).toBe(0);
    expect(preferencesFactor(r, ctx({ preferences: { likes: ["cuisine:japanese"], dislikes: [], diets: [] } }))).toBeCloseTo(0.6);
    expect(preferencesFactor(r, ctx({ preferences: { likes: ["cuisine:japanese", "protein:fish", "text:miso"], dislikes: [], diets: [] } }))).toBe(1);
  });

  it("proteinGoal: linear below the goal, skipped when off, by the recipe's meal tag", () => {
    const r = recipe("r", { proteinPerServingG: 20 });
    expect(proteinGoal(r, ctx())).toBeNull();
    expect(proteinGoal(r, ctx({ proteinGoals: { dinner: 40 } }))).toBeCloseTo(0.5);
    expect(proteinGoal(r, ctx({ proteinGoals: { dinner: 20 } }))).toBe(1);
    const bk = recipe("b", { tags: ["breakfast"], proteinPerServingG: 20 });
    expect(proteinGoal(bk, ctx({ proteinGoals: { breakfast: 20, dinner: 40 } }))).toBe(1);
    expect(proteinGoal(bk, ctx({ mealType: "dinner", proteinGoals: { breakfast: 20, dinner: 40 } }))).toBeCloseTo(0.5);
    expect(meetsProteinGoal(r, ctx({ proteinGoals: { dinner: 35 } }))).toBe(false);
    expect(meetsProteinGoal(r, ctx())).toBe(true);
  });

  it("cost: marginal cost against a quarter of what's left; over budget anything costing counts fully", () => {
    expect(costFactor(null, 100_00)).toBe(0);
    expect(costFactor(0, 100_00)).toBe(0);
    expect(costFactor(12_50, 100_00)).toBeCloseTo(0.5);
    expect(costFactor(1, -5)).toBe(1);
  });

  it("sameProtein / sameCuisine ignore the recipe itself, 'none' and 'other'", () => {
    const r = recipe("r");
    const c = ctx({ plannedProteins: new Map([["chicken", 2]]), plannedCuisines: new Map([["italian", 1]]), plannedRecipeIds: new Set(["r"]) });
    expect(sameProtein(r, c)).toBeCloseTo(0.5);
    expect(sameCuisine(r, c)).toBe(0);
    expect(sameProtein(recipe("x", { mainProtein: "none" }), ctx({ plannedProteins: new Map([["none", 5]]) }))).toBe(0);
  });

  it("recentlyCooked fades from 1 at a week to 0 at three weeks", () => {
    const s = (d: number) => ({ timesCooked: 1, lastCookedAtMs: NOW - d * DAY, ratingSum: 0, ratingCount: 0 });
    expect(recentlyCooked(undefined, NOW)).toBe(0);
    expect(recentlyCooked(s(3), NOW)).toBe(1);
    expect(recentlyCooked(s(14), NOW)).toBeCloseTo(0.5);
    expect(recentlyCooked(s(30), NOW)).toBe(0);
  });
});

describe("hard filters and ranking", () => {
  it("missing tools, dislikes, and diets block suggestions but stay in a sort (last)", () => {
    const ok = recipe("ok");
    const wok = recipe("wok", { tools: ["Wok"] });
    const olives = recipe("olives", { lines: { olives: 50, pasta: 100 }, ingredientIds: ["olives", "pasta"] });
    const meat = recipe("meat", { lines: { "chicken-breast": 200 }, ingredientIds: ["chicken-breast"] });
    const c = ctx({ tools: ["Dutch oven"], preferences: { likes: [], dislikes: ["ingredient:olives"], diets: ["vegetarian"] } });
    const ranked = rank([wok, olives, meat, ok].map((r) => (r.id === "ok" ? { ...r, mainProtein: "legumes" } : r)), c, DEFAULT_WEIGHTS);
    expect(ranked[0]!.id).toBe("ok");
    expect(ranked.slice(1).every((x) => x.blocked)).toBe(true);
    expect(ranked.find((x) => x.id === "wok")!.blocked).toBe("Needs Wok");
    expect(ranked.find((x) => x.id === "olives")!.blocked).toMatch(/Not vegetarian|Disliked/);
    expect(suggest([wok, olives, meat], c, DEFAULT_WEIGHTS)).toEqual([]);
  });

  it("no tools configured means nothing is filtered for tools", () => {
    expect(score(recipe("wok", { tools: ["Wok"] }), ctx(), DEFAULT_WEIGHTS).blocked).toBeNull();
  });

  it("exit criterion: with salmon expiring in two days, the top suggestion uses it", () => {
    const lots: LedgerLot[] = [{ lotId: "s1", amount: 340, location: "fridge", acquiredAtMs: NOW - 2 * DAY, expiresFreshMs: NOW + 2.5 * DAY }];
    const spare = expiringSpare(new Map([["salmon-fillet", lots]]), new Map(), NOW + 7 * DAY, NOW, TZ);
    expect(spare.get("salmon-fillet")!.amount).toBe(340);
    const salmon = recipe("salmon", { title: "Miso salmon", cuisine: "japanese", mainProtein: "fish", lines: { "salmon-fillet": 85, rice: 75 }, ingredientIds: ["salmon-fillet", "rice"], proteinPerServingG: 28 });
    const others = [
      recipe("favourite", { title: "Chicken parm", lines: { "chicken-breast": 150, pasta: 100 }, ingredientIds: ["chicken-breast", "pasta"], proteinPerServingG: 45 }),
      recipe("cheap", { title: "Pasta aglio", cuisine: "italian", mainProtein: "none", lines: { pasta: 120 }, ingredientIds: ["pasta"], proteinPerServingG: 12 }),
      recipe("pantry", { title: "Rice bowl", cuisine: "korean", mainProtein: "eggs", lines: { rice: 100 }, ingredientIds: ["rice"], proteinPerServingG: 18 }),
    ];
    const c = ctx({
      projected: new Map([["salmon-fillet", 340], ["rice", 2000], ["pasta", 500]]),
      expiring: new Map([...spare].map(([k, v]) => [k, v])),
      stats: new Map([["favourite", { timesCooked: 12, lastCookedAtMs: NOW - 9 * DAY, ratingSum: 90, ratingCount: 10 }]]),
      favourites: new Set(["favourite"]),
      proteinGoals: { dinner: 30 },
      costOf: (r) => (r.id === "favourite" ? 1400 : 200),
    });
    const top = suggest([...others, salmon], c, DEFAULT_WEIGHTS);
    expect(top[0]!.id).toBe("salmon");
    expect(top[0]!.reasons[0]).toMatchObject({ key: "expiryUrgency", tone: "expiry" });
    expect(top[0]!.reasons[0]!.label).toMatch(/^Uses salmon · 2d$/);
    expect(top[0]!.expiring).toMatchObject({ ingredientId: "salmon-fillet", daysLeft: 2 });
  });

  it("suggest leaves out planned recipes; why chips: top two raising and one lowering", () => {
    const a = recipe("a", { lines: { pasta: 100 } });
    const b = recipe("b");
    const c = ctx({ plannedRecipeIds: new Set(["a"]), plannedProteins: new Map([["chicken", 3]]), projected: new Map([["pasta", 1000]]) });
    const s = suggest([a, b], c, DEFAULT_WEIGHTS);
    expect(s.map((x) => x.id)).toEqual(["b"]);
    expect(s[0]!.reasons.filter((r) => r.tone !== "bad")).toHaveLength(2);
    expect(s[0]!.reasons.at(-1)).toMatchObject({ tone: "bad", label: "Another chicken" });
  });
});

describe("context helpers", () => {
  it("expiringSpare: planned use takes the soonest lots first; lots past the window or expired don't count", () => {
    const lots: LedgerLot[] = [
      { lotId: "old", amount: 200, location: "fridge", acquiredAtMs: 0, expiresFreshMs: NOW + 1 * DAY },
      { lotId: "mid", amount: 200, location: "fridge", acquiredAtMs: 0, expiresFreshMs: NOW + 3 * DAY },
      { lotId: "late", amount: 500, location: "fridge", acquiredAtMs: 0, expiresFreshMs: NOW + 30 * DAY },
      { lotId: "gone", amount: 100, location: "fridge", acquiredAtMs: 0, expiresFreshMs: NOW - DAY },
    ];
    const s = expiringSpare(new Map([["x", lots]]), new Map([["x", 250]]), NOW + 7 * DAY, NOW, TZ);
    expect(s.get("x")).toMatchObject({ amount: 150, lotIds: ["mid"] });
    expect(expiringSpare(new Map([["x", lots]]), new Map([["x", 900]]), NOW + 7 * DAY, NOW, TZ).has("x")).toBe(false);
  });

  it("tally counts proteins and cuisines", () => {
    const t = tally(["a", "b", "zz"], (id) => (id === "zz" ? undefined : { cuisine: "thai", mainProtein: id === "a" ? "fish" : "tofu" }));
    expect(t.total).toBe(2);
    expect(t.cuisines.get("thai")).toBe(2);
    expect(t.proteins.get("fish")).toBe(1);
  });
});
