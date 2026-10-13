// Search index maintenance (TECHNICAL_SPECS §9 "Search"): `recipeIndex/{chunk}` documents hold compact summaries of
// active recipes, about CHUNK_CAPACITY recipes per chunk (a soft cap: concurrent creates may overfill one by a few). A
// recipe gets a chunk on its first write (a chunk with room, else a new one, written back as `indexChunk` without a
// version bump) and keeps it. Trashed and pending-duplicate recipes are removed from their chunk's summaries but keep
// their place.
//
// No transaction ever touches a chunk: the Firestore emulator's basic locking makes writes that target one document
// slow and holds locks for up to 30 s (its docs say so), and in the e2e suite every recipe write of two workers landed
// on the same chunk, until the emulator stopped answering anyone. Summaries are written with merge sets (field-level,
// no read), the count with increments, and the only transaction is on the recipe document itself, to assign its chunk
// once. Writes that can't change the index (stats, timestamps, the `indexChunk` echo) are skipped without a read.
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { isIndexed, recipeSummary, type RecipeDoc, type RecipeSummary } from "@solving-food/core";
import { db } from "./admin";

export const CHUNK_CAPACITY = 100;

export interface IndexChunk {
  /** Recipes assigned to this chunk (indexed or not). */
  count: number;
  /** Summaries of the indexed (active) recipes in this chunk, by recipe ID. */
  recipes: Record<string, RecipeSummary>;
}

const chunks = () => db.collection("recipeIndex");
const chunkRef = (n: number) => chunks().doc(String(n));

/** A chunk with room (one query), else the next number after the highest. */
async function findChunkWithRoom(): Promise<number> {
  const open = await chunks().where("count", "<", CHUNK_CAPACITY).limit(1).get();
  if (!open.empty) return Number(open.docs[0]!.id);
  const ids = (await chunks().listDocuments()).map((d) => Number(d.id)).filter((n) => Number.isInteger(n));
  return ids.length ? Math.max(...ids) + 1 : 0;
}

/** JSON with object keys sorted at every level: Firestore returns map keys in its own order (a merge set scrambles
 *  them), so a plain JSON.stringify comparison would see every merged summary as changed. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x,
  );
}

export function sameSummary(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** True when a write from `before` to `after` can't change the index: the chunk is assigned and neither the summary nor
 *  whether the recipe is indexed changed. */
export function indexUnchanged(id: string, before: DocumentData | null, after: DocumentData | null): boolean {
  if (!before || !after || typeof after.indexChunk !== "number") return false;
  if (isIndexed(before.status) !== isIndexed(after.status)) return false;
  try {
    return sameSummary(recipeSummary(id, before as RecipeDoc), recipeSummary(id, after as RecipeDoc));
  } catch {
    return false;
  }
}

/** Brings the index in line with the recipe's current state. `after` null means the recipe was deleted. */
export async function syncRecipeIndex(id: string, before: DocumentData | null, after: DocumentData | null): Promise<void> {
  if (indexUnchanged(id, before, after)) return;
  const recipeRef = db.collection("recipes").doc(id);
  // An update, not a merge set: a chunk that's gone (test cleanup, a purge) must stay gone, not come back as a
  // document holding one deleted key and a negative count.
  const leave = async (n: unknown, freePlace: boolean) => {
    if (typeof n !== "number") return;
    const patch: Record<string, unknown> = { [`recipes.${id}`]: FieldValue.delete() };
    if (freePlace) patch.count = FieldValue.increment(-1);
    await chunkRef(n).update(patch).catch((e: { code?: number }) => {
      if (e.code !== 5) throw e; // NOT_FOUND
    });
  };
  if (!after) {
    await leave(before?.indexChunk, true);
    return;
  }
  // Re-read: events can arrive out of order, and the doc may have changed (e.g. our own indexChunk write).
  const current = await recipeRef.get();
  if (!current.exists) {
    await leave(before?.indexChunk ?? after.indexChunk, true);
    return;
  }
  const recipe = current.data() as RecipeDoc;
  const summary = isIndexed(recipe.status) ? recipeSummary(id, recipe) : null;
  if (typeof recipe.indexChunk === "number") {
    if (summary) await chunkRef(recipe.indexChunk).set({ recipes: { [id]: summary } }, { merge: true });
    else await leave(recipe.indexChunk, false);
    return;
  }
  // First write: pick a chunk outside any transaction, then claim it on the recipe doc alone. Another event for the
  // same recipe (a create and the update right after it) may be doing the same: the first commit wins, and the other
  // still writes its summary to the claimed chunk, because its read may be the newer one and the winner's may have
  // been of a state that wasn't indexed yet.
  const pick = await findChunkWithRoom();
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(recipeRef);
    if (!snap.exists) return null;
    const have = snap.data()!.indexChunk;
    if (typeof have === "number") return have as number;
    tx.update(recipeRef, { indexChunk: pick });
    // Never `recipes: {}` here: a merge set treats an empty map as a value and would wipe the chunk's summaries.
    tx.set(chunkRef(pick), summary ? { count: FieldValue.increment(1), recipes: { [id]: summary } } : { count: FieldValue.increment(1) }, { merge: true });
    return null;
  });
  if (claimed === null) return;
  if (summary) await chunkRef(claimed).set({ recipes: { [id]: summary } }, { merge: true });
  else await leave(claimed, false);
}

/** Every summary in the index (for the drop folder's duplicate check). */
export async function loadIndex(): Promise<RecipeSummary[]> {
  const snap = await chunks().get();
  return snap.docs.flatMap((d) => Object.values((d.data() as IndexChunk).recipes ?? {}));
}
