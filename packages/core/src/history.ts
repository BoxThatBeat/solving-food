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
  /** What the list cost, cents: paid prices where a receipt gave them (M25), else the estimate at the time (R10.3). */
  cents: number;
  /** How much of `cents` was read from a receipt: "all" (every arrived line paid), "some", or "none" (estimates). */
  paid?: "all" | "some" | "none";
}

export interface PeriodRange {
  id: string;
  startMs: number;
  endMs: number;
  budgetCents: number;
}

/** A period's spend is "actual" when every list in it was paid from a receipt, "estimated" when none was. */
export type SpendBasis = "actual" | "estimated" | "mixed";

/**
 * Spend per period (R10.3, M25 R7.17): Σ of every grocery list confirmed as received during the period, at paid prices
 * where a receipt gave them and estimates elsewhere. Periods newest last; periods with no spend are included (so a
 * quiet week shows $0) and read "estimated".
 */
export function spendPerPeriod(lists: readonly ReceivedList[], periods: readonly PeriodRange[]): Array<PeriodRange & { cents: number; basis: SpendBasis }> {
  return [...periods]
    .sort((a, b) => a.startMs - b.startMs)
    .map((p) => {
      const inP = lists.filter((l) => l.receivedAtMs >= p.startMs && l.receivedAtMs < p.endMs);
      const all = inP.length > 0 && inP.every((l) => l.paid === "all");
      const none = inP.every((l) => (l.paid ?? "none") === "none");
      return { ...p, cents: inP.reduce((s, l) => s + l.cents, 0), basis: all ? "actual" : none ? "estimated" : "mixed" };
    });
}

/** A received list's spend for History (M25): its `spendCents` when a receipt was read, else the estimate. */
export function listSpend(l: { receivedCents?: number | undefined; spendCents?: number | undefined; paidCents?: number | undefined; paidComplete?: boolean | undefined; items: Readonly<Record<string, { estPriceCents?: number | null }>> }): { cents: number; paid: "all" | "some" | "none" } {
  const est = l.receivedCents ?? Object.values(l.items).reduce((a, it) => a + (it.estPriceCents ?? 0), 0);
  if (l.spendCents === undefined || !l.paidCents) return { cents: est, paid: "none" };
  return { cents: l.spendCents, paid: l.paidComplete ? "all" : "some" };
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
