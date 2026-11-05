// Ingredients (TECHNICAL_SPECS §4.1, §5). The editor and picker follow the whole collection (allowlisted users, cached
// offline); recipe pages, which also render signed out, read the ingredients they need one by one (public `get`).

import { useMemo } from "react";
import { collection, deleteField, doc, serverTimestamp, setDoc, updateDoc, type DocumentData } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  buildIngredientIndex,
  needsReview,
  normalizeName,
  variantKey,
  type IngredientDoc,
  type IngredientIndex,
  type MergeReport,
  type RecipeIngredientInfo,
} from "@solving-food/core";
import { db, functions } from "@/firebase/app";
import { useLiveDocs, useLiveQuery } from "./live";

export interface IngredientEntry extends IngredientDoc {
  id: string;
}

/**
 * Every ingredient, live. Only for signed-in, allowlisted users (rules: `list` needs the allowlist). `list` leaves out
 * merged duplicates (M8: pickers never offer them); `byId` keeps them so old references still show a name, and the
 * index resolves their names to the ingredient they were merged into.
 */
export function useAllIngredients(enabled = true): { list: IngredientEntry[] | undefined; byId: ReadonlyMap<string, IngredientEntry>; index: IngredientIndex } {
  const q = useLiveQuery<IngredientDoc>(enabled ? collection(db, "ingredients") : null, enabled ? "ingredients" : null);
  return useMemo(() => {
    const all = q.docs?.map((d) => ({ id: d.id, ...d.data }));
    const byId = new Map((all ?? []).map((i) => [i.id, i]));
    return { list: all?.filter((i) => !i.mergedInto), byId, index: buildIngredientIndex(all ?? []) };
  }, [q.docs]);
}

/** A waiting name is its own ingredient (R4.35: Claude said "new"): it stops waiting. */
export async function markNameNew(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "ingredients", id), { nameCheck: "new", updatedBy: uid, updatedAt: serverTimestamp() });
}

/** Merges a duplicate into the ingredient it means (M8; since M15 used by the Claude answer, R4.35): the mergeIngredient
 * function, the app's owner only (M22; `hid` names the caller's household, which the emulator's stub owner needs);
 * `dryRun` returns what would move. Needs a connection. */
export async function mergeIngredient(hid: string, fromId: string, intoId: string, dryRun = false): Promise<MergeReport> {
  const fn = httpsCallable<{ hid: string; fromId: string; intoId: string; dryRun: boolean }, MergeReport>(functions, "mergeIngredient");
  return (await fn({ hid, fromId, intoId, dryRun })).data;
}

const toIngredient = (id: string, data: DocumentData): IngredientEntry => ({ id, ...(data as IngredientDoc) });

/** Specific ingredients by ID, each its own live document (works signed out), diffed as the IDs change (M23). */
export function useIngredientsById(ids: readonly string[]): ReadonlyMap<string, IngredientEntry> {
  return useLiveDocs("ingredients", ids, toIngredient);
}

/** The lookup recipe math needs (core `IngredientLookup`). */
export function lookupFromMap(map: ReadonlyMap<string, IngredientEntry>) {
  return (id: string): RecipeIngredientInfo | undefined => map.get(id);
}

/** Creates or updates an ingredient in the app. `needsReview` is derived from what's filled in (§5). */
export async function saveIngredient(id: string, data: Omit<IngredientDoc, "needsReview" | "createdBy" | "updatedBy" | "updatedAt">, uid: string, isNew: boolean): Promise<void> {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && !(typeof v === "number" && Number.isNaN(v))));
  const body: Record<string, unknown> = {
    ...clean,
    needsReview: needsReview(data),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
  if (isNew) {
    body.createdBy = uid;
    await setDoc(doc(db, "ingredients", id), body);
    return;
  }
  // Edits merge (createdBy survives); a cleared optional field is deleted.
  for (const k of OPTIONAL_INGREDIENT_KEYS) if (!(k in body)) body[k] = deleteField();
  await setDoc(doc(db, "ingredients", id), body, { merge: true });
}

/** Optional fields; omitting one in an edit clears it (the editor always sends `side` when the ingredient is one). */
export const OPTIONAL_INGREDIENT_KEYS = ["densityGPerMl", "unitWeightG", "proteinPer100g", "fibrePer100g", "nutrients", "nutrientSource", "defaultPackAmount", "defaultPackMeasure", "defaultCadenceDays", "side"];

/** Ranks ingredients for a query: exact name/alias, then prefix, then word prefix, then substring (the picker). */
export function searchIngredients(list: readonly IngredientEntry[], query: string, max = 8): IngredientEntry[] {
  // Spelling variants fold on both sides (M8): "chilli" finds chili powder, "courgette" zucchini.
  const q = variantKey(normalizeName(query));
  if (!q) return [];
  const scored: Array<[number, IngredientEntry]> = [];
  for (const i of list) {
    if (i.mergedInto) continue;
    let best = 0;
    for (const n of [i.name, ...i.aliases]) {
      const k = variantKey(normalizeName(n));
      const isName = n === i.name ? 0.5 : 0;
      if (k === q) best = Math.max(best, 100 + isName);
      else if (k.startsWith(q)) best = Math.max(best, 60 + isName - k.length / 100);
      else if (k.split(" ").some((w) => w.startsWith(q))) best = Math.max(best, 40 + isName - k.length / 100);
      else if (k.includes(q)) best = Math.max(best, 20 + isName);
    }
    if (best > 0) scored.push([best, i]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, max).map(([, i]) => i);
}
