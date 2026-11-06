// M29 (PRD R9.7): a cook started from the recipe page or a saved meal belongs to the current period's planned meal of
// that recipe or meal, when there is one, so Done cooking marks it cooked (the strip cell turns solid and it leaves the
// Plan page). The choice is made once, when the plan has loaded, and kept for the session.
import * as React from "react";
import { mealRequirements, plannedMealFor, soonestUseDays, type CookStart } from "@solving-food/core";
import { usePlanModel } from "@/data/planModel";
import type { StoredPlanItem } from "@/data/plan";

type Item = { id: string; data: StoredPlanItem };

/** `undefined` while the plan loads; then the planned meal to cook, or `null` for a cook that isn't on the plan. */
export function usePlannedMeal(start: CookStart | null): Item | null | undefined {
  const m = usePlanModel();
  const key = start ? ("recipeId" in start ? `r:${start.recipeId}` : `m:${start.savedMealId}`) : "";
  const [chosen, setChosen] = React.useState<{ key: string; itemId: string | null } | null>(null);
  const decided = chosen?.key === key ? chosen : null;
  const candidate = React.useMemo(() => {
    if (!start || m.household === undefined) return undefined;
    // No household or no current period yet: nothing is planned (the period's items never load).
    if (!m.household || !m.periodId) return null;
    if (m.loading) return undefined;
    // A meal finished offline (its finishCooking still queued) is cooked already, as the Plan page shows it.
    const finishing = new Set(m.supply.pendingCommands.flatMap((p) => (p.command.type === "finishCooking" && p.command.payload.planItemId ? [p.command.payload.planItemId] : [])));
    const items = finishing.size ? m.items.filter((i) => !finishing.has(i.id)) : m.items;
    const pick = (soon?: (i: Item) => number | null | undefined) => plannedMealFor(items, start, soon);
    const first = pick();
    // Several matches: the Plan page's order needs the soonest-expiring ingredient, so wait for Supply and the recipes.
    const several = !!first && !!plannedMealFor(items.filter((i) => i.id !== first.id), start);
    if (!first || !several) return first ?? null;
    if (!m.ready) return undefined;
    return pick((i) => soonestUseDays(mealRequirements(i.data.recipes, i.data.servings, m.ctx, i.data.sides), (id) => m.lotsByIngredient.get(id), m.supply.now)?.days) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, m.household, m.periodId, m.loading, m.ready, m.items, m.ctx, m.lotsByIngredient, m.supply.now, m.supply.pendingCommands]);
  // Decided once, during render (React's "adjusting state when a prop changes"), so the session never flips.
  if (!decided && candidate !== undefined) setChosen({ key, itemId: candidate?.id ?? null });
  if (!start) return null;
  if (!decided) return candidate === undefined ? undefined : (candidate && m.items.find((i) => i.id === candidate.id)) ?? null;
  if (decided.itemId === null) return null;
  // The live document, so the session cooks the meal as it is now (its recipes and servings).
  return m.items.find((i) => i.id === decided.itemId) ?? null;
}
