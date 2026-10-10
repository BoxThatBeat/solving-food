// Supply, commands, cook events, ratings, cadence: live reads and the command writer (TECHNICAL_SPECS §4.2, §6, §11).
// Clients never write supply: every change is a command document, applied by the `commands` function. While a command
// is pending, its effect is projected onto the supply shown (core `projectPending`).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
} from "firebase/firestore";
import {
  isCommandType,
  lotFromDoc,
  parseCommand,
  projectPending,
  type AnyCommand,
  type CadenceDoc,
  type CommandDoc,
  type CommandPayload,
  type CommandType,
  type CookEventDoc,
  type LedgerLot,
  type ProjectedDoc,
  type RatingDoc,
  type TransactionDoc,
} from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc, useLiveQuery } from "./live";
import { millis, type StoredList } from "./plan";
import { useIngredientsById } from "./ingredients";
import freeUseIds from "../../../../data/free-use.json";

/** The seed's free-use ingredients (R8.14), bundled: data/free-use.json. */
export const FREE_USE = new Set<string>(freeUseIds as string[]);

const hh = (hid: string, ...rest: string[]) => ["households", hid, ...rest].join("/");

export interface SupplyItem {
  id: string;
  ingredientId?: string | undefined;
  label: string;
  canonicalUnit: "g" | "count";
  lots: LedgerLot[];
  cookEventId?: string | undefined;
  leftoverMealType?: string | undefined;
  shortAtMs: number | null;
  /** A pending command changed it (shown as "syncing"). */
  pending: boolean;
}

interface StoredSupply {
  ingredientId?: string;
  label: string;
  canonicalUnit: "g" | "count";
  lots: Array<Record<string, unknown>>;
  cookEventId?: string;
  leftoverMealType?: string;
  shortAt?: unknown;
}

export function useSupplyDocs(hid: string | null) {
  return useLiveQuery<StoredSupply>(hid ? collection(db, "households", hid, "supply") : null, hid ? hh(hid, "supply") : null);
}

export type StoredCommand = CommandDoc & { createdAt?: { toMillis(): number } };

/** Commands not yet applied (mine and other members'), oldest first. Local, unsent ones included. */
export function usePendingCommands(hid: string | null) {
  const q = useLiveQuery<StoredCommand>(hid ? query(collection(db, "households", hid, "commands"), where("status", "==", "pending")) : null, hid ? `${hh(hid, "commands")}?pending` : null);
  return useMemo(() => {
    const out: Array<{ id: string; command: AnyCommand; createdAtMs: number }> = [];
    for (const d of q.docs ?? []) {
      if (!isCommandType(d.data.type)) continue;
      try {
        out.push({ id: d.id, command: parseCommand(d.data), createdAtMs: millis(d.data.createdAt) ?? Number.MAX_SAFE_INTEGER }); // unsent: newest
      } catch {
        /* the function will mark it failed */
      }
    }
    return out.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }, [q.docs]);
}

/**
 * Supply as the household should see it right now: stored lots plus the effect of pending commands. `now` is
 * refreshed every minute so lots expire on screen without a reload.
 */
export function useSupply(hid: string | null, tz: string) {
  const docs = useSupplyDocs(hid);
  const pending = usePendingCommands(hid);
  const now = useNow(60_000);
  const ingredientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of docs.docs ?? []) if (d.data.ingredientId) ids.add(d.data.ingredientId);
    for (const p of pending) {
      const c = p.command;
      if (c.type === "addSupply") ids.add(c.payload.ingredientId);
      if (c.type === "receiveGroceries") for (const i of c.payload.items) if (i.ingredientId) ids.add(i.ingredientId);
      if (c.type === "correctSupply" && c.payload.ingredientId) ids.add(c.payload.ingredientId);
    }
    return [...ids];
  }, [docs.docs, pending]);
  const ingredients = useIngredientsById(ingredientIds);
  const items = useMemo(() => {
    const base = new Map<string, ProjectedDoc & { extra: Pick<SupplyItem, "cookEventId" | "leftoverMealType" | "shortAtMs"> }>();
    for (const d of docs.docs ?? []) {
      base.set(d.id, {
        ingredientId: d.data.ingredientId,
        label: d.data.label,
        canonicalUnit: d.data.canonicalUnit,
        lots: (d.data.lots ?? []).map((l) => lotFromDoc(l as never, millis)),
        extra: { cookEventId: d.data.cookEventId, leftoverMealType: d.data.leftoverMealType, shortAtMs: millis(d.data.shortAt) },
      });
    }
    const projected = projectPending(base, pending, {
      nowMs: now,
      tz,
      ingredient: (id) => {
        const i = ingredients.get(id);
        return i ? { name: i.name, canonicalUnit: i.canonicalUnit, defaultLocation: i.defaultLocation, shelfLifeDays: i.shelfLifeDays, freeUse: i.freeUse } : undefined;
      },
    });
    const out = new Map<string, SupplyItem>();
    for (const [id, p] of projected) {
      const extra = base.get(id)?.extra ?? { shortAtMs: null };
      out.set(id, { id, ingredientId: p.ingredientId, label: p.label, canonicalUnit: p.canonicalUnit, lots: p.lots, ...extra, pending: !!p.pending });
    }
    return out;
  }, [docs.docs, pending, ingredients, now, tz]);
  return { items, loading: docs.docs === undefined, pendingCount: pending.length, pendingCommands: pending, now, ingredients };
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    const vis = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [intervalMs]);
  return now;
}

// ---------- the command writer

/**
 * Writes a command document (§6). The write is queued by the SDK when offline, so this resolves with the ID at once and
 * never awaits the server; failures come back from the function as an error banner and `status: failed`.
 */
export function sendCommand<T extends CommandType>(hid: string, uid: string, type: T, payload: CommandPayload<T>, id = doc(collection(db, "households", hid, "commands")).id): string {
  const ref = doc(db, "households", hid, "commands", id);
  void setDoc(ref, { type, payload: stripUndefined(payload), uid, createdAt: serverTimestamp(), status: "pending" }).catch((e) => {
    console.error("command write failed", e);
    window.dispatchEvent(new CustomEvent("sf:command-error", { detail: { type, message: (e as Error).message } }));
  });
  return id;
}

function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T;
  if (v && typeof v === "object" && (v as object).constructor === Object) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, stripUndefined(x)])) as T;
  }
  return v;
}

/** `useCommand(hid, uid)` → send(type, payload). */
export function useCommand(hid: string, uid: string) {
  return useCallback(<T extends CommandType>(type: T, payload: CommandPayload<T>, id?: string) => sendCommand(hid, uid, type, payload, id), [hid, uid]);
}

/** A command's live state (pending / applied / failed). */
export function useCommandDoc(hid: string, id: string | null) {
  return useLiveDoc<StoredCommand>(id ? doc(db, "households", hid, "commands", id) : null, id ? hh(hid, "commands", id) : null);
}

export function newId(hid: string, coll = "commands"): string {
  return doc(collection(db, "households", hid, coll)).id;
}

// ---------- transactions (R8.7): paginated, newest first

export type StoredTx = TransactionDoc & { createdAt?: { toMillis(): number } };
export const LEDGER_PAGE = 25;

export function useLedger(hid: string, supplyId: string) {
  const base = () => query(collection(db, "households", hid, "supply", supplyId, "transactions"), orderBy("createdAt", "desc"), orderBy(documentId(), "desc"));
  const live = useLiveQuery<StoredTx>(query(base(), limit(LEDGER_PAGE)), `${hh(hid, "supply", supplyId, "transactions")}?first`);
  const [older, setOlder] = useState<{ key: string; rows: Array<{ id: string; data: StoredTx }>; done: boolean }>({ key: supplyId, rows: [], done: false });
  const [busy, setBusy] = useState(false);
  const first = live.docs ?? [];
  const state = older.key === supplyId ? older : { key: supplyId, rows: [], done: false };
  const rows = [...first, ...state.rows];
  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (busy || state.done || !last?.data.createdAt) return;
    setBusy(true);
    try {
      const page = await getDocs(query(base(), startAfter(last.data.createdAt, last.id), limit(LEDGER_PAGE)));
      setOlder({ key: supplyId, rows: [...state.rows, ...page.docs.map((d) => ({ id: d.id, data: d.data() as StoredTx }))], done: page.size < LEDGER_PAGE });
    } finally {
      setBusy(false);
    }
  };
  const hasMore = first.length >= LEDGER_PAGE && !state.done;
  return { rows, loading: live.docs === undefined, hasMore, loadMore, busy };
}

// ---------- cook events, ratings, cadence, received lists, periods

export type StoredEvent = CookEventDoc & { cookedAt: { toMillis(): number } };

export function useCookEvents(hid: string | null) {
  return useLiveQuery<StoredEvent>(hid ? query(collection(db, "households", hid, "cookEvents"), orderBy("cookedAt", "desc"), limit(300)) : null, hid ? `${hh(hid, "cookEvents")}?recent` : null);
}

export function useCookEvent(hid: string, id: string | null) {
  return useLiveDoc<StoredEvent>(id ? doc(db, "households", hid, "cookEvents", id) : null, id ? hh(hid, "cookEvents", id) : null);
}

export function useRatings(hid: string | null) {
  return useLiveQuery<RatingDoc>(hid ? collection(db, "households", hid, "ratings") : null, hid ? hh(hid, "ratings") : null);
}

export function useCadence(hid: string | null) {
  return useLiveQuery<CadenceDoc>(hid ? collection(db, "households", hid, "cadence") : null, hid ? hh(hid, "cadence") : null);
}

export function useReceivedLists(hid: string | null) {
  return useLiveQuery<StoredList & { receivedAt?: { toMillis(): number }; receivedCents?: number }>(
    hid ? query(collection(db, "households", hid, "groceryLists"), where("status", "==", "received")) : null,
    hid ? `${hh(hid, "groceryLists")}?received` : null,
  );
}
