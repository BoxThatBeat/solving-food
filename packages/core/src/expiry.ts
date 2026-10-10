// Expiry estimates and flags (PRD R8.5, R8.6, R8.15, R6.10; TECHNICAL_SPECS §6 "Rules").
//
// A lot bought on a local date with a shelf life of n days in its location expires at local midnight n days later:
// milk bought on 10 Oct with a 7-day fridge life is good through 16 Oct and expired from 17 Oct 00:00. Dates are
// compared in the household's timezone. Ingredients with no shelf life for a location never expire there.

import { addDays, localDate, localMidnight } from "./period";
import type { StorageLocation } from "./taxonomy";

export const DAY_MS = 86_400_000;

/** Leftover portions (R6.10): fixed shelf lives, not per ingredient. */
export const LEFTOVER_FRIDGE_DAYS = 4;
export const LEFTOVER_FREEZER_DAYS = 90;
/** A thawed lot is good for this many days from thawing (prototype: "Thawed · use within 2 days"). */
export const THAWED_DAYS = 2;
/** "Still good" (R8.15) extends an expired lot by this many days unless a date is picked. */
export const EXTEND_DEFAULT_DAYS = 3;
/** A lot is flagged "use soon" when it expires within this many days. */
export const USE_SOON_DAYS = 3;

export type ShelfLife = Partial<Record<StorageLocation, number | null | undefined>>;

/** Local midnight `days` after the local date of `fromMs`. */
export function addLocalDays(fromMs: number, days: number, tz: string): number {
  return localMidnight(addDays(localDate(fromMs, tz), Math.round(days)), tz);
}

/**
 * `estimateExpiry(shelfLife, location, acquiredAt)`: the expected expiry of a purchase, or null when the ingredient
 * doesn't expire in that location (no shelf life recorded, R8.5).
 */
export function estimateExpiry(shelfLife: ShelfLife | undefined, location: StorageLocation, acquiredAtMs: number, tz: string): number | null {
  const days = shelfLife?.[location];
  if (days === null || days === undefined) return null;
  return addLocalDays(acquiredAtMs, days, tz);
}

/** Frozen expiry when a lot is frozen at `frozenAtMs` (R8.6). */
export function frozenExpiry(shelfLife: ShelfLife | undefined, frozenAtMs: number, tz: string): number | null {
  return estimateExpiry(shelfLife, "freezer", frozenAtMs, tz);
}

export function leftoverExpiry(cookedAtMs: number, tz: string, frozen = false): number {
  return addLocalDays(cookedAtMs, frozen ? LEFTOVER_FREEZER_DAYS : LEFTOVER_FRIDGE_DAYS, tz);
}

export type ExpiryFlag = "fresh" | "soon" | "expired" | "none";

/** Fresh / use soon / expired (R8.5), or none when it never expires. */
export function expiryFlag(expiresMs: number | null | undefined, nowMs: number, tz: string): ExpiryFlag {
  if (expiresMs === null || expiresMs === undefined) return "none";
  if (nowMs >= expiresMs) return "expired";
  return daysLeft(expiresMs, nowMs, tz) <= USE_SOON_DAYS ? "soon" : "fresh";
}

/**
 * Whole days left: 0 when it expires at the next local midnight ("today is the last day"), 1 for tomorrow, and so on;
 * negative once expired.
 */
export function daysLeft(expiresMs: number, nowMs: number, tz: string): number {
  const today = localMidnight(localDate(nowMs, tz), tz);
  return Math.round((expiresMs - today) / DAY_MS) - 1;
}

/** "2D", "5MO", "1Y+" (the prototype's mono expiry label). */
export function shortDuration(days: number): string {
  if (days < 0) return "0D";
  if (days < 60) return `${days}D`;
  if (days < 365) return `${Math.round(days / 30)}MO`;
  return "1Y+";
}

/** "Salmon expires today / tomorrow / in 2 days / expired" for badges (R6.7). */
export function expiresPhrase(expiresMs: number, nowMs: number, tz: string): string {
  const d = daysLeft(expiresMs, nowMs, tz);
  if (nowMs >= expiresMs) return "expired";
  if (d <= 0) return "expires today";
  if (d === 1) return "expires tomorrow";
  return `expires in ${d} days`;
}
