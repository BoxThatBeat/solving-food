// The cook session of a planned meal (PRD R5.6, R9.7): its recipes, servings, saved meal and sides; Done cooking sends
// its plan item ID, so `finishCooking` marks it cooked. Used by /plan/:itemId/cook and, for a recipe or saved meal that
// is planned (M29), by /recipes/:id/cook and /meals/:id/cook.
import type { StoredPlanItem } from "@/data/plan";
import type { CookTarget } from "./CookSession";

export function planCookTarget(itemId: string, it: StoredPlanItem, title: string, where: { exitTo: string; path: string }): CookTarget {
  return {
    key: `plan-${itemId}`,
    title,
    kicker: "Meal",
    recipes: it.recipes,
    servings: it.servings,
    planItemId: itemId,
    savedMealId: it.savedMealId,
    mealType: it.mealType,
    sides: it.sides,
    ...where,
  };
}
