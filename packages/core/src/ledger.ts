// The supply ledger (PRD R8.1–R8.15; TECHNICAL_SPECS §6). Pure functions over one supply document's lots: every
// operation returns the new lots and the transactions that explain the change, so Σ transaction deltas always equals
// the change in Σ lot amounts and `canonicalAmount` is just that sum. Functions apply these inside a Firestore
// transaction; the client applies the same functions to pending commands for its optimistic view.
//
// Rules:
// - FEFO: consumption takes from the lot whose active expiry comes first; lots that never expire come last. Expired lots
//   are skipped unless nothing else is left (R8.15).
// - A lot never goes below zero. Consumption beyond what the lots hold is reported as `short` and recorded on the
//   transaction note and the supply doc's `shortAt` ("check the amount"), not as a negative balance (deviation from the
//   spec's "negative allowed, shown as 0": a deficit can't be paid off by the next purchase without corrupting lots).
// - Lots that reach zero are removed from the document; their transactions remain.

import type { StorageLocation } from "./taxonomy";

export const EPS = 1e-6;

export interface LedgerLot {
  lotId: string;
  amount: number;
  location: StorageLocation;
  acquiredAtMs: number;
  expiresFreshMs?: number | null;
  expiresFrozenMs?: number | null;
  frozenAtMs?: number | null;
  expiryExtendedToMs?: number | null;
}

export type TxKind = "purchase" | "cook" | "correction" | "discard" | "freeze" | "thaw" | "leftover" | "eaten" | "extendExpiry" | "merge";

export interface LedgerTx {
  delta: number;
  kind: TxKind;
  lotId: string;
  note?: string;
}

export interface LedgerResult {
  lots: LedgerLot[];
  txs: LedgerTx[];
}

export interface ConsumeResult extends LedgerResult {
  /** Amount per lot taken (positive numbers), in FEFO order. */
  takes: Array<{ lotId: string; amount: number }>;
  /** What couldn't be taken because the lots ran out. */
  short: number;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const clone = (lots: readonly LedgerLot[]) => lots.map((l) => ({ ...l }));
const prune = (lots: LedgerLot[]) => lots.filter((l) => l.amount > EPS);

/** The expiry that applies now: "Still good" date, else frozen or fresh depending on the lot (§6). */
export function activeExpiry(lot: Pick<LedgerLot, "expiresFreshMs" | "expiresFrozenMs" | "frozenAtMs" | "expiryExtendedToMs">): number | null {
  if (lot.expiryExtendedToMs) return lot.expiryExtendedToMs;
  if (lot.frozenAtMs) return lot.expiresFrozenMs ?? null;
  return lot.expiresFreshMs ?? null;
}

export function isExpired(lot: LedgerLot, nowMs: number): boolean {
  const e = activeExpiry(lot);
  return e !== null && nowMs >= e;
}

export function recomputeAmount(lots: readonly LedgerLot[]): number {
  return round(lots.reduce((s, l) => s + l.amount, 0));
}

/** Supply that counts (R8.15): Σ of unexpired lots. */
export function unexpiredAmount(lots: readonly LedgerLot[], nowMs: number): number {
  return round(lots.reduce((s, l) => s + (isExpired(l, nowMs) ? 0 : l.amount), 0));
}

/** Earliest active expiry among lots that still hold something (unexpired first; expired lots also count). */
export function nextExpiry(lots: readonly LedgerLot[]): number | null {
  let best: number | null = null;
  for (const l of lots) {
    if (l.amount <= EPS) continue;
    const e = activeExpiry(l);
    if (e !== null && (best === null || e < best)) best = e;
  }
  return best;
}

export function expiredLots(lots: readonly LedgerLot[], nowMs: number): LedgerLot[] {
  return lots.filter((l) => l.amount > EPS && isExpired(l, nowMs));
}

/** FEFO order: unexpired by active expiry (never-expiring last, then oldest first), then expired lots by expiry. */
export function fefoOrder(lots: readonly LedgerLot[], nowMs: number): LedgerLot[] {
  const key = (l: LedgerLot) => activeExpiry(l) ?? Number.POSITIVE_INFINITY;
  const byExpiry = (a: LedgerLot, b: LedgerLot) => key(a) - key(b) || a.acquiredAtMs - b.acquiredAtMs || a.lotId.localeCompare(b.lotId);
  const live = lots.filter((l) => !isExpired(l, nowMs)).sort(byExpiry);
  const dead = lots.filter((l) => isExpired(l, nowMs)).sort(byExpiry);
  return [...live, ...dead];
}

/** A purchase (or manual add, or leftover batch): one new lot. */
export function applyPurchase(lots: readonly LedgerLot[], lot: LedgerLot, kind: "purchase" | "leftover" = "purchase", note?: string): LedgerResult {
  if (!(lot.amount > 0)) return { lots: clone(lots), txs: [] };
  const out = clone(lots).filter((l) => l.lotId !== lot.lotId);
  const prev = lots.find((l) => l.lotId === lot.lotId);
  out.push({ ...lot, amount: round(lot.amount) });
  const delta = round(lot.amount - (prev?.amount ?? 0));
  return { lots: out, txs: delta ? [{ delta, kind, lotId: lot.lotId, ...(note ? { note } : {}) }] : [] };
}

/**
 * `consumeFEFO(lots, amount, now)`: takes `amount` first-expiry-first. Expired lots are touched only when the
 * unexpired ones run out. Never below zero per lot; the remainder is `short`.
 */
export function consumeFEFO(lots: readonly LedgerLot[], amount: number, nowMs: number, kind: TxKind = "cook", note?: string): ConsumeResult {
  const out = clone(lots);
  const byId = new Map(out.map((l) => [l.lotId, l]));
  let left = Math.max(0, amount);
  const takes: Array<{ lotId: string; amount: number }> = [];
  const txs: LedgerTx[] = [];
  for (const l of fefoOrder(out, nowMs)) {
    if (left <= EPS) break;
    const lot = byId.get(l.lotId)!;
    if (lot.amount <= EPS) continue;
    const take = round(Math.min(lot.amount, left));
    lot.amount = round(lot.amount - take);
    left = round(left - take);
    takes.push({ lotId: lot.lotId, amount: take });
    txs.push({ delta: -take, kind, lotId: lot.lotId, ...(note ? { note } : {}) });
  }
  const short = left > EPS ? left : 0;
  if (short && txs.length) txs[txs.length - 1]!.note = [note, `short by ${round(short)}`].filter(Boolean).join(" · ");
  return { lots: prune(out), txs, takes, short };
}

/** Puts amounts back into the lots they came from (a review that used less than the default, §6 `submitReview`). */
export function refund(lots: readonly LedgerLot[], takes: ReadonlyArray<{ lotId: string; amount: number }>, amount: number, fallback: () => LedgerLot, kind: TxKind = "correction", note?: string): LedgerResult {
  const out = clone(lots);
  const txs: LedgerTx[] = [];
  let left = Math.max(0, amount);
  // Last taken first: the latest-expiring lot that gave something gets it back first.
  for (const t of [...takes].reverse()) {
    if (left <= EPS) break;
    const back = round(Math.min(t.amount, left));
    let lot = out.find((l) => l.lotId === t.lotId);
    if (!lot) {
      // The lot was used up and removed: recreate it from the fallback template under its old ID.
      lot = { ...fallback(), lotId: t.lotId, amount: 0 };
      out.push(lot);
    }
    lot.amount = round(lot.amount + back);
    left = round(left - back);
    txs.push({ delta: back, kind, lotId: t.lotId, ...(note ? { note } : {}) });
  }
  if (left > EPS) {
    const lot = fallback();
    const existing = out.find((l) => l.lotId === lot.lotId);
    if (existing) existing.amount = round(existing.amount + left);
    else out.push({ ...lot, amount: round(left) });
    txs.push({ delta: round(left), kind, lotId: lot.lotId, ...(note ? { note } : {}) });
  }
  return { lots: prune(out), txs };
}

/**
 * `applyCorrection(lots, target, now, newLot)`: "I actually have ~500 g" (R8.8). Brings Σ lots to `target`. Going
 * down takes from the earliest-expiring lots, expired ones included (they're the first to be wrong). Going up adds to
 * the latest-expiring unfrozen, unexpired lot, or starts a new lot from `newLot` when there is none.
 */
export function applyCorrection(lots: readonly LedgerLot[], target: number, nowMs: number, newLot: () => LedgerLot, note?: string): LedgerResult {
  const current = recomputeAmount(lots);
  const t = Math.max(0, target);
  const diff = round(t - current);
  if (Math.abs(diff) <= EPS) return { lots: clone(lots), txs: [] };
  if (diff < 0) {
    const out = clone(lots);
    const key = (l: LedgerLot) => activeExpiry(l) ?? Number.POSITIVE_INFINITY;
    let left = -diff;
    const txs: LedgerTx[] = [];
    for (const lot of [...out].sort((a, b) => key(a) - key(b) || a.acquiredAtMs - b.acquiredAtMs)) {
      if (left <= EPS) break;
      const take = round(Math.min(lot.amount, left));
      if (take <= 0) continue;
      lot.amount = round(lot.amount - take);
      left = round(left - take);
      txs.push({ delta: -take, kind: "correction", lotId: lot.lotId, ...(note ? { note } : {}) });
    }
    return { lots: prune(out), txs };
  }
  const out = clone(lots);
  const candidates = out.filter((l) => !l.frozenAtMs && !isExpired(l, nowMs));
  const key = (l: LedgerLot) => activeExpiry(l) ?? Number.POSITIVE_INFINITY;
  const target_ = candidates.sort((a, b) => key(b) - key(a) || b.acquiredAtMs - a.acquiredAtMs)[0];
  if (target_) {
    target_.amount = round(target_.amount + diff);
    return { lots: out, txs: [{ delta: diff, kind: "correction", lotId: target_.lotId, ...(note ? { note } : {}) }] };
  }
  const lot = { ...newLot(), amount: diff };
  out.push(lot);
  return { lots: out, txs: [{ delta: diff, kind: "correction", lotId: lot.lotId, ...(note ? { note } : {}) }] };
}

/** Throws away some or all of one lot (R8.8, R8.9; "Threw it out" on an expired lot, R8.15). */
export function discardLot(lots: readonly LedgerLot[], lotId: string, amount?: number, note?: string): LedgerResult {
  const out = clone(lots);
  const lot = out.find((l) => l.lotId === lotId);
  if (!lot) return { lots: out, txs: [] };
  const take = round(Math.min(lot.amount, amount === undefined ? lot.amount : Math.max(0, amount)));
  if (take <= 0) return { lots: out, txs: [] };
  lot.amount = round(lot.amount - take);
  return { lots: prune(out), txs: [{ delta: -take, kind: "discard", lotId, ...(note ? { note } : {}) }] };
}

/**
 * Freezes `amount` of a lot (R8.6). Part of a lot splits off into a new frozen lot `<lotId>-f<n>` (both expiries
 * kept); the whole lot is frozen in place. 0-delta transaction.
 */
export function freezeLot(lots: readonly LedgerLot[], lotId: string, amount: number | undefined, nowMs: number, frozenExpiresMs: number | null): LedgerResult & { frozenLotId: string | null } {
  const out = clone(lots);
  const lot = out.find((l) => l.lotId === lotId);
  if (!lot || lot.frozenAtMs) return { lots: out, txs: [], frozenLotId: null };
  const a = amount === undefined ? lot.amount : Math.min(lot.amount, Math.max(0, amount));
  if (a <= EPS) return { lots: out, txs: [], frozenLotId: null };
  const frozen = { frozenAtMs: nowMs, expiresFrozenMs: frozenExpiresMs, location: "freezer" as StorageLocation };
  if (lot.amount - a <= EPS) {
    Object.assign(lot, frozen);
    return { lots: out, txs: [{ delta: 0, kind: "freeze", lotId }], frozenLotId: lotId };
  }
  let n = 1;
  while (out.some((l) => l.lotId === `${lotId}-f${n}`)) n++;
  const newId = `${lotId}-f${n}`;
  lot.amount = round(lot.amount - a);
  out.push({ ...lot, ...frozen, lotId: newId, amount: round(a) });
  return { lots: out, txs: [{ delta: 0, kind: "freeze", lotId, note: `${round(a)} moved to ${newId}` }], frozenLotId: newId };
}

/**
 * Thaws a frozen lot (all of it, or splits off `amount`): back to the fridge, good for a couple of days from now
 * (`thawedExpiresMs`). The frozen expiry is kept for the record. 0-delta transaction.
 */
export function thawLot(lots: readonly LedgerLot[], lotId: string, amount: number | undefined, thawedExpiresMs: number | null, location: StorageLocation = "fridge"): LedgerResult {
  const out = clone(lots);
  const lot = out.find((l) => l.lotId === lotId);
  if (!lot || !lot.frozenAtMs) return { lots: out, txs: [] };
  const a = amount === undefined ? lot.amount : Math.min(lot.amount, Math.max(0, amount));
  if (a <= EPS) return { lots: out, txs: [] };
  const thawed = { frozenAtMs: null, location, expiresFreshMs: thawedExpiresMs, expiryExtendedToMs: null };
  if (lot.amount - a <= EPS) {
    Object.assign(lot, thawed);
    return { lots: out, txs: [{ delta: 0, kind: "thaw", lotId }] };
  }
  let n = 1;
  while (out.some((l) => l.lotId === `${lotId}-t${n}`)) n++;
  const newId = `${lotId}-t${n}`;
  lot.amount = round(lot.amount - a);
  out.push({ ...lot, ...thawed, lotId: newId, amount: round(a) });
  return { lots: out, txs: [{ delta: 0, kind: "thaw", lotId, note: `${round(a)} moved to ${newId}` }] };
}

/** "Still good" (R8.15): the lot counts again until `untilMs`. 0-delta transaction. */
export function extendExpiry(lots: readonly LedgerLot[], lotId: string, untilMs: number): LedgerResult {
  const out = clone(lots);
  const lot = out.find((l) => l.lotId === lotId);
  if (!lot) return { lots: out, txs: [] };
  lot.expiryExtendedToMs = untilMs;
  return { lots: out, txs: [{ delta: 0, kind: "extendExpiry", lotId }] };
}

/** Low stock (R8.12): nothing unexpired left, or less than a quarter of a pack. */
export function isLowStock(unexpired: number, packAmount: number | null | undefined, projected?: number): boolean {
  if (unexpired <= EPS) return true;
  if (projected !== undefined && projected < -EPS) return true;
  return !!packAmount && unexpired < packAmount * 0.25;
}
