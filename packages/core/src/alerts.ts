// Expiry alerts (PRD R6.13; TECHNICAL_SPECS §7 "Expiry badges & alerts"): supply lots expiring within the period that
// no planned meal will use raise a card on the Plan page, with recipes that use more of it. A member can dismiss an
// alert for the rest of the period: the dismissed lot IDs live on the period document (`dismissedLots`).

import type { ExpiringSpare } from "./scoring/factors";
import type { ScoreRecipe } from "./scoring/factors";
import { expiringSpare } from "./scoring";
import { daysLeft } from "./expiry";
import { newLotFor } from "./projection";
import type { LedgerLot } from "./ledger";
import type { StorageLocation } from "./taxonomy";
import type { ShelfLife } from "./expiry";

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

// ---------- Use it up before ordering (M9, R6.25)

/** What the order check needs to know about an ingredient. */
export interface OrderIngredient {
  canonicalUnit: "g" | "count";
  defaultLocation: StorageLocation;
  shelfLifeDays?: ShelfLife | undefined;
  freeUse?: boolean | undefined;
}

export interface OrderSpare {
  ingredientId: string;
  /** Spare the order adds that no planned meal uses and that expires by `untilMs` (canonical). */
  amount: number;
  /** What the order buys of it (canonical). */
  bought: number;
  /** When the bought lot is expected to expire (bought now, in its default location). */
  expiresMs: number;
  daysLeft: number;
}

/**
 * "Use it up" before ordering (M9, R6.25): the same rule as the "Use it or lose it" alert (`expiringSpare`, R6.13),
 * applied to Supply as it will be once the next order arrives. Each plan line of the order becomes a lot bought now in
 * the ingredient's default location, expiring after its shelf life there; an ingredient is flagged when the order adds
 * spare (pack rounding, or more than the plan uses) that expires by `untilMs` and that no planned meal will use (FEFO
 * after the lots already in Supply). Free-use ingredients and ones that don't expire there are never flagged. Soonest
 * first, then the larger spare.
 */
export function orderSpare(
  lotsByIngredient: ReadonlyMap<string, readonly LedgerLot[]>,
  plannedUse: ReadonlyMap<string, number>,
  order: Iterable<{ ingredientId?: string | undefined; amount: number }>,
  ingredientOf: (id: string) => OrderIngredient | undefined,
  untilMs: number,
  nowMs: number,
  tz: string,
): OrderSpare[] {
  const bought = new Map<string, number>();
  for (const l of order) if (l.ingredientId && l.amount > 0) bought.set(l.ingredientId, (bought.get(l.ingredientId) ?? 0) + l.amount);
  const out: OrderSpare[] = [];
  for (const [id, amount] of bought) {
    const ing = ingredientOf(id);
    if (!ing || ing.freeUse) continue;
    const lot = newLotFor(`order-${id}`, amount, ing.defaultLocation, ing.shelfLifeDays, nowMs, tz);
    const expiresMs = lot.expiresFreshMs ?? null;
    if (expiresMs === null || expiresMs > untilMs) continue;
    const have = lotsByIngredient.get(id) ?? [];
    const use = new Map([[id, plannedUse.get(id) ?? 0]]);
    const before = expiringSpare(new Map([[id, have]]), use, untilMs, nowMs, tz).get(id)?.amount ?? 0;
    const after = expiringSpare(new Map([[id, [...have, lot]]]), use, untilMs, nowMs, tz).get(id)?.amount ?? 0;
    const spare = Math.min(amount, after - before);
    const min = ing.canonicalUnit === "count" ? ALERT_MIN_COUNT : ALERT_MIN_GRAMS;
    if (!(spare >= min)) continue;
    out.push({ ingredientId: id, amount: spare, bought: amount, expiresMs, daysLeft: Math.max(0, daysLeft(expiresMs, nowMs, tz)) });
  }
  return out.sort((a, b) => a.expiresMs - b.expiresMs || b.amount - a.amount || a.ingredientId.localeCompare(b.ingredientId));
}

/** The dismissal key of a use-it-up item on the period document (`dismissedLots`, shared with the expiry alerts). */
export const orderDismissKey = (ingredientId: string) => `order:${ingredientId}`;
