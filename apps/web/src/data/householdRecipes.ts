// The active household's facts about recipes: favourites (R4.6), notes (R4.8), and cook stats (function-maintained,
// M3; read now for filters and cards).

import { useMemo } from "react";
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { costPerServing, missingTools, NO_FACTS, supplyCoverage, type FavouriteDoc, type HouseholdFacts, type NoteDoc, type RecipeSummary, type ScoreResult, type StatsDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc, useLiveQuery } from "./live";
import { useHousehold } from "./households";
import { estimateCentsPerUnit } from "./prices";
import { FREE_USE } from "./supply";

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

/**
 * Everything <CollectionView> needs to know about the household for each recipe: favourite, cook stats, whether the
 * household owns its tools (R11.1), and its estimated cost per serving (R4.2). `summaries` supplies tools and cost
 * lines; without it those two filters pass everything.
 */
export function useHouseholdFacts(hid: string | null, summaries?: readonly RecipeSummary[], projected?: ReadonlyMap<string, number>, scores?: ReadonlyMap<string, ScoreResult>): (id: string) => HouseholdFacts {
  const favs = useFavourites(hid);
  const stats = useStats(hid);
  const household = useHousehold(hid);
  const tools = household.data?.settings?.tools;
  const extra = useMemo(() => {
    const m = new Map<string, { hasAllTools: boolean; costPerServingCents: number | null; canMake?: boolean; supplyFraction?: number }>();
    for (const r of summaries ?? []) {
      const x: { hasAllTools: boolean; costPerServingCents: number | null; canMake?: boolean; supplyFraction?: number } = {
        hasAllTools: !tools?.length || missingTools(r.tools ?? [], tools).length === 0,
        costPerServingCents: r.lines ? costPerServing(r.lines, estimateCentsPerUnit) : null,
      };
      // Can make / Use what's left (R4.3, R4.4): the summary's per-serving lines at the recipe's servings against what's
      // left after the plan. Free-use ingredients (bundled list) don't count.
      if (projected && r.lines) {
        const lines = Object.entries(r.lines).map(([ingredientId, per]) => ({ ingredientId, canonicalAmount: per * r.servings, optional: false }));
        const c = supplyCoverage(lines, projected, (id) => ({ freeUse: FREE_USE.has(id) }));
        x.canMake = c.canMake;
        x.supplyFraction = c.canMake ? 1 : c.fraction;
      }
      m.set(r.id, x);
    }
    return m;
  }, [summaries, tools, projected]);
  return useMemo(() => {
    return (id: string): HouseholdFacts => {
      const s = stats.get(id);
      const favourite = favs.has(id);
      const x = extra.get(id);
      const sc = scores?.get(id);
      if (!s && !favourite && !x && !sc) return NO_FACTS;
      return {
        favourite,
        timesCooked: s?.timesCooked ?? 0,
        lastCookedAtMs: millis(s?.lastCookedAt),
        rating: s && s.ratingCount > 0 ? s.ratingSum / s.ratingCount : null,
        ...(x ?? {}),
        ...(sc ? { suggestion: { raw: sc.raw, blocked: !!sc.blocked }, expiryDays: sc.expiring ? sc.expiring.daysLeft : null } : {}),
      };
    };
  }, [favs, stats, extra, scores]);
}
