// The command dispatcher (TECHNICAL_SPECS §6): onDocumentCreated(households/{hid}/commands/{id}) validates the payload
// with the shared zod schemas and applies it in one Firestore transaction, then marks the command applied (with a
// note for no-op outcomes) or failed with an error, which also reaches the issuer as an error banner. M22: a grocery
// list longer than RECEIVE_CHUNK lines is applied in several transactions, and stuck commands are failed (here, for the
// same household, and weekly by maintenance).
import { FieldValue, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { DEFAULT_TIMEZONE, parseCommand, receiveChunks, type AnyCommand, type IngredientDoc, type RecipeDoc } from "@solving-food/core";
import { db } from "../admin";
import { notify } from "../notify";
import { receiveGroceries, runHandler, type Ctx, type ReceivePart } from "./handlers";
import { CommandError, SupplyStore } from "./store";
import { runImport } from "../importHousehold";

export { CommandError } from "./store";

export interface ApplyResult {
  status: "applied" | "failed" | "skipped";
  error?: string;
  result?: string;
}

const LABELS: Record<string, string> = {
  addSupply: "add to supply",
  receiveGroceries: "confirm the groceries",
  finishCooking: "finish cooking",
  submitReview: "save the review",
  correctSupply: "correct supply",
  discard: "record the discard",
  extendExpiry: "extend the expiry",
  freeze: "freeze it",
  thaw: "thaw it",
  markEaten: "mark it eaten",
  importHousehold: "import household data",
  snoozeCadence: "snooze the reminder",
};

function zodMessage(e: unknown): string {
  const issues = (e as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (issues?.length) return issues.map((i) => `${i.path.map(String).join(".") || "command"}: ${i.message}`).join("; ");
  return (e as Error).message ?? String(e);
}

/**
 * A command still pending (or an import still running) this long after it reached the server is stuck (M22): the
 * `commands` trigger runs with `retry: false`, so a timeout or crash before it marked the command leaves it pending, and
 * the client's optimistic projection would show its effect forever. Commands take about a second, imports ≤ 300 s.
 */
export const STUCK_AFTER_MS = 2 * 3_600_000;
/** How many of a household's pending commands each applyCommand looks at for stuck ones (the fast path). */
const STUCK_SCAN = 20;
export const STUCK_ERROR = "it didn't finish on the server; check Supply, then try again";

/** What a failed command tells its issuer (`Couldn't confirm the groceries: …`). */
export async function notifyFailed(uid: string, type: unknown, error: string): Promise<void> {
  if (uid) await notify(uid, { kind: "error", message: `Couldn't ${LABELS[String(type)] ?? "apply that"}: ${error}` }).catch(() => undefined);
}

function createdMs(d: Record<string, unknown>): number | null {
  const c = d.createdAt;
  return c instanceof Timestamp ? c.toMillis() : null;
}

/**
 * Marks stuck commands failed (M22): pending or running, created more than STUCK_AFTER_MS before `nowMs`. Each is
 * re-checked in a transaction (still stuck?) and its issuer gets the error banner, so the projection drops it and the
 * person knows to redo it. Returns how many were failed. Used by applyCommand (bounded) and the weekly maintenance.
 */
export async function failStuckCommands(docs: QueryDocumentSnapshot[], nowMs: number, skipId?: string): Promise<number> {
  let n = 0;
  for (const d of docs) {
    if (d.id === skipId) continue;
    const at = createdMs(d.data());
    if (at === null || at > nowMs - STUCK_AFTER_MS) continue;
    const failed = await db.runTransaction(async (tx) => {
      const s = await tx.get(d.ref);
      const x = s.data();
      if (!x || (x.status !== "pending" && x.status !== "running")) return null;
      const c = createdMs(x);
      if (c === null || c > nowMs - STUCK_AFTER_MS) return null;
      tx.update(d.ref, { status: "failed", error: STUCK_ERROR, appliedAt: FieldValue.serverTimestamp() });
      return x;
    });
    if (failed) {
      n++;
      await notifyFailed(String(failed.uid ?? ""), failed.type, STUCK_ERROR);
    }
  }
  return n;
}

/** The fast path: a household's other pending commands, a bounded look, failed when stuck. Never throws. */
async function sweepHousehold(hid: string, cmdId: string, nowMs: number): Promise<void> {
  try {
    const pending = await db.collection(`households/${hid}/commands`).where("status", "in", ["pending", "running"]).limit(STUCK_SCAN).get();
    const n = await failStuckCommands(pending.docs, nowMs, cmdId);
    if (n) console.warn("stuck commands failed", { hid, n });
  } catch (e) {
    console.warn("stuck command sweep failed", { hid, error: (e as Error).message });
  }
}

export async function applyCommand(hid: string, cmdId: string, nowMs = Date.now()): Promise<ApplyResult> {
  const r = await applyOne(hid, cmdId, nowMs);
  if (r.status !== "skipped") await sweepHousehold(hid, cmdId, nowMs);
  return r;
}

async function applyOne(hid: string, cmdId: string, nowMs: number): Promise<ApplyResult> {
  const cmdRef = db.doc(`households/${hid}/commands/${cmdId}`);
  const snap = await cmdRef.get();
  if (!snap.exists) return { status: "skipped" };
  const data = snap.data()!;
  if (data.status !== "pending") return { status: "skipped" };
  const uid = String(data.uid ?? "");

  const fail = async (error: string): Promise<ApplyResult> => {
    await cmdRef.update({ status: "failed", error: error.slice(0, 500), appliedAt: FieldValue.serverTimestamp() });
    await notifyFailed(uid, data.type, error);
    return { status: "failed", error };
  };

  let cmd: AnyCommand;
  try {
    cmd = parseCommand(data as { type: unknown; payload: unknown });
  } catch (e) {
    return fail(zodMessage(e));
  }

  // An import replaces the whole household: it runs outside the single command transaction (§13).
  if (cmd.type === "importHousehold") {
    const r = await runImport(hid, cmdId, uid, cmd.payload.path);
    return { status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.result ? { result: r.result } : {}) };
  }

  // A review written offline can reach the server together with (or before) its finishCooking: apply that first.
  if (cmd.type === "submitReview") await ensureCookEvent(hid, cmd.payload.cookEventId, nowMs);

  const household = await db.doc(`households/${hid}`).get();
  if (!household.exists) return fail("Household not found");
  const hd = household.data()!;
  const ingredients = new Map<string, Promise<(IngredientDoc & { id: string }) | undefined>>();
  const recipes = new Map<string, Promise<(RecipeDoc & { id: string }) | undefined>>();
  const loadIngredient = (id: string) => {
    let p = ingredients.get(id);
    if (!p) {
      // A merged duplicate (M8) stands for the ingredient it was merged into, so a command queued offline before the
      // merge adds to the right Supply row.
      p = db
        .doc(`ingredients/${id}`)
        .get()
        .then(async (s) => {
          const d = s.exists ? (s.data() as IngredientDoc) : undefined;
          if (d?.mergedInto && d.mergedInto !== id) {
            const t = await db.doc(`ingredients/${d.mergedInto}`).get();
            if (t.exists) return { ...(t.data() as IngredientDoc), id: t.id };
          }
          return d ? { ...d, id } : undefined;
        });
      ingredients.set(id, p);
    }
    return p;
  };
  const loadRecipe = (id: string) => {
    let p = recipes.get(id);
    if (!p) {
      p = db.doc(`recipes/${id}`).get().then((s) => (s.exists ? { ...(s.data() as RecipeDoc), id } : undefined));
      recipes.set(id, p);
    }
    return p;
  };

  /** One transaction: the whole command, or (M22) one part of a long grocery list (`index` of `parts`). */
  const runTx = (part?: ReceivePart & { index: number }) =>
    db.runTransaction(async (tx) => {
      const fresh = await tx.get(cmdRef);
      const f = fresh.data();
      if (f?.status !== "pending") return { skipped: true as const };
      // A part applied before (the same command dispatched twice): go on with the next.
      if (part && Number(f.receivedParts ?? 0) > part.index) return { skipped: false as const, outcome: undefined, done: false };
      const ctx: Ctx = {
        tx,
        hid,
        uid,
        cmdId,
        nowMs,
        tz: (hd.timezone as string) || DEFAULT_TIMEZONE,
        currentPeriodId: (hd.currentPeriodId as string | null) ?? null,
        store: new SupplyStore(tx, hid, uid, cmdId),
        ingredient: loadIngredient,
        recipe: loadRecipe,
      };
      const outcome = part && cmd.type === "receiveGroceries" ? await receiveGroceries(ctx, cmd.payload, part) : await runHandler(ctx, cmd);
      // A part before the last only records its progress; the last (or a whole command) marks it applied.
      if (part && !part.last && outcome === undefined) tx.update(cmdRef, { receivedParts: part.index + 1 });
      else tx.update(cmdRef, { status: "applied", appliedAt: FieldValue.serverTimestamp(), ...(outcome ? { result: outcome } : {}) });
      return { skipped: false as const, outcome, done: !part || part.last || outcome !== undefined };
    });

  try {
    const chunks = cmd.type === "receiveGroceries" ? receiveChunks(cmd.payload.items) : [];
    let result: Awaited<ReturnType<typeof runTx>>;
    if (chunks.length > 1) {
      // A long grocery list (M22): one transaction per chunk, so none passes Firestore's 500-write limit.
      const seen = new Set<string>();
      result = { skipped: true };
      for (let i = 0; i < chunks.length; i++) {
        const cadenceDone = new Set(seen);
        for (const it of chunks[i]!) if (it.ingredientId) seen.add(it.ingredientId);
        result = await runTx({ items: chunks[i]!, last: i === chunks.length - 1, cadenceDone, index: i });
        if (result.skipped || ("done" in result && result.done)) break;
      }
    } else result = await runTx();
    if (result.skipped) return { status: "skipped" };
    return { status: "applied", ...(result.outcome ? { result: result.outcome } : {}) };
  } catch (e) {
    if (e instanceof CommandError) return fail(e.message);
    console.error("command failed", { hid, cmdId, type: cmd.type, error: e });
    return fail("something went wrong on the server; try again");
  }
}

/** Makes sure the cook event a review refers to exists: applies its pending finishCooking, or waits briefly for it. */
async function ensureCookEvent(hid: string, cookEventId: string, nowMs: number): Promise<void> {
  const ref = db.doc(`households/${hid}/cookEvents/${cookEventId}`);
  if ((await ref.get()).exists) return;
  const finish = await db.collection(`households/${hid}/commands`).where("payload.cookEventId", "==", cookEventId).where("type", "==", "finishCooking").limit(1).get();
  const f = finish.docs[0];
  if (f && f.data().status === "pending") await applyCommand(hid, f.id, nowMs);
  for (let i = 0; i < 20 && !(await ref.get()).exists; i++) await new Promise((r) => setTimeout(r, 500));
}
