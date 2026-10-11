// Sides (PRD R5.9, R5.10, R11.14; spec §4.1 `ingredients.side`, §4.2 `settings.sides`): the household's effective
// side list from the ingredient collection plus its own flags and portion overrides, and the Settings write.
// Portions are resolved here when a meal is created and then live on the meal (never re-read from Settings).

import { useMemo } from "react";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { effectiveSides, type EffectiveSide, type SideSettings } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useSession } from "@/session/useSession";
import { useHousehold } from "./households";
import { useAllIngredients, type IngredientEntry } from "./ingredients";

export type SideEntry = EffectiveSide<IngredientEntry>;

/**
 * Every side the active household can pick, with its current portion. `list` is undefined while loading. Safe on pages
 * that render signed out (it then stays empty): it reads the session without requiring it.
 */
export function useSides(enabled = true): { list: SideEntry[] | undefined; byId: Map<string, SideEntry>; settings: SideSettings } {
  const session = useSession();
  const on = enabled && session.status === "ready";
  const hh = useHousehold(on && session.status === "ready" ? session.activeHouseholdId : null);
  const all = useAllIngredients(on);
  const settings = hh.data?.settings.sides;
  return useMemo(() => {
    const list = all.list ? effectiveSides(all.list, settings) : undefined;
    return { list, byId: new Map((list ?? []).map((s) => [s.ingredient.id, s])), settings: settings ?? {} };
  }, [all.list, settings]);
}

/** Writes the household's side flags and overrides whole (R11.14); an empty map clears the field. */
export function saveSides(hid: string, sides: SideSettings) {
  return updateDoc(doc(db, "households", hid), { "settings.sides": Object.keys(sides).length ? sides : deleteField() });
}
