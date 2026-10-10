// What the household knows about saved meals: favourites (R4.6), ratings and cook stats keyed `meal_<id>` (written
// by M3's review flow, R5.3), and the estimated cost per serving from the recipes' summary lines.
import { useMemo } from "react";
import { collection } from "firebase/firestore";
import { costPerServing, NO_FACTS, type HouseholdFacts, type MealRow, type StatsDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "./live";
import { millis, useMealFavourites } from "./plan";
import { estimateCentsPerUnit } from "./prices";

export function useMealFacts(hid: string | null, rows: readonly MealRow[]): (id: string) => HouseholdFacts {
  const favs = useMealFavourites(hid);
  const stats = useLiveQuery<StatsDoc>(hid ? collection(db, "households", hid, "stats") : null, hid ? `households/${hid}/stats` : null);
  const favKey = [...favs].sort().join(",");
  return useMemo(() => {
    const s = new Map((stats.docs ?? []).filter((d) => d.id.startsWith("meal_")).map((d) => [d.id.slice(5), d.data]));
    const fav = new Set(favKey ? favKey.split(",") : []);
    const cost = new Map(rows.map((r) => [r.id, r.lines && Object.keys(r.lines).length ? costPerServing(r.lines, estimateCentsPerUnit) : null]));
    return (id: string): HouseholdFacts => {
      const st = s.get(id);
      if (!st && !fav.has(id) && !cost.has(id)) return NO_FACTS;
      return {
        favourite: fav.has(id),
        timesCooked: st?.timesCooked ?? 0,
        lastCookedAtMs: millis(st?.lastCookedAt),
        rating: st && st.ratingCount > 0 ? st.ratingSum / st.ratingCount : null,
        costPerServingCents: cost.get(id) ?? null,
      };
    };
  }, [stats.docs, favKey, rows]);
}
