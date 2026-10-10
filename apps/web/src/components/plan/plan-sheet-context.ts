import * as React from "react";
import type { MealType } from "@solving-food/core";

export interface CreateMealRequest {
  /** Recipes to preselect (the "Add to plan" shortcut on a recipe, R5.7). */
  recipeIds?: string[];
  /** A saved meal to preselect ("Add to plan" on a meal). */
  savedMealId?: string;
  mealType?: MealType;
}

export interface PlanSheetCtx {
  openCreateMeal: (req?: CreateMealRequest) => void;
}

export const PlanSheetContext = React.createContext<PlanSheetCtx | null>(null);

/** Opens Create meal; undefined outside the signed-in shell (signed-out share pages can't plan). */
export function useCreateMeal(): PlanSheetCtx["openCreateMeal"] | undefined {
  return React.useContext(PlanSheetContext)?.openCreateMeal;
}

export const MEAL_LABEL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
