// The command dispatcher (TECHNICAL_SPECS §6): onDocumentCreated(households/{hid}/commands/{id}) validates the payload
// with the shared zod schemas and applies it in one Firestore transaction, then marks the command applied (with a
// note for no-op outcomes) or failed with an error, which also reaches the issuer as an error banner.
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_TIMEZONE, parseCommand, type AnyCommand, type IngredientDoc, type RecipeDoc } from "@solving-food/core";
import { db } from "../admin";
import { notify } from "../notify";
import { runHandler, type Ctx } from "./handlers";
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

export async function applyCommand(hid: string, cmdId: string, nowMs = Date.now()): Promise<ApplyResult> {
  const cmdRef = db.doc(`households/${hid}/commands/${cmdId}`);
  const snap = await cmdRef.get();
  if (!snap.exists) return { status: "skipped" };
  const data = snap.data()!;
  if (data.status !== "pending") return { status: "skipped" };
  const uid = String(data.uid ?? "");

  const fail = async (error: string): Promise<ApplyResult> => {
    await cmdRef.update({ status: "failed", error: error.slice(0, 500), appliedAt: FieldValue.serverTimestamp() });
    if (uid) await notify(uid, { kind: "error", message: `Couldn't ${LABELS[String(data.type)] ?? "apply that"}: ${error}` }).catch(() => undefined);
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

  try {
    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(cmdRef);
      if (fresh.data()?.status !== "pending") return { skipped: true as const };
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
      const outcome = await runHandler(ctx, cmd);
      tx.update(cmdRef, { status: "applied", appliedAt: FieldValue.serverTimestamp(), ...(outcome ? { result: outcome } : {}) });
      return { skipped: false as const, outcome };
    });
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
