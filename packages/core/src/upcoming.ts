// The next period (M26, PRD R3.2–R3.4, R7.18; TECHNICAL_SPECS §7 "The next period"): planning and ordering the
// period after the current one before it starts. Its ID is computed from the current period and the household's
// settings (no document until the rollover creates it), the rollover adopts its plan items as they are, and what Supply
// will hold when it starts is projected from today's lots, the current period's uncooked meals and the orders on their
// way. Pure: timestamps are milliseconds, so this stays Firebase-free.

import { activeExpiry, isExpired, type LedgerLot } from "./ledger";
import { FLOAT_EPS } from "./math";
import { localDate, nextPeriod, periodBounds, type PeriodBounds, type RestartPlan } from "./period";

/** Which period a Plan or Grocery view shows. */
export type PeriodView = "current" | "next";

/**
 * The period after `current`: it starts on the current period's end date and runs `periodDays` (a new length applies
 * from the next period, R11.5). Its ID is that date, the same ID the rollover will give it, so items written with it
 * now are the next period's items once it starts.
 */
export function upcomingPeriod(current: { endMs: number }, periodDays: number, tz: string): PeriodBounds {
  return periodBounds(localDate(current.endMs, tz), periodDays, tz);
}

export interface RolloverTarget {
  /** The period the rollover makes current (the one containing now). */
  bounds: PeriodBounds;
  /** The ID the next-period view used while `current` ran. */
  upcomingId: string;
  /**
   * True when the new period is the upcoming one: its plan items, draft and orders become current as they are (no
   * copies). False when nobody opened the app for a whole period: the upcoming period was skipped, and its still-planned
   * items are carried into `bounds` like the current period's.
   */
  adopts: boolean;
}

/** What the rollover does with the period after `current` (spec §7). */
export function rolloverTarget(current: { endMs: number }, periodDays: number, tz: string, nowMs: number): RolloverTarget {
  const bounds = nextPeriod(current.endMs, periodDays, tz, nowMs);
  const upcomingId = upcomingPeriod(current, periodDays, tz).id;
  return { bounds, upcomingId, adopts: bounds.id === upcomingId };
}

/**
 * Restart period (R3.1) with next-period items (M26): the restart moves where the current period ends, so the next
 * period moves with it. Returns the IDs to re-key from and to, or null when nothing moves (no current period, a noop,
 * or the same end date).
 */
export function restartUpcoming(
  current: { endMs: number } | null,
  plan: RestartPlan,
  periodDays: number,
  tz: string,
): { from: string; to: string } | null {
  if (!current || plan.kind === "noop") return null;
  const from = upcomingPeriod(current, periodDays, tz).id;
  const to = upcomingPeriod(plan.bounds, periodDays, tz).id;
  return from === to ? null : { from, to };
}

export interface SupplyAtStart {
  /** Lots left when the next period starts (amounts after the current plan's use), unexpired then. */
  lots: Map<string, LedgerLot[]>;
  /** What counts as Supply at the start, per ingredient: those lots plus incoming orders not used up before then. */
  unexpired: Map<string, number>;
}

/**
 * Projected Supply at the start of the next period (R3.4): the current period's uncooked meals (`currentUse`) take the
 * soonest-expiring lots first (as cooking does, FEFO) and then this period's orders on their way (`currentIncoming`);
 * what's left of a lot counts only when it is still good at `startMs`. Orders placed for the next period
 * (`nextIncoming`) arrive for it and are all added. Pack rounding on the current order isn't counted (the spare it
 * buys is a bonus, not planned for).
 */
export function supplyAtStart(
  lotsByIngredient: ReadonlyMap<string, readonly LedgerLot[]>,
  currentUse: ReadonlyMap<string, number>,
  currentIncoming: ReadonlyMap<string, number>,
  nextIncoming: ReadonlyMap<string, number>,
  nowMs: number,
  startMs: number,
): SupplyAtStart {
  const lots = new Map<string, LedgerLot[]>();
  const unexpired = new Map<string, number>();
  const ids = new Set([...lotsByIngredient.keys(), ...currentIncoming.keys(), ...nextIncoming.keys()]);
  for (const id of ids) {
    let use = Math.max(0, currentUse.get(id) ?? 0);
    const live = (lotsByIngredient.get(id) ?? [])
      .filter((l) => l.amount > FLOAT_EPS && !isExpired(l, nowMs))
      .sort((a, b) => (activeExpiry(a) ?? Infinity) - (activeExpiry(b) ?? Infinity));
    const left: LedgerLot[] = [];
    for (const l of live) {
      const take = Math.min(use, l.amount);
      use -= take;
      const amount = l.amount - take;
      if (amount > FLOAT_EPS && !isExpired(l, startMs)) left.push({ ...l, amount });
    }
    const incoming = Math.max(0, (currentIncoming.get(id) ?? 0) - use) + Math.max(0, nextIncoming.get(id) ?? 0);
    const total = left.reduce((s, l) => s + l.amount, 0) + incoming;
    if (left.length) lots.set(id, left);
    if (total > FLOAT_EPS) unexpired.set(id, total);
  }
  return { lots, unexpired };
}

/**
 * The next-period view's one-line note (R3.4): how many lots left at its start expire within it that no planned meal
 * of it uses, and the largest of them by amount (at most `top`).
 */
export function atStartSummary(
  expiring: ReadonlyMap<string, { amount: number; lotIds: readonly string[] }>,
  top = 2,
): { lots: number; items: Array<{ ingredientId: string; amount: number }> } {
  let lots = 0;
  const items: Array<{ ingredientId: string; amount: number }> = [];
  for (const [ingredientId, e] of expiring) {
    lots += e.lotIds.length;
    items.push({ ingredientId, amount: e.amount });
  }
  items.sort((a, b) => b.amount - a.amount || a.ingredientId.localeCompare(b.ingredientId));
  return { lots, items: items.slice(0, top) };
}

/**
 * Ordered lists by period (R7.18): a list placed from the next-period view carries the upcoming period's ID and counts
 * as incoming there only, so this period's list never leaves out what the next order is buying for next week; every
 * other ordered list (this period's, and any older one still on its way) belongs to the current view. After the
 * rollover the upcoming ID is the current one, so the same lists move to the current view without a write.
 */
export function listsForView<T extends { data: { periodId: string } }>(lists: readonly T[], upcomingId: string | null, view: PeriodView): T[] {
  return lists.filter((l) => (view === "next" ? upcomingId !== null && l.data.periodId === upcomingId : l.data.periodId !== upcomingId));
}
