// The budget optimiser, "n dinners under $x" (PRD R6.18–R6.20, R6.16; TECHNICAL_SPECS §7 "Optimiser").
//
//   set score = Σ suggestion scores (0..1 each) + overlap bonus (ingredients shared by two or more recipes)
//               − penalties for a repeated cuisine or main protein − a small share of the cost
//   hard constraints: exactly n recipes, marginal cost ≤ x (the grocery builder's cost of the plan plus the set, minus
//               the plan alone: shared shortfall packs are bought once), ≤ cap per cuisine and per protein, and (with
//               the toggle) only recipes that meet the protein goal (the caller filters the candidates)
//   good set:   meets the constraints and scores ≥ GOOD_RATIO × the best set found so far
//   distinct:   recipe Jaccard similarity < 0.5 to every set already shown
//
// Search: greedy construction with randomised picks plus local-search swaps, from many starts (seeded PRNG, so tests
// are deterministic). `next()` keeps searching until it can show a new good set, or gives up after FRUITLESS_LIMIT
// attempts in a row that found nothing new, or after the time budget (the search continues on the next `next()`).
// Pure: no Firebase, no DOM; the web app runs it in a Web Worker.

import { jaccard } from "./dedupe";

export const GOOD_RATIO = 0.8;
export const JACCARD_MAX = 0.5;
export const FRUITLESS_LIMIT = 200;
export const OPTIMISER_TIME_BUDGET_MS = 2500;
const OVERLAP_BONUS = 0.15;
const OVERLAP_MAX = 4;
const REPEAT_PENALTY = 0.3;
const COST_WEIGHT = 0.5;
/** Attempts the first `next()` makes before showing anything, so the first set is a strong one. */
const WARMUP = 40;

export interface OptimiserCandidate {
  id: string;
  /** Suggestion score, 0..100. */
  score: number;
  cuisine: string;
  mainProtein: string;
  /** Tracked ingredient IDs it uses (overlap bonus). */
  ingredientIds: readonly string[];
}

export interface OptimiserOptions {
  n: number;
  /** The budget for the set, cents. */
  maxCents: number;
  /** At most this many recipes per cuisine / main protein; default ⌈n/2⌉ ("differ in cuisine and protein"). */
  cuisineCap?: number;
  proteinCap?: number;
  goodRatio?: number;
  jaccardMax?: number;
  fruitlessLimit?: number;
  /** Per `next()` call; Infinity in tests. */
  timeBudgetMs?: number;
  seed?: number;
  now?: () => number;
}

/** Marginal cost of adding these recipes to the plan, cents (unknown prices count as $0, like the budget meter). */
export type SetCost = (ids: readonly string[]) => number;

export interface OptimiserSet {
  ids: string[];
  costCents: number;
  setScore: number;
  /** Ingredients two or more of the recipes share. */
  shared: string[];
}

/** mulberry32: small, fast, seedable. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ingredients used by two or more of the recipes. */
export function sharedIngredients(cands: readonly OptimiserCandidate[]): string[] {
  const count = new Map<string, number>();
  for (const c of cands) for (const id of new Set(c.ingredientIds)) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

/** The set score without its cost term (used to compare swaps cheaply). */
export function baseSetScore(cands: readonly OptimiserCandidate[]): number {
  let s = 0;
  const cu = new Map<string, number>();
  const pr = new Map<string, number>();
  for (const c of cands) {
    s += Math.max(0, Math.min(100, c.score)) / 100;
    if (c.cuisine !== "other") cu.set(c.cuisine, (cu.get(c.cuisine) ?? 0) + 1);
    if (c.mainProtein !== "none") pr.set(c.mainProtein, (pr.get(c.mainProtein) ?? 0) + 1);
  }
  const repeats = [...cu.values(), ...pr.values()].reduce((t, n) => t + Math.max(0, n - 1), 0);
  return s + OVERLAP_BONUS * Math.min(OVERLAP_MAX, sharedIngredients(cands).length) - REPEAT_PENALTY * repeats;
}

export function setScore(cands: readonly OptimiserCandidate[], costCents: number, maxCents: number): number {
  return baseSetScore(cands) - COST_WEIGHT * (maxCents > 0 ? Math.min(1, costCents / maxCents) : 0);
}

export function defaultCap(n: number): number {
  return Math.max(1, Math.ceil(n / 2));
}

/** Do these recipes respect the per-cuisine and per-protein caps? */
export function withinCaps(cands: readonly OptimiserCandidate[], cuisineCap: number, proteinCap: number): boolean {
  const cu = new Map<string, number>();
  const pr = new Map<string, number>();
  for (const c of cands) {
    const a = (cu.get(c.cuisine) ?? 0) + 1;
    const b = (pr.get(c.mainProtein) ?? 0) + 1;
    if ((c.cuisine !== "other" && a > cuisineCap) || (c.mainProtein !== "none" && b > proteinCap)) return false;
    cu.set(c.cuisine, a);
    pr.set(c.mainProtein, b);
  }
  return true;
}

export class Optimiser {
  readonly n: number;
  readonly maxCents: number;
  readonly cuisineCap: number;
  readonly proteinCap: number;
  private readonly goodRatio: number;
  private readonly jaccardMax: number;
  private readonly fruitlessLimit: number;
  private readonly timeBudgetMs: number;
  private readonly now: () => number;
  private readonly rand: () => number;
  private readonly cands: OptimiserCandidate[];
  private readonly byId: Map<string, OptimiserCandidate>;
  private readonly costCache = new Map<string, number>();
  /** Every feasible set found, by key. */
  private readonly found = new Map<string, OptimiserSet>();
  private readonly shown: OptimiserSet[] = [];
  private best = -Infinity;
  private fruitless = 0;
  private attempts = 0;
  private done = false;

  constructor(candidates: readonly OptimiserCandidate[], private readonly setCost: SetCost, o: OptimiserOptions) {
    this.n = Math.max(1, Math.floor(o.n));
    this.maxCents = o.maxCents;
    this.cuisineCap = o.cuisineCap ?? defaultCap(this.n);
    this.proteinCap = o.proteinCap ?? defaultCap(this.n);
    this.goodRatio = o.goodRatio ?? GOOD_RATIO;
    this.jaccardMax = o.jaccardMax ?? JACCARD_MAX;
    this.fruitlessLimit = o.fruitlessLimit ?? FRUITLESS_LIMIT;
    this.timeBudgetMs = o.timeBudgetMs ?? OPTIMISER_TIME_BUDGET_MS;
    this.now = o.now ?? (() => Date.now());
    this.rand = prng(o.seed ?? 1);
    // Unique IDs, best first.
    const seen = new Set<string>();
    this.cands = [...candidates].filter((c) => !seen.has(c.id) && seen.add(c.id)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    this.byId = new Map(this.cands.map((c) => [c.id, c]));
    if (this.cands.length < this.n) this.done = true;
  }

  /** True once the search has given up: `next()` will only return null. */
  get exhausted(): boolean {
    return this.done && !this.pick();
  }

  get attemptCount(): number {
    return this.attempts;
  }

  private cost(ids: readonly string[]): number {
    const key = [...ids].sort().join("|");
    let c = this.costCache.get(key);
    if (c === undefined) {
      c = this.setCost([...ids].sort());
      this.costCache.set(key, c);
    }
    return c;
  }

  private feasible(ids: readonly string[]): boolean {
    return this.cost(ids) <= this.maxCents;
  }

  private cs(ids: readonly string[]): OptimiserCandidate[] {
    return ids.map((id) => this.byId.get(id)!);
  }

  /** One randomised greedy build plus local search. Returns a feasible set, or null. */
  private attempt(): OptimiserSet | null {
    this.attempts++;
    const chosen: string[] = [];
    const used = new Set<string>();
    // Random start, then greedy with noise among the top few by marginal base score.
    while (chosen.length < this.n) {
      const options: Array<{ id: string; v: number }> = [];
      for (const c of this.cands) {
        if (used.has(c.id)) continue;
        const next = [...chosen, c.id];
        if (!withinCaps(this.cs(next), this.cuisineCap, this.proteinCap)) continue;
        options.push({ id: c.id, v: baseSetScore(this.cs(next)) + this.rand() * 0.6 });
      }
      if (!options.length) return null;
      options.sort((a, b) => b.v - a.v);
      let placed = false;
      // Try the noisy top choices in order until one keeps the set under budget.
      const k = chosen.length === 0 ? Math.min(options.length, 1 + Math.floor(this.rand() * Math.min(8, options.length))) : 0;
      const order = k ? [options[k - 1]!, ...options.filter((_, i) => i !== k - 1)] : options;
      for (const o of order.slice(0, 25)) {
        if (this.feasible([...chosen, o.id])) {
          chosen.push(o.id);
          used.add(o.id);
          placed = true;
          break;
        }
      }
      if (!placed) return null;
    }
    // Local search: swap a member for an outsider when it raises the set score and stays feasible.
    let current = setScore(this.cs(chosen), this.cost(chosen), this.maxCents);
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let i = 0; i < chosen.length; i++) {
        const tries = this.sampleOutsiders(used, 12);
        for (const id of tries) {
          const next = chosen.slice();
          next[i] = id;
          const cands = this.cs(next);
          if (!withinCaps(cands, this.cuisineCap, this.proteinCap)) continue;
          if (baseSetScore(cands) <= current - COST_WEIGHT) continue; // can't win even at zero cost
          if (!this.feasible(next)) continue;
          const v = setScore(cands, this.cost(next), this.maxCents);
          if (v > current + 1e-9) {
            used.delete(chosen[i]!);
            used.add(id);
            chosen[i] = id;
            current = v;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    const ids = chosen.slice().sort();
    const cands = this.cs(ids);
    return { ids, costCents: this.cost(ids), setScore: setScore(cands, this.cost(ids), this.maxCents), shared: sharedIngredients(cands) };
  }

  private sampleOutsiders(used: ReadonlySet<string>, k: number): string[] {
    const pool = this.cands.filter((c) => !used.has(c.id));
    const out: string[] = [];
    // Bias towards the better candidates: the top third twice as often.
    for (let i = 0; i < k && pool.length; i++) {
      const top = this.rand() < 0.66 ? Math.max(1, Math.ceil(pool.length / 3)) : pool.length;
      const j = Math.floor(this.rand() * top);
      out.push(pool[j]!.id);
    }
    return [...new Set(out)];
  }

  /** The best found set that is good, not shown, and distinct from every shown set. */
  private pick(): OptimiserSet | null {
    let best: OptimiserSet | null = null;
    for (const s of this.found.values()) {
      if (s.setScore < this.goodThreshold()) continue;
      if (this.shown.some((x) => x.ids.join("|") === s.ids.join("|") || jaccard(x.ids, s.ids) >= this.jaccardMax)) continue;
      if (!best || s.setScore > best.setScore) best = s;
    }
    return best;
  }

  private goodThreshold(): number {
    // Scores can be negative in principle; "80 % of the best" only makes sense above zero.
    return this.best > 0 ? this.best * this.goodRatio : this.best;
  }

  /** The next good set (best first), or null when there are no more good combinations. */
  next(): OptimiserSet | null {
    if (this.done) {
      const p = this.pick();
      if (p) this.shown.push(p);
      return p;
    }
    const start = this.now();
    const warm = this.shown.length === 0 ? WARMUP : 0;
    let ran = 0;
    for (;;) {
      const candidate = ran >= warm ? this.pick() : null;
      if (candidate) {
        this.shown.push(candidate);
        return candidate;
      }
      if (this.fruitless >= this.fruitlessLimit) {
        this.done = true;
        const p = this.pick();
        if (p) this.shown.push(p);
        return p;
      }
      if (this.now() - start > this.timeBudgetMs) {
        // Out of time for this call: show what we have, else stop here (the user can relax and retry).
        const p = this.pick();
        if (p) {
          this.shown.push(p);
          return p;
        }
        this.done = true;
        return null;
      }
      const s = this.attempt();
      ran++;
      const key = s?.ids.join("|");
      if (s && key && !this.found.has(key)) {
        this.found.set(key, s);
        if (s.setScore > this.best) this.best = s.setScore;
        // Fruitful only when it could be shown: good and distinct from what's been shown.
        const showable = s.setScore >= this.goodThreshold() && !this.shown.some((x) => jaccard(x.ids, s.ids) >= this.jaccardMax);
        this.fruitless = showable ? 0 : this.fruitless + 1;
      } else this.fruitless++;
    }
  }

  /** Sets shown so far, in order (Back reads these). */
  get history(): readonly OptimiserSet[] {
    return this.shown;
  }
}
