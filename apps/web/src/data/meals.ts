// What the household knows about saved meals: favourites (R4.6), ratings and cook stats keyed `meal_<id>` (written
// by M3's review flow, R5.3), and the estimated cost per serving from the recipes' summary lines.
import { useMemo } from "react";
import { collection } from "firebase/firestore";
import { combinedSuggestion, costPerServing, NO_FACTS, type HouseholdFacts, type MealRow, type ScoreResult, type StatsDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "./live";
import { millis, useMealFavourites } from "./plan";
import { estimateCentsPerUnit } from "./prices";

export function useMealFacts(hid: string | null, rows: readonly MealRow[], scores?: ReadonlyMap<string, ScoreResult>): (id: string) => HouseholdFacts {
  const favs = useMealFavourites(hid);
  const stats = useLiveQuery<StatsDoc>(hid ? collection(db, "households", hid, "stats") : null, hid ? `households/${hid}/stats` : null);
  const favKey = [...favs].sort().join(",");
  return useMemo(() => {
    const s = new Map((stats.docs ?? []).filter((d) => d.id.startsWith("meal_")).map((d) => [d.id.slice(5), d.data]));
    const fav = new Set(favKey ? favKey.split(",") : []);
    const cost = new Map(rows.map((r) => [r.id, r.lines && Object.keys(r.lines).length ? costPerServing(r.lines, estimateCentsPerUnit) : null]));
    // Suggested / Expiring first for meals: the mean of their recipes' scores (M5).
    const sugg = new Map(rows.map((r) => [r.id, scores ? combinedSuggestion(r.recipeIds, scores) : null]));
    return (id: string): HouseholdFacts => {
      const st = s.get(id);
      if (!st && !fav.has(id) && !cost.has(id)) return NO_FACTS;
      return {
        favourite: fav.has(id),
        timesCooked: st?.timesCooked ?? 0,
        lastCookedAtMs: millis(st?.lastCookedAt),
        rating: st && st.ratingCount > 0 ? st.ratingSum / st.ratingCount : null,
        costPerServingCents: cost.get(id) ?? null,
        ...(sugg.get(id) ? { suggestion: { raw: sugg.get(id)!.raw, blocked: sugg.get(id)!.blocked }, expiryDays: sugg.get(id)!.expiryDays } : {}),
      };
    };
  }, [stats.docs, favKey, rows, scores]);
}
