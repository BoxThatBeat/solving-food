// Nutrition tracking (PRD R6.26, R6.27, M9): the household's switch and its protein and fibre goals, from
// `households/{hid}.settings` (`nutrition`, `proteinGoals`, `fibreGoals`). Off hides every protein and fibre number,
// goal, bar, filter, sort, and optimiser option; goals and recipe data are kept, so switching back restores everything.
// Read through a context the signed-in shell provides (one household listener); signed-out pages show nutrition.
import * as React from "react";
import { withoutNutrition, type CollectionSearch, type HouseholdDoc, type MealType } from "@solving-food/core";

export type Goals = Partial<Record<MealType, number>>;

export interface Nutrition {
  /** Tracking on (the default when the household never set it). */
  on: boolean;
  proteinGoals: Goals;
  fibreGoals: Goals;
}

export const NUTRITION_ON: Nutrition = { on: true, proteinGoals: {}, fibreGoals: {} };

function goals(v: unknown): Goals {
  const out: Goals = {};
  for (const [k, g] of Object.entries((v ?? {}) as Record<string, unknown>)) if (typeof g === "number") out[k as MealType] = g;
  return out;
}

/** The household's nutrition settings; with tracking off the goals still come back (Settings shows them greyed). */
export function nutritionOf(settings: HouseholdDoc["settings"] | undefined | null): Nutrition {
  return { on: settings?.nutrition !== false, proteinGoals: goals(settings?.proteinGoals), fibreGoals: goals(settings?.fibreGoals) };
}

/** The goals that act on suggestions, the optimiser and the summaries: none while tracking is off. */
export function activeGoals(n: Nutrition): { proteinGoals: Goals; fibreGoals: Goals } {
  return n.on ? { proteinGoals: n.proteinGoals, fibreGoals: n.fibreGoals } : { proteinGoals: {}, fibreGoals: {} };
}

export const NutritionContext = React.createContext<Nutrition>(NUTRITION_ON);

export function useNutrition(): Nutrition {
  return React.useContext(NutritionContext);
}

/** A list's search as it applies: with tracking off, protein and fibre filters and sorts are dropped (R6.27). */
export function useNutritionSearch(): <T extends CollectionSearch>(s: T) => T {
  const { on } = useNutrition();
  return React.useCallback(<T extends CollectionSearch>(s: T): T => (on ? s : (withoutNutrition(s) as T)), [on]);
}
