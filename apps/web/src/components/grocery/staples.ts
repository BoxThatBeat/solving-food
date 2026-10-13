// Staples on the grocery list (M10, PRD R7.12, R7.7, R8.14; TECHNICAL_SPECS §8 "Staples on the list"): the staples
// that are due become generated `staple_<id>` lines, regenerated like plan lines. This replaces the M5 "Are you out
// of milk?" prompt: the line is the question, and removing it is the answer ("I have it": not added again until the
// staple's usual interval has passed, and never before the period ends; `dismissedStaples` on the draft).
import * as React from "react";
import { stapleLines, type GroceryItem, type StapleIngredient } from "@solving-food/core";
import { useIngredientsById } from "@/data/ingredients";
import { millis } from "@/data/plan";
import type { PlanModel } from "@/data/planModel";
import { useCadence } from "@/data/supply";

export function useStapleLines(m: PlanModel): { lines: Record<string, GroceryItem>; ready: boolean; cadenceOf: (id: string) => { avgIntervalDays: number | null; purchaseCount: number } | null; ingredientOf: (id: string) => StapleIngredient | undefined } {
  const cadence = useCadence(m.hid);
  const ids = React.useMemo(() => (cadence.docs ?? []).map((d) => d.id), [cadence.docs]);
  const extra = useIngredientsById(ids);
  const draftItems = m.draft.data?.items;
  const dismissed = m.draft.data?.dismissedStaples;
  const ingredientOf = React.useCallback((id: string): StapleIngredient | undefined => extra.get(id) ?? m.ctx.ingredients(id), [extra, m.ctx]);
  const extraReady = ids.every((id) => extra.has(id));
  const ready = m.ready && cadence.docs !== undefined && extraReady;
  const lines = React.useMemo(() => {
    if (!ready) return {};
    const onList = new Set<string>();
    for (const it of Object.values(draftItems ?? {})) if (it.ingredientId && it.source !== "staple") onList.add(it.ingredientId);
    for (const id of Object.keys(m.built.items)) onList.add(id);
    for (const l of m.ordered ?? []) for (const it of Object.values(l.data.items)) if (it.ingredientId) onList.add(it.ingredientId);
    return stapleLines(
      {
        items: m.inputs,
        cadence: (cadence.docs ?? []).map((d) => ({
          ingredientId: d.id,
          c: { avgIntervalDays: d.data.avgIntervalDays, lastPurchasedAtMs: millis(d.data.lastPurchasedAt), purchaseCount: d.data.purchaseCount ?? 1, snoozedUntilMs: millis(d.data.snoozedUntil) },
        })),
        onList,
        // A dismissal from an earlier period that's still running stays; the until time decides.
        dismissed,
        nowMs: m.supply.now,
      },
      { ...m.ctx, ingredients: ingredientOf },
    );
  }, [ready, draftItems, dismissed, m.built.items, m.ordered, m.inputs, m.supply.now, m.ctx, cadence.docs, ingredientOf]);
  const cadenceOf = React.useCallback(
    (id: string) => {
      const d = cadence.docs?.find((x) => x.id === id)?.data;
      return d ? { avgIntervalDays: d.avgIntervalDays, purchaseCount: d.purchaseCount ?? 1 } : null;
    },
    [cadence.docs],
  );
  return { lines, ready, cadenceOf, ingredientOf };
}
