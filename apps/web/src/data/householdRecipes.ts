// The active household's facts about recipes: favourites (R4.6), notes (R4.8), and cook stats (function-maintained,
// M3; read now for filters and cards).

import { useMemo } from "react";
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { NO_FACTS, type FavouriteDoc, type HouseholdFacts, type NoteDoc, type StatsDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc, useLiveQuery } from "./live";

export function useFavourites(hid: string | null) {
  const q = useLiveQuery<FavouriteDoc>(hid ? collection(db, "households", hid, "favourites") : null, hid ? `households/${hid}/favourites` : null);
  return useMemo(() => new Set((q.docs ?? []).filter((d) => d.data.type === "recipe").map((d) => d.data.targetId)), [q.docs]);
}

export async function setFavourite(hid: string, recipeId: string, on: boolean): Promise<void> {
  const ref = doc(db, "households", hid, "favourites", `recipe_${recipeId}`);
  if (on) await setDoc(ref, { type: "recipe", targetId: recipeId });
  else await deleteDoc(ref);
}

export function useNotes(hid: string | null) {
  const q = useLiveQuery<NoteDoc>(hid ? collection(db, "households", hid, "notes") : null, hid ? `households/${hid}/notes` : null);
  return useMemo(() => new Map((q.docs ?? []).map((d) => [d.id, d.data.text])), [q.docs]);
}

export function useNote(hid: string | null, recipeId: string) {
  return useLiveDoc<NoteDoc>(hid ? doc(db, "households", hid, "notes", recipeId) : null, hid ? `households/${hid}/notes/${recipeId}` : null);
}

export async function saveNote(hid: string, recipeId: string, text: string, uid: string): Promise<void> {
  const ref = doc(db, "households", hid, "notes", recipeId);
  if (!text.trim()) await deleteDoc(ref);
  else await setDoc(ref, { text: text.trim(), updatedBy: uid, updatedAt: serverTimestamp() });
}

export function useStats(hid: string | null) {
  const q = useLiveQuery<StatsDoc>(hid ? collection(db, "households", hid, "stats") : null, hid ? `households/${hid}/stats` : null);
  return useMemo(() => new Map((q.docs ?? []).filter((d) => d.id.startsWith("recipe_")).map((d) => [d.id.slice(7), d.data])), [q.docs]);
}

function millis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}

/** Everything <CollectionView> needs to know about the household for each recipe. */
export function useHouseholdFacts(hid: string | null): (id: string) => HouseholdFacts {
  const favs = useFavourites(hid);
  const stats = useStats(hid);
  return useMemo(() => {
    return (id: string): HouseholdFacts => {
      const s = stats.get(id);
      const favourite = favs.has(id);
      if (!s && !favourite) return NO_FACTS;
      return {
        favourite,
        timesCooked: s?.timesCooked ?? 0,
        lastCookedAtMs: millis(s?.lastCookedAt),
        rating: s && s.ratingCount > 0 ? s.ratingSum / s.ratingCount : null,
      };
    };
  }, [favs, stats]);
}
