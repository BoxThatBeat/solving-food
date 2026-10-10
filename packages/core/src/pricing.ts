// Prices (PRD R6.21; TECHNICAL_SPECS §8 "Prices"). Everything is reduced to cents per canonical unit (per gram, or per
// piece for count-canonical ingredients). Resolution: live PC Express price for a mapped product (M5; fetched ≤ 14 days
// ago) → the bundled estimate (`data/price-estimates.json`) → unknown, which counts as $0 and is flagged on the meter.

import { z } from "zod";
import { MEASURES, type Measure } from "./taxonomy";
import { toCanonical, type ConvertibleIngredient } from "./units";

export const LIVE_PRICE_MAX_AGE_DAYS = 14;

export const priceEstimateSchema = z.object({
  priceCents: z.number().int().min(0),
  packAmount: z.number().positive(),
  packMeasure: z.enum(MEASURES),
  /** Cents per canonical unit from the seed ingredient's conversions; written by `pnpm prices:check -- --write`. */
  centsPerUnit: z.number().min(0).optional(),
});
export type PriceEstimate = z.infer<typeof priceEstimateSchema>;

export const priceEstimatesFileSchema = z.object({
  schemaVersion: z.literal(1),
  currency: z.literal("CAD"),
  region: z.string().optional(),
  estimates: z.record(z.string(), priceEstimateSchema),
});
export type PriceEstimatesFile = z.infer<typeof priceEstimatesFileSchema>;

/** The unit a pack measure is given in: grams, millilitres, or pieces. */
const BASE_UNIT: Record<Measure, string> = { weight: "g", volume: "ml", count: "count" };

/** A pack amount (grams / ml / pieces per `measure`) in the ingredient's canonical unit, or null without a conversion. */
export function packToCanonical(amount: number, measure: Measure, ingredient: ConvertibleIngredient): number | null {
  const r = toCanonical(amount, BASE_UNIT[measure], ingredient);
  return r.ok && r.canonicalAmount > 0 ? r.canonicalAmount : null;
}

export type PriceSource = "live" | "estimate" | "unknown";

export interface ResolvedPrice {
  /** Cents per canonical unit; null when unknown. */
  centsPerUnit: number | null;
  source: PriceSource;
}

export interface LivePrice {
  priceCents: number;
  packAmount: number;
  packMeasure: Measure;
  fetchedAtMs: number;
}

/**
 * `resolvePrice(ingredient, mapping?, livePrice?, estimates)`. Live prices only exist for mapped products with a
 * product code (M5), so in M2 this is always the estimate or unknown.
 */
export function resolvePrice(
  ingredient: ConvertibleIngredient & { id: string },
  mapping: { productCode?: string | undefined } | undefined,
  live: LivePrice | undefined,
  estimates: Readonly<Record<string, PriceEstimate>>,
  nowMs = Date.now(),
): ResolvedPrice {
  if (mapping?.productCode && live && nowMs - live.fetchedAtMs <= LIVE_PRICE_MAX_AGE_DAYS * 86_400_000) {
    const c = packToCanonical(live.packAmount, live.packMeasure, ingredient);
    if (c) return { centsPerUnit: live.priceCents / c, source: "live" };
  }
  const e = estimates[ingredient.id];
  if (e) {
    const c = packToCanonical(e.packAmount, e.packMeasure, ingredient);
    if (c) return { centsPerUnit: e.priceCents / c, source: "estimate" };
  }
  return { centsPerUnit: null, source: "unknown" };
}

/** "$67.19", "−$4.20" (CAD; the app has one currency). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(Math.round(cents)) / 100).toFixed(2)}`;
}

/**
 * Estimated cost per serving of a recipe from its summary lines (canonical amount per serving, non-optional, free-use
 * excluded by the caller), without pack rounding: the "Cost per serving" filter and the Cheapest sort (R4.2).
 * Null when any line's price is unknown.
 */
export function costPerServing(lines: Readonly<Record<string, number>>, centsPerUnit: (ingredientId: string) => number | null): number | null {
  let total = 0;
  for (const [id, amount] of Object.entries(lines)) {
    const c = centsPerUnit(id);
    if (c === null) return null;
    total += c * amount;
  }
  return Math.round(total);
}
