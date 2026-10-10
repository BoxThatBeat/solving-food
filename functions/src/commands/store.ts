// Supply documents inside a command's Firestore transaction (TECHNICAL_SPECS §6). Reads happen first (`load`), the
// ledger math from @solving-food/core runs in memory, and `commit` writes each changed supply doc with its
// transactions. Lots are stored with Timestamps; the core works in epoch ms.
import { FieldValue, Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import {
  lotFromDoc,
  lotToDoc,
  nextExpiry,
  recomputeAmount,
  type LedgerLot,
  type LedgerResult,
  type MealType,
} from "@solving-food/core";
import { db } from "../admin";

/** A failure the person should see ("That lot is gone"); anything else is reported as an internal error. */
export class CommandError extends Error {}

export function toMs(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") return (v as { toMillis(): number }).toMillis();
  return null;
}

export const ts = (ms: number) => Timestamp.fromMillis(ms);

export interface SupplyData {
  ingredientId?: string;
  label: string;
  canonicalUnit: "g" | "count";
  lots: LedgerLot[];
  cookEventId?: string;
  leftoverMealType?: MealType;
  short?: boolean;
  clearShort?: boolean;
}

interface Entry {
  ref: DocumentReference;
  exists: boolean;
  data: SupplyData | null;
  txs: Array<{ delta: number; kind: string; lotId: string; note?: string; ref?: { type: string; id: string } }>;
  dirty: boolean;
}

export class SupplyStore {
  private entries = new Map<string, Entry>();
  constructor(
    private readonly tx: Transaction,
    private readonly hid: string,
    private readonly uid: string,
    private readonly commandId: string,
  ) {}

  ref(id: string): DocumentReference {
    return db.doc(`households/${this.hid}/supply/${id}`);
  }

  async load(ids: Iterable<string>): Promise<void> {
    const want = [...new Set(ids)].filter((id) => !this.entries.has(id));
    if (!want.length) return;
    const snaps = await this.tx.getAll(...want.map((id) => this.ref(id)));
    snaps.forEach((s, i) => {
      const raw = s.exists ? (s.data() as Record<string, unknown>) : null;
      const data: SupplyData | null = raw
        ? {
            ...(raw.ingredientId ? { ingredientId: raw.ingredientId as string } : {}),
            label: String(raw.label ?? want[i]),
            canonicalUnit: (raw.canonicalUnit as "g" | "count") ?? "g",
            lots: ((raw.lots as unknown[]) ?? []).map((l) => lotFromDoc(l as never, toMs)),
            ...(raw.cookEventId ? { cookEventId: raw.cookEventId as string } : {}),
            ...(raw.leftoverMealType ? { leftoverMealType: raw.leftoverMealType as MealType } : {}),
          }
        : null;
      this.entries.set(want[i]!, { ref: this.ref(want[i]!), exists: s.exists, data, txs: [], dirty: false });
    });
  }

  private entry(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`supply ${id} not loaded`);
    return e;
  }

  get(id: string): SupplyData | null {
    return this.entry(id).data;
  }

  /** The doc, created in memory from `init` when it doesn't exist yet. */
  ensure(id: string, init: () => Omit<SupplyData, "lots">): SupplyData {
    const e = this.entry(id);
    if (!e.data) e.data = { ...init(), lots: [] };
    return e.data;
  }

  apply(id: string, r: LedgerResult, opts: { ref?: { type: string; id: string }; short?: boolean; clearShort?: boolean } = {}): void {
    const e = this.entry(id);
    if (!e.data) throw new Error(`supply ${id} missing`);
    e.data.lots = r.lots;
    if (opts.short) e.data.short = true;
    if (opts.clearShort) e.data.clearShort = true;
    for (const t of r.txs) e.txs.push({ ...t, ...(opts.ref ? { ref: opts.ref } : {}) });
    e.dirty = true;
  }

  /** Writes changed docs and one transaction doc per ledger transaction. */
  commit(): void {
    for (const e of this.entries.values()) {
      if (!e.dirty || !e.data) continue;
      const d = e.data;
      const next = nextExpiry(d.lots);
      const doc: Record<string, unknown> = {
        label: d.label,
        canonicalUnit: d.canonicalUnit,
        canonicalAmount: recomputeAmount(d.lots),
        lots: d.lots.map((l) => lotToDoc(l, ts)),
        nextExpiry: next ? ts(next) : null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (d.ingredientId) doc.ingredientId = d.ingredientId;
      if (d.cookEventId) doc.cookEventId = d.cookEventId;
      if (d.leftoverMealType) doc.leftoverMealType = d.leftoverMealType;
      if (d.short) doc.shortAt = FieldValue.serverTimestamp();
      else if (d.clearShort) doc.shortAt = null;
      this.tx.set(e.ref, doc, { merge: true });
      for (const t of e.txs) {
        const txDoc: Record<string, unknown> = { delta: t.delta, kind: t.kind, lotId: t.lotId, uid: this.uid, commandId: this.commandId, createdAt: FieldValue.serverTimestamp() };
        if (t.note) txDoc.note = t.note;
        if (t.ref) txDoc.ref = t.ref;
        this.tx.set(e.ref.collection("transactions").doc(), txDoc);
      }
    }
  }
}
