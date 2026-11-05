// Staples cadence (PRD R7.7, R8.14; TECHNICAL_SPECS §8 "Staples cadence"). The receiveGroceries and addSupply handlers
// keep an exponential moving average of the gaps between purchases per ingredient (`cadence/{ingredientId}`); until
// an item has been bought twice the ingredient's `defaultCadenceDays` stands in. A staple is due once 85 % of the
// interval has passed since the last purchase (`isDue`, used by the staples on the grocery list since M10). The M5
// "Are you out of …?" prompt and its helpers were retired in M10 and removed in M21; `snoozedUntilMs` from old
// `snoozeCadence` commands is still honoured.

import { DAY_MS } from "./math";

export const CADENCE_ALPHA = 0.5;
/** Repeat purchases closer together than this are the same shop (a second delivery the same day). */
export const CADENCE_MIN_GAP_DAYS = 1;

export interface CadenceState {
  avgIntervalDays: number | null;
  lastPurchasedAtMs: number | null;
  purchaseCount: number;
}

/** Updates the exponential moving average of purchase gaps with a purchase at `nowMs`. */
export function updateCadence(prev: CadenceState | null, nowMs: number): CadenceState {
  if (!prev || prev.lastPurchasedAtMs === null) return { avgIntervalDays: prev?.avgIntervalDays ?? null, lastPurchasedAtMs: nowMs, purchaseCount: (prev?.purchaseCount ?? 0) + 1 };
  const gap = (nowMs - prev.lastPurchasedAtMs) / DAY_MS;
  if (gap < CADENCE_MIN_GAP_DAYS) return { ...prev, lastPurchasedAtMs: Math.max(prev.lastPurchasedAtMs, nowMs) };
  const avg = prev.avgIntervalDays && prev.purchaseCount >= 2 ? CADENCE_ALPHA * gap + (1 - CADENCE_ALPHA) * prev.avgIntervalDays : gap;
  return { avgIntervalDays: Math.round(avg * 100) / 100, lastPurchasedAtMs: nowMs, purchaseCount: prev.purchaseCount + 1 };
}

/** When the cadence expects a staple to run out (last purchase + interval; the seed default until bought twice). */
export function expectedRunOut(state: Pick<CadenceState, "avgIntervalDays" | "lastPurchasedAtMs" | "purchaseCount"> | null, defaultCadenceDays: number | undefined): number | null {
  if (!state?.lastPurchasedAtMs) return null;
  const days = state.purchaseCount >= 2 && state.avgIntervalDays ? state.avgIntervalDays : defaultCadenceDays;
  return days ? state.lastPurchasedAtMs + days * DAY_MS : null;
}

/** Ask once this share of the interval has passed since the last purchase. */
export const CADENCE_DUE_SHARE = 0.85;

/** The interval in days: the learned average once bought twice, else the seed's typical interval, else null. */
export function cadenceInterval(state: Pick<CadenceState, "avgIntervalDays" | "purchaseCount"> | null, defaultCadenceDays: number | undefined): number | null {
  if (state && state.purchaseCount >= 2 && state.avgIntervalDays) return state.avgIntervalDays;
  return defaultCadenceDays && defaultCadenceDays > 0 ? defaultCadenceDays : (state?.avgIntervalDays ?? null);
}

export interface CadenceLike extends CadenceState {
  snoozedUntilMs?: number | null;
}

/**
 * `isDue(cadence, ingredient, now)`: bought before, an interval is known, 85 % of it has passed since the last
 * purchase, and it isn't snoozed.
 */
export function isDue(c: CadenceLike | null, ingredient: { defaultCadenceDays?: number | undefined }, nowMs: number): boolean {
  if (!c?.lastPurchasedAtMs) return false;
  if (c.snoozedUntilMs && nowMs < c.snoozedUntilMs) return false;
  const days = cadenceInterval(c, ingredient.defaultCadenceDays);
  if (!days) return false;
  return nowMs - c.lastPurchasedAtMs >= CADENCE_DUE_SHARE * days * DAY_MS;
}
