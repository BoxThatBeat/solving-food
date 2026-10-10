// Search index maintenance (TECHNICAL_SPECS §9 "Search"): `recipeIndex/{chunk}` documents hold compact summaries of
// active recipes, ≤ CHUNK_CAPACITY recipes per chunk. A recipe gets a chunk on its first write (the lowest chunk with
// room, written back as `indexChunk` without a version bump) and keeps it. Trashed and pending-duplicate recipes are
// removed from their chunk's summaries but keep their place. One transaction per write.
import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { isIndexed, recipeSummary, type RecipeDoc, type RecipeSummary } from "@solving-food/core";
import { db } from "./admin";

export const CHUNK_CAPACITY = 500;

export interface IndexChunk {
  /** Recipes assigned to this chunk (indexed or not). */
  count: number;
  /** Summaries of the indexed (active) recipes in this chunk, by recipe ID. */
  recipes: Record<string, RecipeSummary>;
}

const chunkRef = (n: number) => db.collection("recipeIndex").doc(String(n));

async function findChunkWithRoom(tx: Transaction): Promise<number> {
  for (let n = 0; ; n++) {
    const snap = await tx.get(chunkRef(n));
    if (!snap.exists || ((snap.data() as IndexChunk).count ?? 0) < CHUNK_CAPACITY) return n;
  }
}

function sameSummary(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Brings the index in line with the recipe's current state. `after` null means the recipe was deleted. */
export async function syncRecipeIndex(id: string, before: DocumentData | null, after: DocumentData | null): Promise<void> {
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
  const snap = await db.collection("recipeIndex").get();
  return snap.docs.flatMap((d) => Object.values((d.data() as IndexChunk).recipes ?? {}));
}
