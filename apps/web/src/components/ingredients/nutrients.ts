// Nutrition facts per 100 g on an ingredient (M10, R4.30): form helpers shared by the ingredient editor and the
// new-ingredient form (<NutrientInputs>). Values are strings while editing; `nutrientsFrom()` builds the stored map.
import * as React from "react";
import { NUTRITION_KEYS, type NutritionKey, type Nutrients } from "@solving-food/core";
export type NutrientStrings = Record<NutritionKey, string>;

export function nutrientStrings(n: Nutrients | undefined): NutrientStrings {
  return Object.fromEntries(NUTRITION_KEYS.map((k) => [k, n?.[k] === undefined ? "" : String(n[k])])) as NutrientStrings;
}

/** The filled-in values (blank or invalid ones dropped), or undefined when none are. */
export function nutrientsFrom(v: NutrientStrings): Nutrients | undefined {
  const out: Nutrients = {};
  for (const k of NUTRITION_KEYS) {
    const n = Number(v[k]);
    if (v[k].trim() !== "" && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Keeps the source note while the numbers are unchanged; an edit marks them as entered in the app. */
export function nutrientSourceFor(before: Nutrients | undefined, beforeSource: string | undefined, after: Nutrients | undefined): string | undefined {
  if (!after) return undefined;
  if (JSON.stringify(before ?? null) === JSON.stringify(after) && beforeSource) return beforeSource;
  return "Entered in the app";
}

export const useNutrientStrings = (n: Nutrients | undefined) => React.useState<NutrientStrings>(() => nutrientStrings(n));
