// Cook notes (M28, PRD R4.38, R4.39, R9.6; TECHNICAL_SPECS §12 "Cook notes"): the newest cook events with a note for
// some recipes, from one bounded query (`notedRecipeIds` array-contains-any, newest first, 5 per recipe; the composite
// index in firestore.indexes.json). Mise en place, step mode, the review and the recipe page share it per recipe set.
import { useMemo } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { COOK_NOTES_SHOWN, type NotedEvent } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "./live";
import { hh } from "./paths";
import { millis } from "@/lib/millis";
import type { StoredEvent } from "./supply";

/** Firestore's array-contains-any takes at most 30 values; a meal has far fewer recipes. */
const ANY_MAX = 30;

/** The noted cook events of these recipes (undefined while loading; empty without a household or recipes). */
export function useCookNotes(hid: string | null, recipeIds: readonly string[]): NotedEvent[] | undefined {
  const ids = useMemo(() => [...new Set(recipeIds)].sort().slice(0, ANY_MAX), [recipeIds]);
  const key = ids.join(",");
  const q = useLiveQuery<StoredEvent>(
    hid && ids.length ? query(collection(db, "households", hid, "cookEvents"), where("notedRecipeIds", "array-contains-any", ids), orderBy("cookedAt", "desc"), limit(COOK_NOTES_SHOWN * ids.length)) : null,
    hid && ids.length ? `${hh(hid, "cookEvents")}?noted=${key}` : null,
  );
  return useMemo(() => {
    if (!hid || !ids.length) return [];
    if (q.docs === undefined) return undefined;
    return q.docs.map((d) => ({ id: d.id, cookedAtMs: millis(d.data.cookedAt) ?? 0, cookedBy: d.data.cookedBy, recipeIds: d.data.recipeIds, note: d.data.note, stepNotes: d.data.stepNotes }));
  }, [hid, ids.length, q.docs]);
}
