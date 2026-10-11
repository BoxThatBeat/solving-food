// PC Express shared shapes (PRD R6.21, R6.22, R7.10; TECHNICAL_SPECS §8 "Prices"): what the store and product search
// callables return, how a PC Express pack size reads ("400 g", "6x355 mL"), and the price document ID. The HTTP side
// lives in functions/src/pcx/ only; nothing here talks to PC Express.

import { z } from "zod";
import { DEFAULT_PCX_STORE_ID } from "./config";
import type { Measure } from "./taxonomy";

/** prices/{pcxStoreId}_{productCode}. */
export function priceDocId(pcxStoreId: string, productCode: string): string {
  return `${pcxStoreId}_${productCode}`.replace(/\//g, "-").slice(0, 300);
}

/** The default store is looked up by name until a household picks one (R6.22). */
export const PCX_DEFAULT_STORE_MATCH = /greenbank/i;
export function isDefaultPcxStore(id: string): boolean {
  return id === DEFAULT_PCX_STORE_ID;
}

export const pcxStoreSchema = z.object({
  storeId: z.string().min(1).max(100),
  name: z.string().max(120),
  address: z.string().max(300),
});
export type PcxStore = z.infer<typeof pcxStoreSchema>;

export const pcxProductSchema = z.object({
  productCode: z.string().min(1).max(100),
  name: z.string().max(200),
  brand: z.string().max(100).optional(),
  /** The pack size as PC Express shows it ("796 mL", "6x355 mL"). */
  packageSize: z.string().max(60).optional(),
  /** Parsed pack, when the text could be read. */
  packAmount: z.number().positive().optional(),
  packMeasure: z.enum(["weight", "volume", "count"]).optional(),
  imageUrl: z.string().max(1000).optional(),
  /** Current price at the store, cents. */
  priceCents: z.number().int().min(0).optional(),
});
export type PcxProduct = z.infer<typeof pcxProductSchema>;

/** Callable responses: `connected` false means the module isn't set up (no credentials) or PC Express failed. */
export interface PcxStatus {
  connected: boolean;
  message?: string;
}
export interface PcxStoreSearchResult extends PcxStatus {
  stores: PcxStore[];
}
export interface PcxProductSearchResult extends PcxStatus {
  products: PcxProduct[];
}

export const pcxStoreSearchInput = z.object({ hid: z.string().min(1).max(200), query: z.string().trim().min(2).max(60) });
export const pcxProductSearchInput = z.object({ hid: z.string().min(1).max(200), query: z.string().trim().min(2).max(80), pcxStoreId: z.string().min(1).max(100) });

const UNITS: Record<string, { measure: Measure; factor: number }> = {
  g: { measure: "weight", factor: 1 },
  gr: { measure: "weight", factor: 1 },
  kg: { measure: "weight", factor: 1000 },
  mg: { measure: "weight", factor: 0.001 },
  lb: { measure: "weight", factor: 453.592 },
  lbs: { measure: "weight", factor: 453.592 },
  oz: { measure: "weight", factor: 28.3495 },
  ml: { measure: "volume", factor: 1 },
  l: { measure: "volume", factor: 1000 },
  ea: { measure: "count", factor: 1 },
  each: { measure: "count", factor: 1 },
  ct: { measure: "count", factor: 1 },
  pk: { measure: "count", factor: 1 },
  pack: { measure: "count", factor: 1 },
  un: { measure: "count", factor: 1 },
};

/**
 * "400 g" → 400 g; "1.5 kg" → 1500 g; "946 mL" → 946 ml; "4 L" → 4000 ml; "12 ea" → 12; "6x355 mL" → 2130 ml;
 * "2 x 170 g" → 340 g. Null when it can't be read (the brand page then asks for the pack by hand).
 */
export function parsePackageSize(text: string | undefined | null): { packAmount: number; packMeasure: Measure } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ").trim();
  const m = /^(?:(\d+(?:\.\d+)?)\s*x\s*)?(\d+(?:\.\d+)?)\s*([a-z]+)\b/.exec(t);
  if (!m) return null;
  const unit = UNITS[m[3]!];
  if (!unit) return null;
  const n = (m[1] ? Number(m[1]) : 1) * Number(m[2]);
  const amount = Math.round(n * unit.factor * 1000) / 1000;
  return amount > 0 ? { packAmount: amount, packMeasure: unit.measure } : null;
}
