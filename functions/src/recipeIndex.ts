// Search index maintenance (TECHNICAL_SPECS §9 "Search"): `recipeIndex/{chunk}` documents hold compact summaries of
// active recipes, ≤ CHUNK_CAPACITY recipes per chunk. A recipe gets a chunk on its first write (a chunk with room, else
// a new one, written back as `indexChunk` without a version bump) and keeps it. Trashed and pending-duplicate recipes
// are removed from their chunk's summaries but keep their place. One transaction per write that can change the index;
// writes that can't (stats, timestamps, the `indexChunk` echo) are skipped without touching Firestore: every
// transaction reads and rewrites a whole chunk, and in the e2e suite (hundreds of recipes, two writers) 500-summary
// chunks got slow enough to stall the emulator for everyone.
import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";
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

/** A chunk with room (one query, so only that chunk is read and locked), else the next number after the highest. */
async function findChunkWithRoom(tx: Transaction): Promise<number> {
  const open = await tx.get(chunks().where("count", "<", CHUNK_CAPACITY).limit(1));
  if (!open.empty) return Number(open.docs[0]!.id);
  const ids = (await chunks().listDocuments()).map((d) => Number(d.id)).filter((n) => Number.isInteger(n));
  return ids.length ? Math.max(...ids) + 1 : 0;
}

function sameSummary(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  await db.runTransaction(async (tx) => {
    if (!after) {
      const n = before?.indexChunk;
      if (typeof n !== "number") return;
      const snap = await tx.get(chunkRef(n));
      if (!snap.exists) return;
      const chunk = snap.data() as IndexChunk;
      tx.update(chunkRef(n), {
        [`recipes.${id}`]: FieldValue.delete(),
        count: Math.max(0, (chunk.count ?? 1) - 1),
      });
      return;
    }
    // Re-read inside the transaction: the doc may have changed (e.g. our own indexChunk write).
    const current = await tx.get(recipeRef);
    if (!current.exists) return;
    const recipe = current.data() as RecipeDoc;
    let n = recipe.indexChunk;
    let assigned = false;
    if (typeof n !== "number") {
      n = await findChunkWithRoom(tx);
      assigned = true;
    }
    const snap = await tx.get(chunkRef(n));
    const chunk: IndexChunk = snap.exists ? (snap.data() as IndexChunk) : { count: 0, recipes: {} };
    const existing = chunk.recipes?.[id];
    const summary = isIndexed(recipe.status) ? recipeSummary(id, recipe) : null;
    const update: Record<string, unknown> = {};
    if (summary && !sameSummary(existing, summary)) update[`recipes.${id}`] = summary;
    if (!summary && existing) update[`recipes.${id}`] = FieldValue.delete();
    if (assigned) update.count = (chunk.count ?? 0) + 1;
    if (Object.keys(update).length) {
      if (snap.exists) tx.update(chunkRef(n), update);
      else tx.set(chunkRef(n), { count: assigned ? 1 : 0, recipes: summary ? { [id]: summary } : {} });
    }
    if (assigned) tx.update(recipeRef, { indexChunk: n });
  });
}

/** Every summary in the index (for the drop folder's duplicate check). */
export async function loadIndex(): Promise<RecipeSummary[]> {
  const snap = await chunks().get();
  return snap.docs.flatMap((d) => Object.values((d.data() as IndexChunk).recipes ?? {}));
}
