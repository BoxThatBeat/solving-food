// Helpers for "Merge into…" (Planning/M8 item 2): the counts sentence and the suggestion hook.
import * as React from "react";
import { suggestIngredients, type IngredientIndex, type MergeReport } from "@solving-food/core";
import type { IngredientEntry } from "@/data/ingredients";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 recipes, 1 Supply row, 1 grocery list" — what a merge moves (or moved). */
export function describeMerge(r: Pick<MergeReport, "recipes" | "meals" | "supplyRows" | "planItems" | "groceryLists" | "householdDocs">): string {
  const parts = [
    r.recipes ? plural(r.recipes, "recipe") : "",
    r.supplyRows ? plural(r.supplyRows, "Supply row") : "",
    r.groceryLists ? plural(r.groceryLists, "grocery list") : "",
    r.planItems ? plural(r.planItems, "planned meal") : "",
    r.meals ? plural(r.meals, "saved meal") : "",
    r.householdDocs ? plural(r.householdDocs, "household setting") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing else uses it yet";
}

/** Suggested targets for a duplicate: the matcher's ranked candidates (M8 `suggestIngredients`). */
export function useSuggestions(from: IngredientEntry | undefined, index: IngredientIndex, max = 4) {
  return React.useMemo(() => (from ? suggestIngredients(from.name, index, max, { exclude: from.id }) : []), [from, index, max]);
}
