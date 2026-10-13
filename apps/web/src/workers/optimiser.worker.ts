// "n dinners under $x" off the main thread (TECHNICAL_SPECS §7 "Optimiser"). `start` builds the candidates from a
// snapshot (scored, not blocked, not already planned, of the meal type, optionally meeting the protein goal) and
// returns the first good set; `next` continues the same search lazily.
import { meetsGoals, mealTypesOf, Optimiser, rank, type MealType, type OptimiserSet } from "@solving-food/core";
import { PRICE_ESTIMATES } from "@/data/prices";
import { buildContexts, type ScoringSnapshot } from "./snapshot";
import { SEED_INGREDIENTS } from "./seed";

export type OptimiserRequest =
  | { type: "start"; seq: number; snapshot: ScoringSnapshot; n: number; maxCents: number; mealType: MealType; proteinOnly: boolean; cuisineCap?: number; proteinCap?: number; seed?: number }
  | { type: "next"; seq: number };

export interface OptimiserResponse {
  seq: number;
  set: (OptimiserSet & { costs: Record<string, number | null> }) | null;
  exhausted: boolean;
  candidates: number;
}

let opt: Optimiser | null = null;
let costOf: ((id: string) => number | null) | null = null;

function reply(seq: number, set: OptimiserSet | null, candidates: number) {
  const r: OptimiserResponse = {
    seq,
    set: set ? { ...set, costs: Object.fromEntries(set.ids.map((id) => [id, costOf?.(id) ?? null])) } : null,
    exhausted: !set,
    candidates,
  };
  (self as unknown as Worker).postMessage(r);
}

let candidateCount = 0;

self.onmessage = (e: MessageEvent<OptimiserRequest>) => {
  const m = e.data;
  if (m.type === "start") {
    const c = buildContexts(m.snapshot, SEED_INGREDIENTS, PRICE_ESTIMATES);
    const ctx = { ...c.score, mealType: m.mealType };
    const pool = c.recipes.filter((r) => {
      if (ctx.plannedRecipeIds.has(r.id)) return false;
      const types = mealTypesOf(r);
      // Untagged recipes count as dinners.
      if (types.length ? !types.includes(m.mealType) : m.mealType !== "dinner") return false;
      return !m.proteinOnly || meetsGoals(r, ctx);
    });
    // Recipes that alone cost more than the whole budget can't be in any set: leave them out before taking the best 80.
    const ranked = rank(pool, ctx, c.weights, { dropBlocked: true })
      .filter((x) => (x.costCents ?? 0) <= m.maxCents)
      .slice(0, 80);
    candidateCount = ranked.length;
    costOf = (id) => ranked.find((x) => x.id === id)?.costCents ?? null;
    opt = new Optimiser(
      ranked.map((x) => {
        const r = c.byId.get(x.id)!;
        return { id: x.id, score: x.score, cuisine: r.cuisine, mainProtein: r.mainProtein, ingredientIds: [...c.needsOf(x.id).keys()] };
      }),
      c.setCost,
      { n: m.n, maxCents: m.maxCents, cuisineCap: m.cuisineCap, proteinCap: m.proteinCap, seed: m.seed ?? (Date.now() & 0xffff) },
    );
    reply(m.seq, opt.next(), candidateCount);
    return;
  }
  reply(m.seq, opt ? opt.next() : null, candidateCount);
};
