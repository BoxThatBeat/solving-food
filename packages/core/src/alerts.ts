// Expiry alerts (PRD R6.13; TECHNICAL_SPECS §7 "Expiry badges & alerts"): supply lots expiring within the period that
// no planned meal will use raise a card on the Plan page, with recipes that use more of it. A member can dismiss an
// alert for the rest of the period: the dismissed lot IDs live on the period document (`dismissedLots`).

import type { ExpiringSpare } from "./scoring/factors";
import type { ScoreRecipe } from "./scoring/factors";

export interface ExpiryAlert extends ExpiringSpare {
  ingredientId: string;
  lotIds: string[];
}

/** Below this much spare (g, or pieces for count ingredients) an alert isn't worth showing. */
export const ALERT_MIN_GRAMS = 10;
export const ALERT_MIN_COUNT = 0.5;

/**
 * The alerts to show: spare expiring supply (see `expiringSpare`) above a small threshold, not dismissed (an alert is
 * dismissed when all of its lots are), soonest first.
 */
export function expiryAlerts(
  spare: ReadonlyMap<string, ExpiringSpare & { lotIds: string[] }>,
  dismissedLots: ReadonlySet<string>,
  unitOf: (ingredientId: string) => "g" | "count" | undefined,
): ExpiryAlert[] {
  const out: ExpiryAlert[] = [];
  for (const [ingredientId, s] of spare) {
    const min = unitOf(ingredientId) === "count" ? ALERT_MIN_COUNT : ALERT_MIN_GRAMS;
    if (s.amount < min) continue;
    if (s.lotIds.length && s.lotIds.every((l) => dismissedLots.has(l))) continue;
    out.push({ ingredientId, ...s });
  }
  return out.sort((a, b) => a.expiresMs - b.expiresMs || b.amount - a.amount || a.ingredientId.localeCompare(b.ingredientId));
}

/**
 * Recipes that use an expiring ingredient, most of it first (R6.13 "suggests recipes that use more of it"): amount at
 * the household's servings, capped by the spare amount; ties by `tieBreak` (the suggestion score), then title.
 */
export function recipesUsing(
  ingredientId: string,
  spare: number,
  recipes: readonly ScoreRecipe[],
  servings: number,
  tieBreak: (id: string) => number = () => 0,
): Array<{ recipe: ScoreRecipe; uses: number }> {
  const out: Array<{ recipe: ScoreRecipe; uses: number }> = [];
  for (const r of recipes) {
    const per = r.lines?.[ingredientId];
    if (!per || per <= 0) continue;
    out.push({ recipe: r, uses: Math.min(spare, per * servings) });
  }
  return out.sort((a, b) => b.uses - a.uses || tieBreak(b.recipe.id) - tieBreak(a.recipe.id) || a.recipe.title.localeCompare(b.recipe.title));
}
