// Live PC Express prices (PRD R6.21; TECHNICAL_SPECS §8 "Prices"): prices/{pcxStoreId}_{productCode}, written by the
// functions (product search, weekly refresh), read here for the household's store. The builder prefers a live price
// fetched ≤ 14 days ago for a mapped product, then the bundled estimate (core `resolvePrice`).
import { useMemo } from "react";
import { collection, query, where } from "firebase/firestore";
import type { LivePrice, MappingEntry, PriceDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "./live";
import { millis } from "./plan";

export type StoredPrice = PriceDoc;

/** Every live price at the household's store, by product code. */
export function useLivePrices(pcxStoreId: string | null | undefined): Map<string, LivePrice & { productName: string }> {
  const q = useLiveQuery<StoredPrice>(pcxStoreId ? query(collection(db, "prices"), where("pcxStoreId", "==", pcxStoreId)) : null, pcxStoreId ? `prices?store=${pcxStoreId}` : null);
  return useMemo(() => {
    const m = new Map<string, LivePrice & { productName: string }>();
    for (const d of q.docs ?? []) {
      const at = millis(d.data.fetchedAt);
      if (at === null) continue;
      m.set(d.data.productCode, { priceCents: d.data.priceCents, packAmount: d.data.packAmount, packMeasure: d.data.packMeasure, fetchedAtMs: at, productName: d.data.productName });
    }
    return m;
  }, [q.docs]);
}

/** The builder's live-price lookup: a mapped product's price at the store (core decides whether it is fresh). */
export function liveLookup(prices: ReadonlyMap<string, LivePrice>) {
  return (_ingredientId: string, mapping: MappingEntry): LivePrice | undefined => (mapping.productCode ? prices.get(mapping.productCode) : undefined);
}
