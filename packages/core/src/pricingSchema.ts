// The price estimate file's schema (data/price-estimates.json), apart from pricing.ts so the pricing math carries no
// zod (M23: the plan worker imports the math only).
import { z } from "zod";
import { MEASURES } from "./taxonomy";

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

