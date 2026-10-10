// Everything the Plan page, the Create meal sheet, and the Grocery page compute from: the current period, its plan
// items, the recipes and ingredients they use, stores, rules, mappings, and ordered lists, fed through the core
// grocery builder (spec §8) and budget math (§7). Firestore shares identical listeners, so several callers cost no
// extra reads.

import { useMemo } from "react";
import {
  budgetState,
  buildList,
  incomingFrom,
  itemCosts,
  projectedSupply,
  unexpiredByIngredient,
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
import { useActiveHousehold } from "./households";
import { useIngredientsById } from "./ingredients";
import { useSupply } from "./supply";
import { millis, useBrandMappings, useDraftList, useOrderedLists, usePeriod, usePlanItems, useRecipeDocs, useSourcingRules, useStores, type StoredPlanItem } from "./plan";

export function usePlanModel(opts: { extraRecipeIds?: readonly string[] } = {}) {
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

  const ingredientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of recipes.values()) for (const id of r.ingredientIds) ids.add(id);
    for (const m of mappings.docs ?? []) ids.add(m.id);
    for (const it of Object.values(draft.data?.items ?? {})) if (it.ingredientId) ids.add(it.ingredientId);
    for (const l of ordered.docs ?? []) for (const it of Object.values(l.data.items)) if (it.ingredientId) ids.add(it.ingredientId);
    for (const it of supply.items.values()) if (it.ingredientId) ids.add(it.ingredientId);
    return [...ids];
  }, [recipes, mappings.docs, draft.data, ordered.docs, supply.items]);
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
      prices: { estimates: PRICE_ESTIMATES },
    };
  }, [stores.docs, mappings.docs, rules.docs, ingredients, recipes, ordered.docs, household?.defaultStoreId, unexpired]);

  const inputs: PlanItemInput[] = useMemo(() => items.map((i) => ({ id: i.id, status: i.data.status, servings: i.data.servings, recipes: i.data.recipes })), [items]);
  const built = useMemo(() => buildList(inputs, ctx), [inputs, ctx]);
  const costs = useMemo(() => itemCosts(inputs, ctx), [inputs, ctx]);
  // Projected supply (R8.4): unexpired − what the period's uncooked items will use.
  const projected = useMemo(() => projectedSupply(unexpired, inputs, ctx), [unexpired, inputs, ctx]);
  const budget = useMemo(() => budgetState(period.data?.budgetCents ?? household?.budgetCents ?? 0, built), [period.data?.budgetCents, household?.budgetCents, built]);

  // Ready to price: every recipe loaded and every ingredient they use.
  const recipesReady = recipeIds.every((id) => recipes.has(id));
  const wantedIngredients = new Set([...recipes.values()].flatMap((r) => r.ingredientIds));
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
  };
}

export type PlanModel = ReturnType<typeof usePlanModel>;
