// Saved meals (PRD R5.1–R5.3, R5.8; TECHNICAL_SPECS §4.1 `meals`) and the summaries <CollectionView> lists them by
// (R4.7). A meal or plan item is listed as a RecipeSummary-shaped row so the shared filters and sorts apply as-is.

import type { RecipeSummary } from "./recipe";
import type { MealDoc, PlanItemDoc } from "./types";
import { MEAL_RECIPES_MAX } from "./types";
import type { RecipeRef } from "./plan";

export interface MealRow extends RecipeSummary {
  recipeIds: string[];
  /** Recipe IDs the index no longer has (trashed or deleted). */
  missing: string[];
}

function millis(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}

/** Combine recipe summaries into one row: tags and ingredients united, times summed, protein summed per serving. */
export function combineSummaries(id: string, title: string, refs: readonly RecipeRef[], byId: (id: string) => RecipeSummary | undefined, createdAtMs: number, extraTags: string[] = []): MealRow {
  const found = refs.map((r) => byId(r.recipeId)).filter((r): r is RecipeSummary => !!r);
  const first = found[0];
  const proteins = found.map((r) => r.proteinPerServingG);
  const hasProtein = found.length > 0 && proteins.every((p) => typeof p === "number");
  return {
    id,
    title,
    tags: [...new Set([...extraTags, ...found.flatMap((r) => r.tags)])],
    cuisine: first?.cuisine ?? "other",
    mainProtein: first?.mainProtein ?? "none",
    proteinPerServingG: hasProtein ? proteins.reduce<number>((a, b) => a + (b ?? 0), 0) : null,
    proteinApproximate: found.some((r) => r.proteinApproximate),
    ingredientIds: [...new Set(found.flatMap((r) => r.ingredientIds))],
    ingredientNames: [...new Set(found.flatMap((r) => r.ingredientNames))],
    totalMin: found.reduce((a, r) => a + r.totalMin, 0),
    activeMin: found.reduce((a, r) => a + r.activeMin, 0),
    servings: first?.servings ?? 1,
    thumb: found.find((r) => r.thumb)?.thumb ?? null,
    sourceUrlCanonical: null,
    fingerprint: "",
    createdAtMs,
    tools: [...new Set(found.flatMap((r) => r.tools ?? []))],
    lines: found.reduce<Record<string, number>>((acc, r) => {
      for (const [k, v] of Object.entries(r.lines ?? {})) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
    recipeIds: refs.map((r) => r.recipeId),
    missing: refs.filter((r) => !byId(r.recipeId)).map((r) => r.recipeId),
  };
}

export function mealRow(id: string, meal: Pick<MealDoc, "name" | "recipes" | "updatedAt" | "createdAt">, byId: (id: string) => RecipeSummary | undefined): MealRow {
  return combineSummaries(id, meal.name, meal.recipes, byId, millis(meal.createdAt ?? meal.updatedAt));
}

/** A plan item as a list row: its meal type is a tag, so the Meal type filter selects plan items by their slot. */
export function planItemRow(id: string, item: Pick<PlanItemDoc, "name" | "recipes" | "mealType" | "addedAt">, byId: (id: string) => RecipeSummary | undefined, title: string): MealRow {
  const row = combineSummaries(id, title, item.recipes, byId, millis(item.addedAt));
  // The slot it fills, not the recipes' own course tags.
  row.tags = [item.mealType, ...row.tags.filter((t) => !["breakfast", "lunch", "dinner", "snack"].includes(t.toLowerCase()))];
  return row;
}

/** The new saved meal document's content (the client adds timestamps). */
export function newMeal(name: string, recipes: readonly RecipeRef[], uid: string): Omit<MealDoc, "updatedAt" | "createdAt"> {
  return {
    name: name.trim(),
    recipes: recipes.slice(0, MEAL_RECIPES_MAX).map((r) => ({ recipeId: r.recipeId, servingsMultiplier: r.servingsMultiplier })),
    createdBy: uid,
    updatedBy: uid,
  };
}
