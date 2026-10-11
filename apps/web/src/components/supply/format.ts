// Formatting and expiry helpers shared by the Supply page, the supply item detail, and the expired-lot prompt
// (PRD R8.4–R8.15).
import {
  activeExpiry,
  expiryFlag,
  formatCanonical,
  formatGrams,
  formatQuantity,
  isExpired,
  type ExpiryFlag,
  type LedgerLot,
  expiredLots,
  type StorageLocation,
} from "@solving-food/core";
import type { SupplyItem } from "@/data/supply";

export const LOCATION_LABEL: Record<StorageLocation, string> = { pantry: "Pantry", cupboard: "Cupboard", fridge: "Fridge", freezer: "Freezer" };

export interface AmountUnit {
  canonicalUnit: "g" | "count";
  unitWeightG?: number | undefined;
  /** Leftover batches count portions. */
  portions?: boolean;
}

/** Metric only (R8.13): "640 g", "3 (640 g)", "2 portions". */
export function amountText(amount: number, u: AmountUnit): string {
  const a = Math.max(0, amount);
  if (u.portions) return `${formatQuantity(a)} portion${Math.abs(a - 1) < 1e-6 ? "" : "s"}`;
  return formatCanonical(a, u.canonicalUnit, u.unitWeightG);
}

/** The short metric figure for tight places (projected brackets): "190 g", "3". */
export function shortAmount(amount: number, u: AmountUnit): string {
  const a = Math.max(0, amount);
  if (u.portions || u.canonicalUnit === "count") return formatQuantity(a);
  return formatGrams(a);
}

export function dateText(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, day: "numeric", month: "short" }).format(ms).toUpperCase();
}

/** The worst expiry state among an item's lots: expired, then the soonest use-by. */
export function itemExpiry(lots: readonly LedgerLot[], nowMs: number, tz: string): { flag: ExpiryFlag; expiresMs: number | null; frozenOnly: boolean } {
  const live = lots.filter((l) => l.amount > 1e-6);
  if (live.some((l) => isExpired(l, nowMs))) return { flag: "expired", expiresMs: null, frozenOnly: false };
  const fresh = live.filter((l) => !l.frozenAtMs);
  const pool = fresh.length ? fresh : live;
  let best: number | null = null;
  for (const l of pool) {
    const e = activeExpiry(l);
    if (e !== null && (best === null || e < best)) best = e;
  }
  return { flag: expiryFlag(best, nowMs, tz), expiresMs: best, frozenOnly: !fresh.length && live.length > 0 };
}


/** How a supply item's amounts read: leftover batches count portions. */
export function unitFor(item: { ingredientId?: string | undefined; canonicalUnit: "g" | "count" }, ing: { unitWeightG?: number | undefined } | undefined): AmountUnit {
  if (!item.ingredientId) return { canonicalUnit: "count", portions: true };
  return { canonicalUnit: item.canonicalUnit, unitWeightG: ing?.unitWeightG };
}

export interface ExpiredEntry {
  item: SupplyItem;
  lot: LedgerLot;
  unit: AmountUnit;
}

/** Every expired lot across the household's supply, oldest expiry first. */
export function expiredEntries(items: Iterable<SupplyItem>, nowMs: number, unitOf: (it: SupplyItem) => AmountUnit): ExpiredEntry[] {
  const out: ExpiredEntry[] = [];
  for (const it of items) for (const lot of expiredLots(it.lots, nowMs)) out.push({ item: it, lot, unit: unitOf(it) });
  return out.sort((a, b) => (a.lot.expiryExtendedToMs ?? a.lot.expiresFreshMs ?? 0) - (b.lot.expiryExtendedToMs ?? b.lot.expiresFreshMs ?? 0));
}

