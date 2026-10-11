// Suggestion factors (PRD R6.11, R6.13, R6.16; TECHNICAL_SPECS §7 "Suggestion score"). One pure function per factor,
// each returning a value in [0, 1] (or null when the factor doesn't apply, e.g. no protein goal for the meal type).
// Amounts are canonical (g or count) at the household's servings. Everything here is Firebase-free and serialisable
// enough to run in a Web Worker: the web app builds a ScoreContext snapshot from its listeners.

import type { MealType } from "../taxonomy";
import { MEAL_TYPES } from "../taxonomy";
import { DAY_MS } from "../expiry";
import { missingTools } from "../collection";
import { matchingPrefs, type IngredientMetaOf, type PrefRecipe, type Preferences } from "../preferences";


/** A recipe as scoring sees it: the search index summary's fields (lines are canonical per serving). */
export interface ScoreRecipe extends PrefRecipe {
  id: string;
  servings: number;
  proteinPerServingG: number | null;
  tools?: readonly string[] | undefined;
  /** Canonical amount per serving by ingredient ID (non-optional lines). */
  lines?: Readonly<Record<string, number>> | undefined;
}

export interface RecipeStats {
  timesCooked: number;
  lastCookedAtMs: number | null;
  ratingSum: number;
  ratingCount: number;
}

/** Spare supply expiring within the period: lots no planned item will use (FEFO), per ingredient. */
export interface ExpiringSpare {
  amount: number;
  /** Whole days left on the soonest such lot (0 = last day). */
  daysLeft: number;
  expiresMs: number;
}

export interface ScoreContext {
  nowMs: number;
  /** Servings the household cooks (amounts are scaled to this). */
  servings: number;
  /** The meal type being planned, for the protein goal; null = each recipe's own meal tag (dinner by default). */
  mealType?: MealType | null;
  periodDays: number;
  /** Projected supply per ingredient (unexpired − what planned items will use). */
  projected: ReadonlyMap<string, number>;
  expiring: ReadonlyMap<string, ExpiringSpare>;
  stats: ReadonlyMap<string, RecipeStats>;
  favourites: ReadonlySet<string>;
  /** Main proteins and cuisines of the period's planned (and cooked) meals, counted per recipe. */
  plannedProteins: ReadonlyMap<string, number>;
  plannedCuisines: ReadonlyMap<string, number>;
  /** Recipes already in the plan (the Suggested row leaves them out). */
  plannedRecipeIds: ReadonlySet<string>;
  /** Cuisines and proteins of cook events in the variety window, counted. */
  recentCuisines: ReadonlyMap<string, number>;
  recentProteins: ReadonlyMap<string, number>;
  recentTotal: number;
  preferences: Preferences;
  tools: readonly string[];
  proteinGoals: Partial<Record<MealType, number>>;
  ingredient: IngredientMetaOf;
  /** What adding the recipe (at the household's servings) adds to the next order, cents; null when unknown. */
  costOf: (recipe: ScoreRecipe) => number | null;
  /** Budget left for the period (budget − spent), cents. */
  remainingBudgetCents: number;
}

/** Cooked within this many days counts fully as "recently cooked"; it fades out by RECENT_FADE_DAYS. */
export const RECENT_DAYS = 7;
export const RECENT_FADE_DAYS = 21;
/** Variety looks back this many periods. */
export const VARIETY_PERIODS = 4;
/** Rating prior for unrated recipes (Bayesian average): as if rated PRIOR_SCORE by PRIOR_WEIGHT people. */
export const PRIOR_SCORE = 6;
export const PRIOR_WEIGHT = 2;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Canonical amounts the recipe needs at the household's servings, free-use ingredients left out. */
export function recipeNeeds(r: ScoreRecipe, ctx: Pick<ScoreContext, "servings" | "ingredient">): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, per] of Object.entries(r.lines ?? {})) {
    if (!(per > 0) || ctx.ingredient(id)?.freeUse) continue;
    m.set(id, per * ctx.servings);
  }
  return m;
}

/** How much a lot expiring in `daysLeft` days matters: 1 on its last day, ½ with three days to go. */
export function urgencyWeight(daysLeft: number): number {
  return 1 / (1 + Math.max(0, daysLeft) / 3);
}

export interface ExpiryUse {
  ingredientId: string;
  used: number;
  daysLeft: number;
}

/** The spare expiring ingredients a recipe would use, soonest first. */
export function expiringUses(needs: ReadonlyMap<string, number>, ctx: Pick<ScoreContext, "expiring">): ExpiryUse[] {
  const out: ExpiryUse[] = [];
  for (const [id, need] of needs) {
    const e = ctx.expiring.get(id);
    if (!e || !(e.amount > 0)) continue;
    out.push({ ingredientId: id, used: Math.min(need, e.amount), daysLeft: e.daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || b.used - a.used);
}

/**
 * expiryUrgency: Σ over spare expiring ingredients of (share of the spare amount the recipe uses up) × urgency, capped
 * at 1. Using all 300 g of salmon on its last day is 1; using 100 g of a 1 kg bag with three days left is 0.05.
 */
export function expiryUrgency(needs: ReadonlyMap<string, number>, ctx: Pick<ScoreContext, "expiring">): number {
  let s = 0;
  for (const u of expiringUses(needs, ctx)) {
    const spare = ctx.expiring.get(u.ingredientId)!.amount;
    s += (u.used / spare) * urgencyWeight(u.daysLeft);
  }
  return clamp01(s);
}

/** supplyUtilisation: share of the recipe's tracked amount that projected supply covers. 0 when nothing is tracked. */
export function supplyUtilisation(needs: ReadonlyMap<string, number>, ctx: Pick<ScoreContext, "projected">): number {
  let need = 0;
  let have = 0;
  for (const [id, n] of needs) {
    need += n;
    have += Math.min(n, Math.max(0, ctx.projected.get(id) ?? 0));
  }
  return need > 0 ? clamp01(have / need) : 0;
}

/** Tracked ingredients projected supply doesn't fully cover. */
export function missingIds(needs: ReadonlyMap<string, number>, ctx: Pick<ScoreContext, "projected">): string[] {
  return [...needs].filter(([id, n]) => Math.max(0, ctx.projected.get(id) ?? 0) + 1e-9 < n).map(([id]) => id);
}

/** missingIngredients: share of tracked ingredients supply doesn't cover. */
export function missingIngredients(needs: ReadonlyMap<string, number>, ctx: Pick<ScoreContext, "projected">): number {
  return needs.size ? clamp01(missingIds(needs, ctx).length / needs.size) : 0;
}

/** rating: Bayesian household average / 10 (unrated = the prior, 0.6). */
export function ratingFactor(s: RecipeStats | undefined): number {
  const sum = (s?.ratingSum ?? 0) + PRIOR_SCORE * PRIOR_WEIGHT;
  const n = (s?.ratingCount ?? 0) + PRIOR_WEIGHT;
  return clamp01(sum / n / 10);
}

export function daysSince(ms: number | null | undefined, nowMs: number): number | null {
  return ms === null || ms === undefined ? null : Math.max(0, (nowMs - ms) / DAY_MS);
}

/** historicalPref: how often (saturating) × how lately it was made, plus a favourite bonus. */
export function historicalPref(s: RecipeStats | undefined, favourite: boolean, nowMs: number): number {
  const n = s?.timesCooked ?? 0;
  const freq = 1 - Math.exp(-n / 5);
  const d = daysSince(s?.lastCookedAtMs, nowMs);
  const recency = d === null ? 0 : Math.exp(-d / 120);
  return clamp01(freq * (0.4 + 0.6 * recency) + (favourite ? 0.4 : 0));
}

/**
 * variety: novelty against the last VARIETY_PERIODS periods: half for the recipe itself (1 if not cooked in the window,
 * else how far back), a quarter each for a cuisine and a main protein the household hasn't eaten much lately.
 */
export function variety(r: ScoreRecipe, s: RecipeStats | undefined, ctx: Pick<ScoreContext, "nowMs" | "periodDays" | "recentCuisines" | "recentProteins" | "recentTotal">): number {
  const window = Math.max(1, VARIETY_PERIODS * ctx.periodDays);
  const d = daysSince(s?.lastCookedAtMs, ctx.nowMs);
  const novelty = d === null || d >= window ? 1 : d / window;
  const share = (m: ReadonlyMap<string, number>, k: string) => (ctx.recentTotal > 0 ? (m.get(k) ?? 0) / ctx.recentTotal : 0);
  const cuisine = r.cuisine === "other" ? 0.5 : 1 - share(ctx.recentCuisines, r.cuisine);
  const protein = r.mainProtein === "none" ? 0.5 : 1 - share(ctx.recentProteins, r.mainProtein);
  return clamp01(0.5 * novelty + 0.25 * cuisine + 0.25 * protein);
}

/** preferences: likes matched (0 none, 0.6 one, 0.8 two, 1 three or more). */
export function preferencesFactor(r: ScoreRecipe, ctx: Pick<ScoreContext, "preferences" | "ingredient">): number {
  const m = matchingPrefs(r, ctx.preferences.likes, ctx.ingredient).length;
  return m === 0 ? 0 : clamp01(0.4 + 0.2 * m);
}

/** The meal type a recipe is scored for: the context's, else its first meal tag with a goal, else dinner. */
export function goalMealType(r: ScoreRecipe, ctx: Pick<ScoreContext, "mealType" | "proteinGoals">): MealType {
  if (ctx.mealType) return ctx.mealType;
  const tags = r.tags.map((t) => t.toLowerCase());
  const tagged = MEAL_TYPES.filter((t) => tags.includes(t));
  return tagged.find((t) => typeof ctx.proteinGoals[t] === "number") ?? tagged[0] ?? "dinner";
}

/** The protein goal (g per serving) that applies, or null when it's off. */
export function proteinGoalFor(r: ScoreRecipe, ctx: Pick<ScoreContext, "mealType" | "proteinGoals">): number | null {
  const g = ctx.proteinGoals[goalMealType(r, ctx)];
  return typeof g === "number" && g > 0 ? g : null;
}

/** proteinGoal: 1 at or above the goal, scaled down linearly below it; null (skipped) when the goal is off. */
export function proteinGoal(r: ScoreRecipe, ctx: Pick<ScoreContext, "mealType" | "proteinGoals">): number | null {
  const goal = proteinGoalFor(r, ctx);
  if (goal === null) return null;
  return clamp01((r.proteinPerServingG ?? 0) / goal);
}

/** True when the recipe meets the goal (or no goal applies): the optimiser's "meets protein goal" filter. */
export function meetsProteinGoal(r: ScoreRecipe, ctx: Pick<ScoreContext, "mealType" | "proteinGoals">): boolean {
  const goal = proteinGoalFor(r, ctx);
  return goal === null || (r.proteinPerServingG ?? 0) >= goal;
}

/**
 * cost: marginal cost against a quarter of the budget left (§7 "marginal cost / remaining budget"; the quarter makes a
 * typical dinner register instead of rounding to nothing). Over budget, anything that costs counts fully.
 */
export function costFactor(cents: number | null, remainingBudgetCents: number): number {
  if (cents === null || cents <= 0) return 0;
  if (remainingBudgetCents <= 0) return 1;
  return clamp01(cents / (remainingBudgetCents / 4));
}

/** sameProtein: other planned meals with the same main protein (two or more = 1). "none" never counts. */
export function sameProtein(r: ScoreRecipe, ctx: Pick<ScoreContext, "plannedProteins" | "plannedRecipeIds">): number {
  if (r.mainProtein === "none") return 0;
  const n = (ctx.plannedProteins.get(r.mainProtein) ?? 0) - (ctx.plannedRecipeIds.has(r.id) ? 1 : 0);
  return clamp01(n / 2);
}

/** sameCuisine: other planned meals with the same cuisine (two or more = 1). "other" never counts. */
export function sameCuisine(r: ScoreRecipe, ctx: Pick<ScoreContext, "plannedCuisines" | "plannedRecipeIds">): number {
  if (r.cuisine === "other") return 0;
  const n = (ctx.plannedCuisines.get(r.cuisine) ?? 0) - (ctx.plannedRecipeIds.has(r.id) ? 1 : 0);
  return clamp01(n / 2);
}

/** recentlyCooked: 1 within a week, fading to 0 at three weeks. Shares the stats lookup with variety. */
export function recentlyCooked(s: RecipeStats | undefined, nowMs: number): number {
  const d = daysSince(s?.lastCookedAtMs, nowMs);
  if (d === null) return 0;
  if (d <= RECENT_DAYS) return 1;
  return clamp01((RECENT_FADE_DAYS - d) / (RECENT_FADE_DAYS - RECENT_DAYS));
}

/** missingTools (hard filter): tools the recipe needs that the household doesn't list. Nothing when no tools are set. */
export function missingToolsOf(r: ScoreRecipe, ctx: Pick<ScoreContext, "tools">): string[] {
  if (!ctx.tools.length) return [];
  return missingTools(r.tools ?? [], ctx.tools);
}
