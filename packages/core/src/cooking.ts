// Cooking, leftovers, reviews, projected supply, and staples cadence (PRD R4.3, R4.4, R4.9, R6.7–R6.10, R7.7,
// R9.1–R9.5; TECHNICAL_SPECS §6, §7, §8). Pure: functions and the web app share these.

import type { MealType, PlannableMealType } from "./taxonomy";
import { isPlannable, type Coverage, type RecipeRef } from "./plan";
import { needsFor, type BuildContext, type GroceryIngredient, type PlanItemInput, type RecipeLines, type SideRef } from "./grocery";
import { activeExpiry, EPS, isExpired, type LedgerLot } from "./ledger";

export type IngredientsOf = (id: string) => Pick<GroceryIngredient, "freeUse"> | undefined;
export type RecipesOf = BuildContext["recipes"];

/**
 * Canonical amounts a meal uses at `servings` (each recipe scaled by servings × multiplier ÷ its own servings, plus each
 * side's portion × servings), free-use, optional, and vague lines left out (R8.14, R9.3, R5.10).
 */
export function mealRequirements(refs: readonly RecipeRef[], servings: number, ctx: { recipes: RecipesOf; ingredients: IngredientsOf }, sides: readonly SideRef[] = []): Map<string, number> {
  return needsFor([{ id: "meal", status: "planned", servings, recipes: refs, sides }], ctx);
}

export interface LeftoverRecipe {
  defaultLeftoverPortions: number;
  leftoverMealType?: MealType | undefined;
}

/** Leftover portions a meal makes by meal type (each recipe's estimate, lunch by default; not scaled, §7). */
export function leftoverPortionsByType(refs: readonly RecipeRef[], recipeOf: (id: string) => LeftoverRecipe | undefined): Partial<Record<PlannableMealType, number>> {
  const out: Partial<Record<PlannableMealType, number>> = {};
  for (const r of refs) {
    const rec = recipeOf(r.recipeId);
    if (!rec || !(rec.defaultLeftoverPortions > 0)) continue;
    const t = rec.leftoverMealType && isPlannable(rec.leftoverMealType) ? rec.leftoverMealType : "lunch";
    out[t] = (out[t] ?? 0) + rec.defaultLeftoverPortions;
  }
  return out;
}

export function totalPortions(by: Partial<Record<PlannableMealType, number>>): number {
  return Object.values(by).reduce((a, b) => a + (b ?? 0), 0);
}

/** The meal type leftover portions fill: the type with the most portions (lunch when none). */
export function leftoverMealTypeOf(by: Partial<Record<PlannableMealType, number>>): PlannableMealType {
  let best: PlannableMealType = "lunch";
  let n = 0;
  for (const [t, c] of Object.entries(by) as Array<[PlannableMealType, number]>) if (c > n) [best, n] = [t, c];
  return best;
}

/** A cooked meal's own coverage: one slot of its type; leftovers become their own plan items (§7). */
export function cookedCoverage(mealType: MealType): Coverage {
  return isPlannable(mealType) ? { [mealType]: 1 } : {};
}

/**
 * Review corrections (R9.3, §6 submitReview): per ingredient, confirmed − already deducted. Positive = used more
 * (consume more), negative = used less (put back). Ingredients only in one list count as 0 in the other.
 */
export function reviewDeltas(deducted: ReadonlyMap<string, number>, confirmed: ReadonlyMap<string, number>): Array<{ ingredientId: string; delta: number }> {
  const ids = new Set([...deducted.keys(), ...confirmed.keys()]);
  const out: Array<{ ingredientId: string; delta: number }> = [];
  for (const id of [...ids].sort()) {
    const d = Math.round(((confirmed.get(id) ?? 0) - (deducted.get(id) ?? 0)) * 1e6) / 1e6;
    if (Math.abs(d) > EPS) out.push({ ingredientId: id, delta: d });
  }
  return out;
}

export function toMap(list: ReadonlyArray<{ ingredientId: string; canonicalAmount: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of list) m.set(u.ingredientId, (m.get(u.ingredientId) ?? 0) + u.canonicalAmount);
  return m;
}

// ---------- projected supply (R8.4, §6)

/** Unexpired supply per ingredient from supply docs' lots (expired lots excluded, R8.15). Leftover docs skipped. */
export function unexpiredByIngredient(docs: Iterable<{ ingredientId?: string | undefined; lots: readonly LedgerLot[] }>, nowMs: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of docs) {
    if (!d.ingredientId) continue;
    let s = 0;
    for (const l of d.lots) if (!isExpired(l, nowMs)) s += l.amount;
    m.set(d.ingredientId, (m.get(d.ingredientId) ?? 0) + s);
  }
  return m;
}

/** Projected = unexpired − requirements of planned, uncooked items in the current period (R8.4). May go negative. */
export function projectedSupply(unexpired: ReadonlyMap<string, number>, planned: readonly PlanItemInput[], ctx: { recipes: RecipesOf; ingredients: IngredientsOf }): Map<string, number> {
  const needs = needsFor(planned, ctx);
  const out = new Map(unexpired);
  for (const [id, n] of needs) out.set(id, (out.get(id) ?? 0) - n);
  return out;
}

export interface SupplyCoverage {
  /** Share of the recipe's tracked canonical amount that projected supply covers, 0..1 (0 when nothing is tracked). */
  fraction: number;
  /** Every tracked ingredient covered: "can make" (R4.3). */
  canMake: boolean;
  missing: string[];
}

/**
 * How well projected supply covers one recipe at its own servings (R4.3, R4.4). Free-use, optional, and vague lines
 * don't count. A recipe with nothing tracked (only free-use or vague lines) is neither "can make" nor "use what's left".
 */
export function supplyCoverage(lines: RecipeLines["ingredients"], projected: ReadonlyMap<string, number>, ingredientOf: (id: string) => Pick<GroceryIngredient, "freeUse"> | undefined): SupplyCoverage {
  let need = 0;
  let have = 0;
  const missing: string[] = [];
  const per = new Map<string, number>();
  for (const l of lines) {
    if (l.optional || l.canonicalAmount <= 0) continue;
    if (ingredientOf(l.ingredientId)?.freeUse) continue;
    per.set(l.ingredientId, (per.get(l.ingredientId) ?? 0) + l.canonicalAmount);
  }
  for (const [id, n] of per) {
    const p = Math.max(0, projected.get(id) ?? 0);
    need += n;
    have += Math.min(p, n);
    if (p + EPS < n) missing.push(id);
  }
  if (need <= 0) return { fraction: 0, canMake: false, missing };
  return { fraction: have / need, canMake: missing.length === 0, missing };
}

// ---------- expiry badges (R6.7, §7)

export interface ExpiringUse {
  ingredientId: string;
  expiresMs: number;
}

/**
 * The earliest-expiring unexpired lot a planned item would use (FEFO takes it first): among the item's ingredients
 * with supply, the soonest active expiry. Null when nothing it uses expires.
 */
export function earliestExpiringUse(needs: ReadonlyMap<string, number>, lotsOf: (ingredientId: string) => readonly LedgerLot[] | undefined, nowMs: number): ExpiringUse | null {
  let best: ExpiringUse | null = null;
  for (const id of needs.keys()) {
    for (const l of lotsOf(id) ?? []) {
      if (l.amount <= EPS || isExpired(l, nowMs)) continue;
      const e = activeExpiry(l);
      if (e !== null && (!best || e < best.expiresMs)) best = { ingredientId: id, expiresMs: e };
    }
  }
  return best;
}

/**
 * The Plan list's default order (M9, R6.24): fractional days until the soonest unexpired lot a planned meal would use
 * expires (`earliestExpiringUse`), or null when it uses nothing that expires. Sorting by it ascending, nulls last and
 * ties by the previous order (the suggestion score), puts the meal to make first at the top.
 */
export function soonestUseDays(needs: ReadonlyMap<string, number>, lotsOf: (ingredientId: string) => readonly LedgerLot[] | undefined, nowMs: number): { days: number; ingredientId: string } | null {
  const e = earliestExpiringUse(needs, lotsOf, nowMs);
  return e ? { days: (e.expiresMs - nowMs) / 86_400_000, ingredientId: e.ingredientId } : null;
}

// ---------- pending reviews (R9.4)

/** How long another member keeps being asked to add their rating. */
export const RATE_PROMPT_DAYS = 7;

export interface ReviewableEvent {
  id: string;
  reviewStatus: "pending" | "done";
  ratedBy: readonly string[];
  cookedAtMs: number;
}

/** Cook events still waiting for a review, or (within a week) for my rating. Newest first. */
export function pendingReviews<T extends ReviewableEvent>(events: readonly T[], uid: string, nowMs: number): Array<T & { reason: "review" | "rate" }> {
  const out: Array<T & { reason: "review" | "rate" }> = [];
  for (const e of events) {
    if (e.reviewStatus === "pending") out.push({ ...e, reason: "review" });
    else if (!e.ratedBy.includes(uid) && nowMs - e.cookedAtMs < RATE_PROMPT_DAYS * 86_400_000) out.push({ ...e, reason: "rate" });
  }
  return out.sort((a, b) => b.cookedAtMs - a.cookedAtMs);
}
