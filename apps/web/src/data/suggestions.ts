// Suggestions (PRD R6.11, R6.12, R6.16, §3 step 1; TECHNICAL_SPECS §7): one scoring worker per signed-in shell, fed a
// snapshot of the household's plan, supply, stats, preferences, and weights, debounced 300 ms after any change. Pages
// that need scores (the Plan page's Suggested row, the Suggested sort in every <CollectionView>, expiry alerts, the
// optimiser) call `useSuggestions()`; the engine only runs while at least one of them is mounted.
import { activeGoals, nutritionOf } from "./nutrition";
import * as React from "react";
import { addLocalDays, VARIETY_PERIODS, type MealType, type RecipeLines, type ScoreResult } from "@solving-food/core";
import { useFavourites, useStats } from "./householdRecipes";
import { millis } from "./plan";
import type { PlanModel } from "./planModel";
import { useCookEvents } from "./supply";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import type { ScoringSnapshot, SnapshotIngredient } from "@/workers/snapshot";

export interface SuggestionsState {
  /** Every recipe's result, ranked best first (blocked ones last); null until the first run. */
  ranked: ScoreResult[] | null;
  byId: ReadonlyMap<string, ScoreResult>;
  /** The latest snapshot (the optimiser starts from it). */
  snapshot: ScoringSnapshot | null;
}

export const EMPTY: SuggestionsState = { ranked: null, byId: new Map(), snapshot: null };

export interface Ctx {
  state: SuggestionsState;
  subscribe: () => () => void;
}

export const SuggestionsContext = React.createContext<Ctx | null>(null);

/** Scores for the active household (null until ready). Mounting this starts the engine. */
export function useSuggestions(): SuggestionsState {
  const c = React.useContext(SuggestionsContext);
  const subscribe = c?.subscribe;
  React.useEffect(() => subscribe?.(), [subscribe]);
  return c?.state ?? EMPTY;
}

/** Builds the worker snapshot from the plan model and the household's facts. */
export function useScoringSnapshot(m: PlanModel, mealType: MealType | null = null): ScoringSnapshot | null {
  const summaries = useRecipeIndex();
  const stats = useStats(m.hid);
  const favourites = useFavourites(m.hid);
  const events = useCookEvents(m.hid);
  const household = m.household;
  const tz = household?.timezone ?? "America/Toronto";
  // `now` changes every minute; scores follow it every ten.
  const tick = Math.floor(m.supply.now / (10 * 60_000));
  return React.useMemo(() => {
    const now = tick * 10 * 60_000;
    if (!household || !summaries || !m.ready || m.supply.loading || events.docs === undefined) return null;
    const periodDays = household.periodDays;
    const windowStart = addLocalDays(now, -VARIETY_PERIODS * periodDays, tz);
    const recent = (events.docs ?? []).filter((e) => (millis(e.data.cookedAt) ?? 0) >= windowStart).flatMap((e) => e.data.recipeIds);
    const plannedRecipeIds = m.items.filter((i) => i.data.kind === "meal" && i.data.status !== "skipped").flatMap((i) => i.data.recipes.map((r) => r.recipeId));
    const extraLines: Array<[string, RecipeLines]> = [];
    const indexed = new Set(summaries.map((r) => r.id));
    for (const [id, r] of m.recipes) if (!indexed.has(id)) extraLines.push([id, { servings: r.servings, ingredients: r.ingredients.map((l) => ({ ingredientId: l.ingredientId, canonicalAmount: l.canonicalAmount, optional: l.optional })) }]);
    const ingredients: Array<[string, SnapshotIngredient]> = [...m.ingredients.values()].map((i) => [i.id, i as SnapshotIngredient]);
    const settings = household.settings;
    // Nutrition tracking off (M9, R6.27): no goal acts on the scores.
    const { proteinGoals, fibreGoals } = activeGoals(nutritionOf(settings));
    return {
      nowMs: now,
      servings: household.defaultServings,
      periodDays,
      mealType,
      recipes: summaries,
      extraLines,
      // Sides count as planned needs (spent and projected supply match the Plan page); ranking stays recipe-only.
      planned: m.items.map((i) => ({ id: i.id, status: i.data.status, servings: i.data.servings, recipes: i.data.recipes, sides: i.data.sides })),
      plannedRecipeIds,
      unexpired: [...m.unexpired],
      incoming: [...m.ctx.incoming],
      expiring: [...m.expiring].map(([id, e]) => [id, { amount: e.amount, daysLeft: e.daysLeft, expiresMs: e.expiresMs }]),
      stats: [...stats].map(([id, s]) => [id, { timesCooked: s.timesCooked, lastCookedAtMs: millis(s.lastCookedAt), ratingSum: s.ratingSum, ratingCount: s.ratingCount }]),
      favourites: [...favourites],
      recentRecipeIds: recent,
      preferences: { likes: settings?.preferences?.likes ?? [], dislikes: settings?.preferences?.dislikes ?? [], diets: settings?.preferences?.diets ?? [] },
      tools: settings?.tools ?? [],
      proteinGoals,
      fibreGoals,
      weights: settings?.scoreWeights ?? {},
      budgetCents: m.period?.budgetCents ?? household.budgetCents,
      ingredients,
      mappings: [...m.ctx.mappings],
      rules: [...m.ctx.rules],
      stores: [...m.ctx.stores],
      defaultStoreId: m.ctx.defaultStoreId,
      live: [...m.livePrices].map(([code, p]) => [code, { priceCents: p.priceCents, packAmount: p.packAmount, packMeasure: p.packMeasure, fetchedAtMs: p.fetchedAtMs }]),
    } satisfies ScoringSnapshot;
    }, [household, summaries, m.ready, m.supply.loading, m.items, m.recipes, m.ingredients, m.unexpired, m.ctx, m.expiring, m.livePrices, m.period?.budgetCents, stats, favourites, events.docs, mealType, tz, tick]);
}

