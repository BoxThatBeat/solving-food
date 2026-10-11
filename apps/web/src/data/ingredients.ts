// Ingredients (TECHNICAL_SPECS §4.1, §5). The editor and picker follow the whole collection (allowlisted users, cached
// offline); recipe pages, which also render signed out, read the ingredients they need one by one (public `get`).

import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from "firebase/firestore";
import {
  buildIngredientIndex,
  needsReview,
  normalizeName,
  type IngredientDoc,
  type IngredientIndex,
  type RecipeIngredientInfo,
} from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "./live";

export interface IngredientEntry extends IngredientDoc {
  id: string;
}

/** Every ingredient, live. Only for signed-in, allowlisted users (rules: `list` needs the allowlist). */
export function useAllIngredients(enabled = true): { list: IngredientEntry[] | undefined; byId: Map<string, IngredientEntry>; index: IngredientIndex } {
  const q = useLiveQuery<IngredientDoc>(enabled ? collection(db, "ingredients") : null, enabled ? "ingredients" : null);
  return useMemo(() => {
    const list = q.docs?.map((d) => ({ id: d.id, ...d.data }));
    const byId = new Map((list ?? []).map((i) => [i.id, i]));
    return { list, byId, index: buildIngredientIndex(list ?? []) };
  }, [q.docs]);
}

/** Specific ingredients by ID, each its own live document (works signed out). */
export function useIngredientsById(ids: readonly string[]): Map<string, IngredientEntry> {
  const key = [...new Set(ids)].sort().join(",");
  const [state, setState] = useState<{ key: string; map: Map<string, IngredientEntry> }>({ key: "", map: new Map() });
  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    const unsubs: Unsubscribe[] = wanted.map((id) =>
      onSnapshot(
        doc(db, "ingredients", id),
        (snap) => {
          setState((s) => {
            const map = new Map(s.key === key ? s.map : []);
            if (snap.exists()) map.set(id, { id, ...(snap.data() as IngredientDoc) });
            else map.delete(id);
            return { key, map };
          });
        },
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return state.key === key ? state.map : new Map();
}

/** The lookup recipe math needs (core `IngredientLookup`). */
export function lookupFromMap(map: Map<string, IngredientEntry>) {
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
export const OPTIONAL_INGREDIENT_KEYS = ["densityGPerMl", "unitWeightG", "proteinPer100g", "defaultPackAmount", "defaultPackMeasure", "defaultCadenceDays", "side"];

/** Ranks ingredients for a query: exact name/alias, then prefix, then word prefix, then substring (the picker). */
export function searchIngredients(list: readonly IngredientEntry[], query: string, max = 8): IngredientEntry[] {
  const q = normalizeName(query);
  if (!q) return [];
  const scored: Array<[number, IngredientEntry]> = [];
  for (const i of list) {
    let best = 0;
    for (const n of [i.name, ...i.aliases]) {
      const k = normalizeName(n);
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
