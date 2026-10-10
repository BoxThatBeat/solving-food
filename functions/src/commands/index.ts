// The command dispatcher (TECHNICAL_SPECS §6): onDocumentCreated(households/{hid}/commands/{id}) validates the payload
// with the shared zod schemas and applies it in one Firestore transaction, then marks the command applied (with a
// note for no-op outcomes) or failed with an error, which also reaches the issuer as an error banner.
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_TIMEZONE, parseCommand, type AnyCommand, type IngredientDoc, type RecipeDoc } from "@solving-food/core";
import { db } from "../admin";
import { notify } from "../notify";
import { runHandler, type Ctx } from "./handlers";
import { CommandError, SupplyStore } from "./store";

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

  const household = await db.doc(`households/${hid}`).get();
  if (!household.exists) return fail("Household not found");
  const hd = household.data()!;
  const ingredients = new Map<string, Promise<(IngredientDoc & { id: string }) | undefined>>();
  const recipes = new Map<string, Promise<(RecipeDoc & { id: string }) | undefined>>();
  const loadIngredient = (id: string) => {
    let p = ingredients.get(id);
    if (!p) {
      p = db.doc(`ingredients/${id}`).get().then((s) => (s.exists ? { ...(s.data() as IngredientDoc), id } : undefined));
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
