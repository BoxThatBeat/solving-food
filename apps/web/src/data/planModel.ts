// Everything the Plan page, the Create meal sheet, and the Grocery page compute from: the current period, its plan
// items, the recipes and ingredients they use, stores, rules, mappings, and ordered lists, fed through the core
// grocery builder (spec §8) and budget math (§7). Firestore shares identical listeners, so several callers cost no
// extra reads.

import { useMemo } from "react";
import {
  addLocalDays,
  budgetState,
  buildList,
  expiringSpare,
  incomingFrom,
  itemCosts,
  needsFor,
  orderSpare,
  projectedSupply,
  unexpiredByIngredient,
  USE_SOON_DAYS,
  type LedgerLot,
  type BuildContext,
  type GroceryIngredient,
  type MappingEntry,
  type PlanItemInput,
  type RecipeLines,
  type RuleEntry,
  type StoreEntry,
} from "@solving-food/core";
import { PRICE_ESTIMATES } from "./prices";
import { liveLookup, useLivePrices } from "./livePrices";
import { useActiveHousehold } from "./households";
import { useIngredientsById } from "./ingredients";
import { useSupply } from "./supply";
import { millis, useBrandMappings, useDraftList, useOrderedLists, usePeriod, usePlanItems, useRecipeDocs, useSourcingRules, useStores, type StoredPlanItem } from "./plan";

export function usePlanModel(opts: { extraRecipeIds?: readonly string[]; extraIngredientIds?: readonly string[] } = {}) {
  const hh = useActiveHousehold();
  const hid = hh.id;
  const household = hh.data;
  const periodId = household?.currentPeriodId ?? null;
  const period = usePeriod(hid, periodId);
  const planItems = usePlanItems(hid, periodId);
  const stores = useStores(hid);
  const rules = useSourcingRules(hid);
  const mappings = useBrandMappings(hid);
  const ordered = useOrderedLists(hid);
  const draft = useDraftList(hid);
  const supply = useSupply(hid, household?.timezone ?? "America/Toronto");
  const livePrices = useLivePrices(household?.pcxStoreId);
  // Unexpired supply per ingredient (expired lots don't count, R8.15); leftover batches aren't ingredients.
  const unexpired = useMemo(() => unexpiredByIngredient(supply.items.values(), supply.now), [supply.items, supply.now]);
  const lotsByIngredient = useMemo(() => {
    const m = new Map<string, LedgerLot[]>();
    for (const it of supply.items.values()) if (it.ingredientId) m.set(it.ingredientId, [...(m.get(it.ingredientId) ?? []), ...it.lots]);
    return m;
  }, [supply.items]);

  const items = useMemo(
    () => [...(planItems.docs ?? [])].sort((a, b) => (millis(a.data.addedAt) ?? Number.MAX_SAFE_INTEGER) - (millis(b.data.addedAt) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)),
    [planItems.docs],
  );
  const extraKey = (opts.extraRecipeIds ?? []).join(",");
  const recipeIds = useMemo(() => [...new Set([...items.flatMap((i) => i.data.recipes.map((r) => r.recipeId)), ...(extraKey ? extraKey.split(",") : [])])], [items, extraKey]);
  const recipes = useRecipeDocs(recipeIds);

  const extraIngKey = (opts.extraIngredientIds ?? []).join(",");
  // Side ingredients (R5.10) price and count like recipe ones, so they're loaded too.
  const sideIds = useMemo(() => [...new Set([...items.flatMap((i) => (i.data.sides ?? []).map((s) => s.ingredientId)), ...(extraIngKey ? extraIngKey.split(",") : [])])], [items, extraIngKey]);
  const ingredientIds = useMemo(() => {
    const ids = new Set<string>(sideIds);
    for (const r of recipes.values()) for (const id of r.ingredientIds) ids.add(id);
    for (const m of mappings.docs ?? []) ids.add(m.id);
    for (const it of Object.values(draft.data?.items ?? {})) if (it.ingredientId) ids.add(it.ingredientId);
    for (const l of ordered.docs ?? []) for (const it of Object.values(l.data.items)) if (it.ingredientId) ids.add(it.ingredientId);
    for (const it of supply.items.values()) if (it.ingredientId) ids.add(it.ingredientId);
    return [...ids];
  }, [recipes, mappings.docs, draft.data, ordered.docs, supply.items, sideIds]);
  const ingredients = useIngredientsById(ingredientIds);

  const ctx: BuildContext = useMemo(() => {
    const storeList: StoreEntry[] = (stores.docs ?? []).map((d) => ({ id: d.id, ...d.data }));
    const mappingMap = new Map<string, MappingEntry>((mappings.docs ?? []).map((d) => [d.id, d.data]));
    const ruleList: RuleEntry[] = (rules.docs ?? []).map((d) => d.data);
    const ingMap = new Map<string, GroceryIngredient>([...ingredients.values()].map((i) => [i.id, i]));
    const recipeMap = new Map<string, RecipeLines>([...recipes.entries()]);
    return {
      recipes: (id) => recipeMap.get(id),
      ingredients: (id) => ingMap.get(id),
      supply: unexpired,
      incoming: incomingFrom((ordered.docs ?? []).map((d) => d.data)),
      mappings: mappingMap,
      rules: ruleList,
      stores: storeList,
      defaultStoreId: household?.defaultStoreId,
      prices: { estimates: PRICE_ESTIMATES, live: liveLookup(livePrices) },
    };
  }, [stores.docs, mappings.docs, rules.docs, ingredients, recipes, ordered.docs, household?.defaultStoreId, unexpired, livePrices]);

  const inputs: PlanItemInput[] = useMemo(() => items.map((i) => ({ id: i.id, status: i.data.status, servings: i.data.servings, recipes: i.data.recipes, sides: i.data.sides })), [items]);
  const built = useMemo(() => buildList(inputs, ctx), [inputs, ctx]);
  const costs = useMemo(() => itemCosts(inputs, ctx), [inputs, ctx]);
  // Projected supply (R8.4): unexpired − what the period's uncooked items will use.
  const projected = useMemo(() => projectedSupply(unexpired, inputs, ctx), [unexpired, inputs, ctx]);
  const budget = useMemo(() => budgetState(period.data?.budgetCents ?? household?.budgetCents ?? 0, built), [period.data?.budgetCents, household?.budgetCents, built]);
  // Spare supply expiring within the period (or the next few days): what no planned meal will use (R6.13, M5).
  const tz = household?.timezone ?? "America/Toronto";
  const periodEndMs = millis(period.data?.end);
  const plannedNeeds = useMemo(() => needsFor(inputs, ctx), [inputs, ctx]);
  const untilMs = Math.max(periodEndMs ?? 0, addLocalDays(supply.now, USE_SOON_DAYS + 1, tz));
  const expiring = useMemo(() => expiringSpare(lotsByIngredient, plannedNeeds, untilMs, supply.now, tz), [plannedNeeds, untilMs, supply.now, tz, lotsByIngredient]);
  // Use it up before ordering (M9, R6.25): the same rule, on Supply as it will be when the next order (the plan lines
  // the grocery builder would buy) arrives.
  const useItUp = useMemo(
    () => orderSpare(lotsByIngredient, plannedNeeds, Object.values(built.items), (id) => ingredients.get(id), untilMs, supply.now, tz),
    [lotsByIngredient, plannedNeeds, built.items, ingredients, untilMs, supply.now, tz],
  );

  // Ready to price: every recipe loaded and every ingredient they use.
  const recipesReady = recipeIds.every((id) => recipes.has(id));
  // Sides too: an unloaded side ingredient would be skipped by lineFor and the meter would read low.
  const wantedIngredients = new Set([...[...recipes.values()].flatMap((r) => r.ingredientIds), ...sideIds]);
  const ingredientsReady = [...wantedIngredients].every((id) => ingredients.has(id));
  const ready = !!household && !supply.loading && planItems.docs !== undefined && recipesReady && ingredientsReady && stores.docs !== undefined && ordered.docs !== undefined && mappings.docs !== undefined;

  return {
    hid,
    household,
    periodId,
    period: period.data,
    items: items as Array<{ id: string; data: StoredPlanItem }>,
    loading: planItems.docs === undefined,
    recipes,
    ingredients,
    stores: ctx.stores,
    ctx,
    /** The plan items as the grocery builder reads them. */
    inputs,
    built,
    costs,
    budget,
    draft,
    ordered: ordered.docs,
    ready,
    supply,
    unexpired,
    projected,
    lotsByIngredient,
    expiring,
    useItUp,
    livePrices,
  };
}

export type PlanModel = ReturnType<typeof usePlanModel>;
