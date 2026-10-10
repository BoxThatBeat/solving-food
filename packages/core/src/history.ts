// History stats (PRD R10.1–R10.3; TECHNICAL_SPECS §12, Planning/M3 Phase C). Computed on the client from cook events,
// ratings, recipes, received grocery lists, and periods.

export interface HistoryEvent {
  id: string;
  recipeIds: readonly string[];
  titles: readonly string[];
  cookedAtMs: number;
}

export interface HistoryRating {
  cookEventId: string;
  targetType: "recipe" | "meal";
  targetId: string;
  score: number;
  uid: string;
}

/** Most-cooked recipes: count per recipe ID with its latest stored title, most first. */
export function mostCooked(events: readonly HistoryEvent[], limit = 5): Array<{ recipeId: string; title: string; count: number }> {
  const m = new Map<string, { title: string; count: number; last: number }>();
  for (const e of events) {
    e.recipeIds.forEach((id, i) => {
      const prev = m.get(id);
      const title = e.titles[i] ?? prev?.title ?? "Recipe";
      if (!prev) m.set(id, { title, count: 1, last: e.cookedAtMs });
      else m.set(id, { title: e.cookedAtMs >= prev.last ? title : prev.title, count: prev.count + 1, last: Math.max(prev.last, e.cookedAtMs) });
    });
  }
  return [...m.entries()]
    .map(([recipeId, v]) => ({ recipeId, title: v.title, count: v.count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Average recipe rating per cuisine (R10.3), highest first. Recipes with an unknown cuisine are skipped. */
export function avgRatingByCuisine(ratings: readonly HistoryRating[], cuisineOf: (recipeId: string) => string | undefined): Array<{ cuisine: string; avg: number; count: number }> {
  const m = new Map<string, { sum: number; n: number }>();
  for (const r of ratings) {
    if (r.targetType !== "recipe") continue;
    const c = cuisineOf(r.targetId);
    if (!c) continue;
    const o = m.get(c) ?? { sum: 0, n: 0 };
    o.sum += r.score;
    o.n++;
    m.set(c, o);
  }
  return [...m.entries()].map(([cuisine, v]) => ({ cuisine, avg: v.sum / v.n, count: v.n })).sort((a, b) => b.avg - a.avg || a.cuisine.localeCompare(b.cuisine));
}

/** Average score of one cook event's ratings (all targets, all members), or null. */
export function eventAverage(ratings: readonly HistoryRating[]): number | null {
  if (!ratings.length) return null;
  return ratings.reduce((s, r) => s + r.score, 0) / ratings.length;
}

export interface ReceivedList {
  receivedAtMs: number;
  /** Σ estimated cost of what arrived, cents (prices known at the time, R10.3). */
  cents: number;
}

export interface PeriodRange {
  id: string;
  startMs: number;
  endMs: number;
  budgetCents: number;
}

/**
 * Spend per period (R10.3): Σ estimated cost of every grocery list confirmed as received during the period. Periods
 * newest last; periods with no spend are included (so a quiet week shows $0).
 */
export function spendPerPeriod(lists: readonly ReceivedList[], periods: readonly PeriodRange[]): Array<PeriodRange & { cents: number }> {
  return [...periods]
    .sort((a, b) => a.startMs - b.startMs)
    .map((p) => ({ ...p, cents: lists.filter((l) => l.receivedAtMs >= p.startMs && l.receivedAtMs < p.endMs).reduce((s, l) => s + l.cents, 0) }));
}

/**
 * Deviations from the recipe (R10.1): differences between what the recipe called for and what the review confirmed,
 * per ingredient. Differences within 1 % are noise.
 */
export function deviations(defaults: ReadonlyArray<{ ingredientId: string; canonicalAmount: number }>, confirmed: ReadonlyArray<{ ingredientId: string; canonicalAmount: number }>): Array<{ ingredientId: string; delta: number }> {
  const a = new Map<string, number>();
  for (const d of defaults) a.set(d.ingredientId, (a.get(d.ingredientId) ?? 0) + d.canonicalAmount);
  const b = new Map<string, number>();
  for (const d of confirmed) b.set(d.ingredientId, (b.get(d.ingredientId) ?? 0) + d.canonicalAmount);
  const out: Array<{ ingredientId: string; delta: number }> = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? 0;
    const y = b.get(id) ?? 0;
    const d = y - x;
    if (Math.abs(d) <= Math.max(x, y) * 0.01 + 1e-9) continue;
    out.push({ ingredientId: id, delta: d });
  }
  return out.sort((p, q) => p.ingredientId.localeCompare(q.ingredientId));
}
