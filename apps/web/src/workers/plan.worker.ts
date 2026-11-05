// The plan worker (TECHNICAL_SPECS §7): suggestion scoring and the optimiser off the main thread, in one worker entry
// (M23: they were two near-identical ~500 kB bundles, both fetched on the Plan page). A message's `kind` picks the job;
// the suggestions engine and the optimiser sheet each run their own instance of this file. It imports core through
// focused subpaths (`@solving-food/core/scoring`, …) so nothing UI-only comes along, and the ingredient seed through a
// build-time virtual module that keeps only the fields scoring and costing read.
import { rank, meetsGoals, type ScoreResult } from "@solving-food/core/scoring";
import { Optimiser, type OptimiserSet } from "@solving-food/core/optimiser";
import { plannedMealTypesOf } from "@solving-food/core/collection";
import type { MealType } from "@solving-food/core";
import { PRICE_ESTIMATES } from "./prices";
import { buildContexts, type ScoringSnapshot } from "./snapshot";
import { SEED_INGREDIENTS } from "./seed";

export interface ScoringRequest {
  kind: "score";
  seq: number;
  snapshot: ScoringSnapshot;
}
export interface ScoringResponse {
  kind: "score";
  seq: number;
  ranked: ScoreResult[];
  ms: number;
}

export type OptimiserRequest =
  | { kind: "optimise"; type: "start"; seq: number; snapshot: ScoringSnapshot; n: number; maxCents: number; mealType: MealType; proteinOnly: boolean; cuisineCap?: number; proteinCap?: number; seed?: number }
  | { kind: "optimise"; type: "next"; seq: number };

export interface OptimiserResponse {
  kind: "optimise";
  seq: number;
  set: (OptimiserSet & { costs: Record<string, number | null> }) | null;
  exhausted: boolean;
  candidates: number;
}

export type PlanWorkerRequest = ScoringRequest | OptimiserRequest;

const post = (r: ScoringResponse | OptimiserResponse) => (self as unknown as Worker).postMessage(r);

// ---------- scoring: every recipe's ScoreResult, ranked (blocked last), for the latest snapshot only

function score(m: ScoringRequest): void {
  const t0 = performance.now();
  const c = buildContexts(m.snapshot, SEED_INGREDIENTS, PRICE_ESTIMATES);
  const ranked = rank(c.recipes, c.score, c.weights);
  post({ kind: "score", seq: m.seq, ranked, ms: Math.round(performance.now() - t0) });
}

// ---------- optimiser: "n dinners under $x". `start` builds the candidates from a snapshot (scored, not blocked, not
// already planned, of the meal type, optionally meeting the protein goal) and returns the first good set; `next`
// continues the same search lazily.

let opt: Optimiser | null = null;
let costOf: ((id: string) => number | null) | null = null;
let candidateCount = 0;

function reply(seq: number, set: OptimiserSet | null) {
  post({
    kind: "optimise",
    seq,
    set: set ? { ...set, costs: Object.fromEntries(set.ids.map((id) => [id, costOf?.(id) ?? null])) } : null,
    exhausted: !set,
    candidates: candidateCount,
  });
}

function optimise(m: OptimiserRequest): void {
  if (m.type === "next") {
    reply(m.seq, opt ? opt.next() : null);
    return;
  }
  const c = buildContexts(m.snapshot, SEED_INGREDIENTS, PRICE_ESTIMATES);
  const ctx = { ...c.score, mealType: m.mealType };
  const pool = c.recipes.filter((r) => {
    if (ctx.plannedRecipeIds.has(r.id)) return false;
    // M24: the meal types it's planned as (untagged recipes are dinners, desserts and appetizers snacks).
    if (!plannedMealTypesOf(r).includes(m.mealType)) return false;
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
  reply(m.seq, opt.next());
}

self.onmessage = (e: MessageEvent<PlanWorkerRequest>) => {
  if (e.data.kind === "score") score(e.data);
  else optimise(e.data);
};
