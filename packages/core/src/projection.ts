// Supply documents ⇄ ledger lots, and the client's optimistic view of pending commands (TECHNICAL_SPECS §6: "While
// a command is pending, the client applies its effect optimistically for display"). Timestamps are converted by the
// caller (`toMs`/`fromMs`), so this stays Firebase-free.

import type { AnyCommand } from "./commands";
import { estimateExpiry, EXTEND_DEFAULT_DAYS, addLocalDays, frozenExpiry, THAWED_DAYS, type ShelfLife } from "./expiry";
import {
  applyCorrection,
  applyPurchase,
  discardLot,
  extendExpiry,
  freezeLot,
  thawLot,
  type LedgerLot,
} from "./ledger";
import type { StorageLocation } from "./taxonomy";

export interface StoredLotLike {
  lotId: string;
  amount: number;
  location: StorageLocation;
  acquiredAt: unknown;
  expiresFresh?: unknown;
  expiresFrozen?: unknown;
  frozenAt?: unknown;
  expiryExtendedTo?: unknown;
}

export function lotFromDoc(l: StoredLotLike, toMs: (v: unknown) => number | null): LedgerLot {
  return {
    lotId: l.lotId,
    amount: l.amount,
    location: l.location,
    acquiredAtMs: toMs(l.acquiredAt) ?? 0,
    expiresFreshMs: toMs(l.expiresFresh),
    expiresFrozenMs: toMs(l.expiresFrozen),
    frozenAtMs: toMs(l.frozenAt),
    expiryExtendedToMs: toMs(l.expiryExtendedTo),
  };
}

/** Ledger lot → Firestore lot, nulls left out. */
export function lotToDoc<T>(l: LedgerLot, fromMs: (ms: number) => T): Record<string, unknown> {
  const out: Record<string, unknown> = { lotId: l.lotId, amount: l.amount, location: l.location, acquiredAt: fromMs(l.acquiredAtMs) };
  if (l.expiresFreshMs) out.expiresFresh = fromMs(l.expiresFreshMs);
  if (l.expiresFrozenMs) out.expiresFrozen = fromMs(l.expiresFrozenMs);
  if (l.frozenAtMs) out.frozenAt = fromMs(l.frozenAtMs);
  if (l.expiryExtendedToMs) out.expiryExtendedTo = fromMs(l.expiryExtendedToMs);
  return out;
}

export interface ProjectedDoc {
  ingredientId?: string | undefined;
  label: string;
  canonicalUnit: "g" | "count";
  lots: LedgerLot[];
  /** True while a pending command changed it. */
  pending?: boolean;
}

export interface ProjectionContext {
  nowMs: number;
  tz: string;
  ingredient: (id: string) => { name: string; canonicalUnit: "g" | "count"; defaultLocation: StorageLocation; shelfLifeDays: ShelfLife; freeUse: boolean } | undefined;
}

/** A fresh lot for an ingredient bought or added now (expiry estimated from its location, R8.5). */
export function newLotFor(lotId: string, amount: number, location: StorageLocation, shelfLife: ShelfLife | undefined, nowMs: number, tz: string): LedgerLot {
  return { lotId, amount, location, acquiredAtMs: nowMs, expiresFreshMs: estimateExpiry(shelfLife, location, nowMs, tz) };
}

/**
 * Applies pending commands, oldest first, to a copy of the supply map. Only the ledger-only commands are projected;
 * finishCooking, submitReview, and markEaten need recipe and plan data and show as "syncing" until applied.
 */
export function projectPending(supply: ReadonlyMap<string, ProjectedDoc>, pending: ReadonlyArray<{ id: string; command: AnyCommand }>, ctx: ProjectionContext): Map<string, ProjectedDoc> {
  const out = new Map<string, ProjectedDoc>([...supply].map(([k, v]) => [k, { ...v, lots: v.lots.map((l) => ({ ...l })) }]));
  const touch = (sid: string, lots: LedgerLot[]) => {
    const d = out.get(sid);
    if (d) out.set(sid, { ...d, lots, pending: true });
  };
  for (const { id, command: c } of pending) {
    switch (c.type) {
      case "addSupply": {
        const ing = ctx.ingredient(c.payload.ingredientId);
        if (!ing || ing.freeUse) break;
        const d = out.get(c.payload.ingredientId) ?? { ingredientId: c.payload.ingredientId, label: ing.name, canonicalUnit: ing.canonicalUnit, lots: [] };
        out.set(c.payload.ingredientId, { ...d, lots: applyPurchase(d.lots, newLotFor(id, c.payload.amount, c.payload.location, ing.shelfLifeDays, ctx.nowMs, ctx.tz)).lots, pending: true });
        break;
      }
      case "receiveGroceries": {
        for (const it of c.payload.items) {
          if (!it.ingredientId || it.missing || !(it.amount > 0)) continue;
          const ing = ctx.ingredient(it.ingredientId);
          if (!ing || ing.freeUse) continue;
          const d = out.get(it.ingredientId) ?? { ingredientId: it.ingredientId, label: ing.name, canonicalUnit: ing.canonicalUnit, lots: [] };
          let lots = applyPurchase(d.lots, newLotFor(`${id}-${it.itemId}`, it.amount, ing.defaultLocation, ing.shelfLifeDays, ctx.nowMs, ctx.tz)).lots;
          if (it.freezeAmount && it.freezeAmount > 0) lots = freezeLot(lots, `${id}-${it.itemId}`, it.freezeAmount, ctx.nowMs, frozenExpiry(ing.shelfLifeDays, ctx.nowMs, ctx.tz)).lots;
          out.set(it.ingredientId, { ...d, lots, pending: true });
        }
        break;
      }
      case "correctSupply": {
        const d = out.get(c.payload.supplyId);
        const ingId = d?.ingredientId ?? c.payload.ingredientId;
        const ing = ingId ? ctx.ingredient(ingId) : undefined;
        const base = d ?? (ing && ingId ? { ingredientId: ingId, label: ing.name, canonicalUnit: ing.canonicalUnit, lots: [] } : null);
        if (!base) break;
        const loc = ing?.defaultLocation ?? "fridge";
        out.set(c.payload.supplyId, { ...base, lots: applyCorrection(base.lots, c.payload.target, ctx.nowMs, () => newLotFor(id, 0, loc, ing?.shelfLifeDays, ctx.nowMs, ctx.tz)).lots, pending: true });
        break;
      }
      case "discard": {
        const d = out.get(c.payload.supplyId);
        if (d) touch(c.payload.supplyId, discardLot(d.lots, c.payload.lotId, c.payload.amount).lots);
        break;
      }
      case "extendExpiry": {
        const d = out.get(c.payload.supplyId);
        if (d) touch(c.payload.supplyId, extendExpiry(d.lots, c.payload.lotId, c.payload.until ?? addLocalDays(ctx.nowMs, EXTEND_DEFAULT_DAYS, ctx.tz)).lots);
        break;
      }
      case "freeze": {
        const d = out.get(c.payload.supplyId);
        const ing = d?.ingredientId ? ctx.ingredient(d.ingredientId) : undefined;
        if (d) touch(c.payload.supplyId, freezeLot(d.lots, c.payload.lotId, c.payload.amount, ctx.nowMs, ing ? frozenExpiry(ing.shelfLifeDays, ctx.nowMs, ctx.tz) : addLocalDays(ctx.nowMs, 90, ctx.tz)).lots);
        break;
      }
      case "thaw": {
        const d = out.get(c.payload.supplyId);
        if (d) touch(c.payload.supplyId, thawLot(d.lots, c.payload.lotId, c.payload.amount, addLocalDays(ctx.nowMs, THAWED_DAYS, ctx.tz)).lots);
        break;
      }
      case "markEaten":
      case "finishCooking":
      case "submitReview":
      case "importHousehold":
      case "snoozeCadence":
        break;
    }
  }
  return out;
}

