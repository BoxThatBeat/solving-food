// Staples cadence (PRD R7.7, R8.14; TECHNICAL_SPECS §8 "Staples cadence"). The receiveGroceries and addSupply handlers
// keep an exponential moving average of the gaps between purchases per ingredient (`cadence/{ingredientId}`); until
// an item has been bought twice the ingredient's `defaultCadenceDays` stands in. The client asks "Are you out of
// milk?" once 85 % of the interval has passed since the last purchase; "Not yet" snoozes for a quarter interval
// (the `snoozeCadence` command: cadence is function-only).

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
  const gap = (nowMs - prev.lastPurchasedAtMs) / 86_400_000;
  if (gap < CADENCE_MIN_GAP_DAYS) return { ...prev, lastPurchasedAtMs: Math.max(prev.lastPurchasedAtMs, nowMs) };
  const avg = prev.avgIntervalDays && prev.purchaseCount >= 2 ? CADENCE_ALPHA * gap + (1 - CADENCE_ALPHA) * prev.avgIntervalDays : gap;
  return { avgIntervalDays: Math.round(avg * 100) / 100, lastPurchasedAtMs: nowMs, purchaseCount: prev.purchaseCount + 1 };
}

/** When the cadence expects a staple to run out (last purchase + interval; the seed default until bought twice). */
export function expectedRunOut(state: Pick<CadenceState, "avgIntervalDays" | "lastPurchasedAtMs" | "purchaseCount"> | null, defaultCadenceDays: number | undefined): number | null {
  if (!state?.lastPurchasedAtMs) return null;
  const days = state.purchaseCount >= 2 && state.avgIntervalDays ? state.avgIntervalDays : defaultCadenceDays;
  return days ? state.lastPurchasedAtMs + days * 86_400_000 : null;
}

/** Ask once this share of the interval has passed since the last purchase. */
export const CADENCE_DUE_SHARE = 0.85;
/** "Not yet" snoozes for this share of the interval. */
export const CADENCE_SNOOZE_SHARE = 0.25;

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
  return nowMs - c.lastPurchasedAtMs >= CADENCE_DUE_SHARE * days * 86_400_000;
}

/** When "Not yet" stops asking: now + a quarter of the interval (at least a day). */
export function snoozeUntil(c: Pick<CadenceState, "avgIntervalDays" | "purchaseCount"> | null, ingredient: { defaultCadenceDays?: number | undefined }, nowMs: number): number {
  const days = cadenceInterval(c, ingredient.defaultCadenceDays) ?? 4;
  return nowMs + Math.max(1, CADENCE_SNOOZE_SHARE * days) * 86_400_000;
}

export interface CadencePrompt {
  ingredientId: string;
  intervalDays: number;
  lastPurchasedAtMs: number;
  /** Days since the last purchase, whole. */
  daysSince: number;
}

/**
 * The prompts to show now: staples (free-use or marked staple) that are due, not already on the draft list or an
 * ordered list, oldest purchase first relative to its interval.
 */
export function duePrompts(
  cadence: ReadonlyArray<{ ingredientId: string; c: CadenceLike }>,
  ingredientOf: (id: string) => { defaultCadenceDays?: number | undefined; isStaple?: boolean; freeUse?: boolean } | undefined,
  onList: ReadonlySet<string>,
  nowMs: number,
): CadencePrompt[] {
  const out: Array<CadencePrompt & { ratio: number }> = [];
  for (const { ingredientId, c } of cadence) {
    const ing = ingredientOf(ingredientId);
    if (!ing || !(ing.isStaple || ing.freeUse) || onList.has(ingredientId)) continue;
    if (!isDue(c, ing, nowMs)) continue;
    const days = cadenceInterval(c, ing.defaultCadenceDays)!;
    const since = (nowMs - c.lastPurchasedAtMs!) / 86_400_000;
    out.push({ ingredientId, intervalDays: days, lastPurchasedAtMs: c.lastPurchasedAtMs!, daysSince: Math.floor(since), ratio: since / days });
  }
  return out.sort((a, b) => b.ratio - a.ratio || a.ingredientId.localeCompare(b.ingredientId)).map(({ ratio: _r, ...p }) => (void _r, p));
}
