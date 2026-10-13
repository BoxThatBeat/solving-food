// The suggestion score (PRD R6.11, R6.12, R6.16, §3 step 1; TECHNICAL_SPECS §7 "Suggestion score"):
//
//   raw(r)   = Σ wᵢ · fᵢ(r)  over raising factors  −  Σ wⱼ · fⱼ(r)  over lowering factors      each f ∈ [0, 1]
//   score(r) = round(100 · raw / Σ wᵢ over the raising factors that apply), clamped to 0..100 (the card's number)
//
// Ranking uses `raw`, which is monotone in every weight. Hard filters (missing kitchen tools, dislikes, diets) mark a
// recipe `blocked`: the Suggested row and the optimiser leave it out, and the Suggested sort lists it last.

import { formatCents } from "../pricing";
import { isSideOnly, taxonomyLabel } from "../collection";
import { toolLabel } from "../tools";
import { activeExpiry, isExpired, type LedgerLot } from "../ledger";
import { daysLeft as daysLeftOf } from "../expiry";
import { matchingPrefs, preferenceBlock, prefLabel } from "../preferences";
import {
  costFactor,
  daysSince,
  expiringUses,
  expiryUrgency,
  fibreGoal,
  historicalPref,
  missingIds,
  missingIngredients,
  missingToolsOf,
  preferencesFactor,
  proteinGoal,
  ratingFactor,
  recentlyCooked,
  recipeNeeds,
  sameCuisine,
  sameProtein,
  supplyUtilisation,
  variety,
  type ExpiringSpare,
  type ScoreContext,
  type ScoreRecipe,
} from "./factors";
import { FACTORS, type FactorKey, type Weights } from "./weights";

export * from "./factors";
export * from "./weights";

export interface Reason {
  key: FactorKey | "blocked";
  label: string;
  /** "expiry" chips are peach in the prototype, "good" accent, "bad" grey. */
  tone: "expiry" | "good" | "bad";
}

export interface ScoreResult {
  id: string;
  /** 0..100, what the card shows. */
  score: number;
  /** Ranking key: Σ w·f (raising) − Σ w·f (lowering). */
  raw: number;
  factors: Partial<Record<FactorKey, number>>;
  /** Why it's excluded from suggestions (missing tool, dislike, diet, a side dish), or null. */
  blocked: string | null;
  /** A side dish only (R4.28): blocked as a meal of its own, but fine inside a meal (combinedSuggestion ignores it). */
  side?: boolean;
  /** The top two raising factors and the strongest lowering one ("why" chips). */
  reasons: Reason[];
  /** Marginal cost at the household's servings (cents), null when unknown. */
  costCents: number | null;
  /** Soonest spare expiring ingredient it uses (for "Expiring first" and the alert row). */
  expiring: { ingredientId: string; daysLeft: number; used: number } | null;
}

const short = (ctx: ScoreContext, id: string) => (ctx.ingredient(id)?.name ?? id.replace(/-/g, " ")).split(/[,(]/)[0]!.trim();
const dl = (d: number) => (d <= 0 ? "today" : d === 1 ? "1d" : `${d}d`);

/** Scores one recipe. */
export function score(r: ScoreRecipe, ctx: ScoreContext, w: Weights): ScoreResult {
  const needs = recipeNeeds(r, ctx);
  const s = ctx.stats.get(r.id);
  const cost = ctx.costOf(r);
  const f: Partial<Record<FactorKey, number>> = {
    expiryUrgency: expiryUrgency(needs, ctx),
    supplyUtilisation: supplyUtilisation(needs, ctx),
    rating: ratingFactor(s),
    historicalPref: historicalPref(s, ctx.favourites.has(r.id), ctx.nowMs),
    variety: variety(r, s, ctx),
    preferences: preferencesFactor(r, ctx),
    missingIngredients: missingIngredients(needs, ctx),
    cost: costFactor(cost, ctx.remainingBudgetCents),
    sameProtein: sameProtein(r, ctx),
    sameCuisine: sameCuisine(r, ctx),
    recentlyCooked: recentlyCooked(s, ctx.nowMs),
  };
  const pg = proteinGoal(r, ctx);
  if (pg !== null) f.proteinGoal = pg;
  const fg = fibreGoal(r, ctx);
  if (fg !== null) f.fibreGoal = fg;

  let raw = 0;
  let max = 0;
  const contrib: Array<[FactorKey, number]> = [];
  for (const info of FACTORS) {
    const v = f[info.key];
    if (v === undefined) continue;
    const c = (w[info.key] ?? 0) * v;
    if (info.sign > 0) {
      raw += c;
      max += w[info.key] ?? 0;
    } else raw -= c;
    contrib.push([info.key, c * info.sign]);
  }

  const tools = missingToolsOf(r, ctx);
  const side = isSideOnly(r);
  const blocked = tools.length
    ? `Needs ${tools.map(toolLabel).join(", ")}`
    : (preferenceBlock(r, ctx.preferences, ctx.ingredient, (id) => ctx.ingredient(id)?.name) ?? (side ? "Side dish" : null));
  const uses = expiringUses(needs, ctx);
  const exp = uses[0] ?? null;

  const label = (k: FactorKey): string => {
    switch (k) {
      case "expiryUrgency":
        return exp ? `Uses ${short(ctx, exp.ingredientId)} · ${dl(exp.daysLeft)}` : "Uses expiring supply";
      case "supplyUtilisation":
        return `Have ${Math.round((f.supplyUtilisation ?? 0) * 100)}%`;
      case "rating":
        return s && s.ratingCount > 0 ? `★ ${(s.ratingSum / s.ratingCount).toFixed(1)}` : "Unrated";
      case "historicalPref":
        return ctx.favourites.has(r.id) && !(s?.timesCooked) ? "★ Favourite" : `Made ${s?.timesCooked ?? 0}×`;
      case "variety":
        return "Adds variety";
      case "preferences": {
        const m = matchingPrefs(r, ctx.preferences.likes, ctx.ingredient)[0];
        return m ? `You like ${prefLabel(m, (id) => ctx.ingredient(id)?.name)}` : "Matches your likes";
      }
      case "proteinGoal":
        return `${Math.round(r.proteinPerServingG ?? 0)} g protein`;
      case "fibreGoal":
        return `${Math.round(r.fibrePerServingG ?? 0)} g fibre`;
      case "missingIngredients": {
        const m = missingIds(needs, ctx).slice(0, 2).map((id) => short(ctx, id));
        return m.length ? `Missing ${m.join(", ")}` : "Missing some";
      }
      case "cost":
        return cost === null ? "Price unknown" : `+${formatCents(cost)}`;
      case "sameProtein":
        return `Another ${taxonomyLabel(r.mainProtein).toLowerCase()}`;
      case "sameCuisine":
        return `Another ${taxonomyLabel(r.cuisine)}`;
      case "recentlyCooked": {
        const d = daysSince(s?.lastCookedAtMs, ctx.nowMs);
        const n = d === null ? 0 : Math.floor(d);
        return n === 0 ? "Had it today" : n === 1 ? "Had it yesterday" : `Had it ${n} days ago`;
      }
    }
  };

  const reasons: Reason[] = [];
  if (blocked) reasons.push({ key: "blocked", label: blocked, tone: "bad" });
  // Expiry leads when it counts at all (R6.13: "shows it prominently"), then the strongest other raising factors.
  // Chips only for facts worth saying: no "Unrated" or "Made 0×".
  const sayable = (k: FactorKey) => !(k === "rating" && !(s && s.ratingCount > 0)) && !(k === "historicalPref" && !(s?.timesCooked) && !ctx.favourites.has(r.id));
  const pos = contrib.filter(([k, c]) => c > 0.05 && sayable(k)).sort((a, b) => (a[0] === "expiryUrgency" ? -1 : b[0] === "expiryUrgency" ? 1 : b[1] - a[1]));
  for (const [k] of pos.slice(0, 2)) reasons.push({ key: k, label: label(k), tone: k === "expiryUrgency" ? "expiry" : "good" });
  const neg = contrib.filter(([, c]) => c < -0.05).sort((a, b) => a[1] - b[1])[0];
  if (neg && !blocked) reasons.push({ key: neg[0], label: label(neg[0]), tone: "bad" });

  return {
    id: r.id,
    score: Math.max(0, Math.min(100, Math.round((raw / (max || 1)) * 100))),
    raw,
    factors: f,
    blocked,
    ...(side ? { side } : {}),
    reasons,
    costCents: cost,
    expiring: exp,
  };
}

/** Scores and ranks recipes best first; blocked ones last (or dropped with `dropBlocked`). Ties: title. */
export function rank(recipes: readonly ScoreRecipe[], ctx: ScoreContext, w: Weights, opts: { dropBlocked?: boolean } = {}): ScoreResult[] {
  const titles = new Map(recipes.map((r) => [r.id, r.title]));
  const out = recipes.map((r) => score(r, ctx, w)).filter((x) => !opts.dropBlocked || !x.blocked);
  return out.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || b.raw - a.raw || (titles.get(a.id) ?? "").localeCompare(titles.get(b.id) ?? ""));
}

/** The Plan page's Suggested row: not blocked, not already planned, best first. */
export function suggest(recipes: readonly ScoreRecipe[], ctx: ScoreContext, w: Weights, limit = 6): ScoreResult[] {
  return rank(
    recipes.filter((r) => !ctx.plannedRecipeIds.has(r.id)),
    ctx,
    w,
    { dropBlocked: true },
  ).slice(0, limit);
}

// ---------- context helpers

/**
 * Spare supply expiring by `untilMs` (the period's end, or a few days out if that's sooner than USE_SOON): per
 * ingredient, the amount in unexpired lots expiring by then minus what planned items will use (FEFO takes the
 * soonest lots first), with the soonest such lot's days left.
 */
export function expiringSpare(
  lotsByIngredient: ReadonlyMap<string, readonly LedgerLot[]>,
  plannedUse: ReadonlyMap<string, number>,
  untilMs: number,
  nowMs: number,
  tz: string,
): Map<string, ExpiringSpare & { lotIds: string[] }> {
  const out = new Map<string, ExpiringSpare & { lotIds: string[] }>();
  for (const [id, lots] of lotsByIngredient) {
    const live = lots
      .filter((l) => l.amount > 1e-9 && !isExpired(l, nowMs))
      .map((l) => ({ l, e: activeExpiry(l) }))
      .sort((a, b) => (a.e ?? Infinity) - (b.e ?? Infinity));
    let use = plannedUse.get(id) ?? 0;
    let amount = 0;
    let first: number | null = null;
    const lotIds: string[] = [];
    for (const { l, e } of live) {
      const take = Math.min(use, l.amount);
      use -= take;
      const left = l.amount - take;
      if (e === null || e > untilMs || left <= 1e-9) continue;
      amount += left;
      lotIds.push(l.lotId);
      if (first === null || e < first) first = e;
    }
    if (amount > 1e-9 && first !== null) out.set(id, { amount, expiresMs: first, daysLeft: Math.max(0, daysLeftOf(first, nowMs, tz)), lotIds });
  }
  return out;
}

/** Counts of main proteins and cuisines over a list of recipe IDs (planned meals, recent cooks). */
export function tally(ids: Iterable<string>, of: (id: string) => { cuisine: string; mainProtein: string } | undefined): { proteins: Map<string, number>; cuisines: Map<string, number>; total: number } {
  const proteins = new Map<string, number>();
  const cuisines = new Map<string, number>();
  let total = 0;
  for (const id of ids) {
    const r = of(id);
    if (!r) continue;
    total++;
    proteins.set(r.mainProtein, (proteins.get(r.mainProtein) ?? 0) + 1);
    cuisines.set(r.cuisine, (cuisines.get(r.cuisine) ?? 0) + 1);
  }
  return { proteins, cuisines, total };
}

/** A context with nothing in it (no supply, plan, stats, or preferences), for tests and fallbacks. */
export function emptyScoreContext(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    nowMs: Date.now(),
    servings: 4,
    mealType: null,
    periodDays: 7,
    projected: new Map(),
    expiring: new Map(),
    stats: new Map(),
    favourites: new Set(),
    plannedProteins: new Map(),
    plannedCuisines: new Map(),
    plannedRecipeIds: new Set(),
    recentCuisines: new Map(),
    recentProteins: new Map(),
    recentTotal: 0,
    preferences: { likes: [], dislikes: [], diets: [] },
    tools: [],
    proteinGoals: {},
    fibreGoals: {},
    ingredient: () => undefined,
    costOf: () => null,
    remainingBudgetCents: 0,
    ...overrides,
  };
}

/** The suggestion of a saved meal or plan item: the mean of its recipes' scores; blocked if any recipe is (M5), side dishes
 * excepted (M9). */
export function combinedSuggestion(recipeIds: readonly string[], byId: ReadonlyMap<string, ScoreResult>): { raw: number; score: number; blocked: boolean; expiryDays: number | null } | null {
  const rs = recipeIds.map((id) => byId.get(id)).filter((x): x is ScoreResult => !!x);
  if (!rs.length) return null;
  const days = rs.map((r) => (r.expiring ? r.expiring.daysLeft : null)).filter((d): d is number => d !== null);
  return {
    raw: rs.reduce((t, r) => t + r.raw, 0) / rs.length,
    score: Math.round(rs.reduce((t, r) => t + r.score, 0) / rs.length),
    // A side recipe in a meal with a main is fine (R4.28); a meal of nothing but sides is not a meal.
    blocked: rs.some((r) => !!r.blocked && !r.side) || rs.every((r) => !!r.side),
    expiryDays: days.length ? Math.min(...days) : null,
  };
}
