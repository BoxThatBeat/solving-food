// The bundled price estimates (data/price-estimates.json, TECHNICAL_SPECS §8 "Prices"): validated once, no reads.
import { priceEstimatesFileSchema, type PriceEstimate } from "@solving-food/core";
import priceFile from "../../../../data/price-estimates.json";

export const PRICE_ESTIMATES: Readonly<Record<string, PriceEstimate>> = priceEstimatesFileSchema.parse(priceFile).estimates;

/** Cents per canonical unit from the estimate's precomputed value (recipe cost filter), null when unknown. */
export function estimateCentsPerUnit(ingredientId: string): number | null {
  return PRICE_ESTIMATES[ingredientId]?.centsPerUnit ?? null;
}
