// Everything the Plan page, the Create meal sheet, and the Grocery page compute from: the current period, its plan
// items, the recipes and ingredients they use, stores, rules, mappings, and ordered lists, fed through the core
// grocery builder (spec §8) and budget math (§7). M23: computed once for the signed-in shell (<PlanModelProvider>)
// and read with `usePlanModel()` by the Plan, Grocery, Supply and Recipes pages, Create meal, the suggestions engine
// and the nav badges, instead of once per caller. M26: the same model for the next period (`useNextPlanModel()`),
// computed only while something on screen shows it: its own plan items and draft, Supply as projected at its start.

import { createContext, useContext, useEffect, useMemo } from "react";
import { Timestamp } from "firebase/firestore";
import {
  addLocalDays,
  budgetState,
  buildList,
  removedLineIds,
  withoutRemoved,
  expiringSpare,
  incomingFrom,
  itemCosts,
  listsForView,
  needsFor,
  orderSpare,
  projectedSupply,
  supplyAtStart,
  unexpiredByIngredient,
  upcomingPeriod,
  NEXT_DRAFT_ID,
  USE_SOON_DAYS,
  type LedgerLot,
  type BuildContext,
  type GroceryIngredient,
  type HouseholdDoc,
  type MappingEntry,
  type PeriodView,
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
import type { LiveDoc, LiveQuery } from "./live";
import {
  DRAFT_ID,
  millis,
  useBrandMappings,
  useDraftList,
  useOrderedLists,
  usePeriod,
  usePlanItems,
  useRecipeDocs,
  useSourcingRules,
  useStores,
  type StoredList,
  type StoredPeriod,
  type StoredPlanItem,
} from "./plan";

type Docs<T> = Array<{ id: string; data: T }>;

/** What differs between the current period's model and the next period's (M26). */
interface PeriodInputs {
  view: PeriodView;
  hid: string;
  household: (HouseholdDoc & { id?: string }) | null | undefined;
  periodId: string | null;
  period: StoredPeriod | null | undefined;
  planItems: LiveQuery<StoredPlanItem>;
  draftId: string;
  draft: LiveDoc<StoredList>;
  /** This view's ordered lists (shown under Ordered, and incoming for it). */
  ordered: Docs<StoredList> | undefined;
  /** Every ordered list (their ingredients are loaded for both views). */
  orderedAll: Docs<StoredList> | undefined;
  stores: Docs<StoreDoc> | undefined;
  rules: Docs<SourcingRule> | undefined;
  mappings: Docs<MappingEntry> | undefined;
  supply: ReturnType<typeof useSupply>;
  livePrices: ReturnType<typeof useLivePrices>;
  /** Supply that counts, per ingredient, and its lots: today's, or projected at the next period's start. */
  unexpired: ReadonlyMap<string, number>;
  lotsByIngredient: ReadonlyMap<string, LedgerLot[]>;
  incoming: Map<string, number>;
  /** The moment expiry alerts count from: now, or the next period's start. */
  fromMs: number;
  /** False while what the view depends on beyond its own documents is still loading. */
  baseReady: boolean;
}
type StoreDoc = Omit<StoreEntry, "id">;
type SourcingRule = RuleEntry;

/** The shared computation for one period's view. Hooks run in the same order for both views. */
function usePeriodModel(p: PeriodInputs) {
  const { hid, household, supply, unexpired, lotsByIngredient, fromMs } = p;
  const items = useMemo(
    () => [...(p.planItems.docs ?? [])].sort((a, b) => (millis(a.data.addedAt) ?? Number.MAX_SAFE_INTEGER) - (millis(b.data.addedAt) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)),
    [p.planItems.docs],
  );
  const recipeIds = useMemo(() => [...new Set(items.flatMap((i) => i.data.recipes.map((r) => r.recipeId)))], [items]);
  const recipes = useRecipeDocs(recipeIds);

  // Side ingredients (R5.10) price and count like recipe ones, so they're loaded too.
  const sideIds = useMemo(() => [...new Set(items.flatMap((i) => (i.data.sides ?? []).map((s) => s.ingredientId)))], [items]);
  const ingredientIds = useMemo(() => {
    const ids = new Set<string>(sideIds);
    for (const r of recipes.values()) for (const id of r.ingredientIds) ids.add(id);
    for (const m of p.mappings ?? []) ids.add(m.id);
    for (const it of Object.values(p.draft.data?.items ?? {})) if (it.ingredientId) ids.add(it.ingredientId);
    for (const l of p.orderedAll ?? []) for (const it of Object.values(l.data.items)) if (it.ingredientId) ids.add(it.ingredientId);
    for (const it of supply.items.values()) if (it.ingredientId) ids.add(it.ingredientId);
    return [...ids];
  }, [recipes, p.mappings, p.draft.data, p.orderedAll, supply.items, sideIds]);
  const ingredients = useIngredientsById(ingredientIds);

  const ctx: BuildContext = useMemo(() => {
    const storeList: StoreEntry[] = (p.stores ?? []).map((d) => ({ id: d.id, ...d.data }));
    const mappingMap = new Map<string, MappingEntry>((p.mappings ?? []).map((d) => [d.id, d.data]));
    const ruleList: RuleEntry[] = (p.rules ?? []).map((d) => d.data);
    const ingMap = new Map<string, GroceryIngredient>([...ingredients.values()].map((i) => [i.id, i]));
    const recipeMap = new Map<string, RecipeLines>([...recipes.entries()]);
    return {
      recipes: (id) => recipeMap.get(id),
      ingredients: (id) => ingMap.get(id),
      supply: unexpired,
      incoming: p.incoming,
      mappings: mappingMap,
      rules: ruleList,
      stores: storeList,
      defaultStoreId: household?.defaultStoreId,
      prices: { estimates: PRICE_ESTIMATES, live: liveLookup(p.livePrices) },
    };
  }, [p.stores, p.mappings, p.rules, ingredients, recipes, p.incoming, household?.defaultStoreId, unexpired, p.livePrices]);

  const inputs: PlanItemInput[] = useMemo(() => items.map((i) => ({ id: i.id, status: i.data.status, servings: i.data.servings, recipes: i.data.recipes, sides: i.data.sides })), [items]);
  const built = useMemo(() => buildList(inputs, ctx), [inputs, ctx]);
  const costs = useMemo(() => itemCosts(inputs, ctx), [inputs, ctx]);
  // Projected supply (R8.4): unexpired − what the period's uncooked items will use.
  const projected = useMemo(() => projectedSupply(unexpired, inputs, ctx), [unexpired, inputs, ctx]);
  // What the next order will buy: the built lines minus the ones removed from the list with their × (M17, R7.13).
  const removedIds = useMemo(() => removedLineIds(p.draft.data?.items), [p.draft.data?.items]);
  const order = useMemo(() => withoutRemoved(built, removedIds), [built, removedIds]);
  const budget = useMemo(() => budgetState(p.period?.budgetCents ?? household?.budgetCents ?? 0, order), [p.period?.budgetCents, household?.budgetCents, order]);
  // Spare supply expiring within the period (or the next few days): what no planned meal will use (R6.13, M5).
  const tz = household?.timezone ?? "America/Toronto";
  const periodEndMs = millis(p.period?.end);
  const plannedNeeds = useMemo(() => needsFor(inputs, ctx), [inputs, ctx]);
  const untilMs = Math.max(periodEndMs ?? 0, addLocalDays(fromMs, USE_SOON_DAYS + 1, tz));
  const expiring = useMemo(() => expiringSpare(lotsByIngredient, plannedNeeds, untilMs, fromMs, tz), [plannedNeeds, untilMs, fromMs, tz, lotsByIngredient]);
  // Use it up before ordering (M9, R6.25): the same rule, on Supply as it will be when the next order (the plan lines
  // the grocery builder would buy) arrives.
  const useItUp = useMemo(
    () => orderSpare(lotsByIngredient, plannedNeeds, Object.values(order.items), (id) => ingredients.get(id), untilMs, fromMs, tz),
    [lotsByIngredient, plannedNeeds, order.items, ingredients, untilMs, fromMs, tz],
  );

  // Ready to price: every recipe loaded and every ingredient they use.
  const recipesReady = recipeIds.every((id) => recipes.has(id));
  // Sides too: an unloaded side ingredient would be skipped by lineFor and the meter would read low.
  const wantedIngredients = new Set([...[...recipes.values()].flatMap((r) => r.ingredientIds), ...sideIds]);
  const ingredientsReady = [...wantedIngredients].every((id) => ingredients.has(id));
  const ready =
    p.baseReady && !!household && !supply.loading && p.planItems.docs !== undefined && recipesReady && ingredientsReady && p.stores !== undefined && p.orderedAll !== undefined && p.mappings !== undefined;

  const { view, periodId, period, draft, draftId, ordered, livePrices } = p;
  return useMemo(
    () => ({
      /** "current", or "next" for the period after it (M26). */
      view,
      hid,
      household,
      periodId,
      period,
      items: items as Array<{ id: string; data: StoredPlanItem }>,
      loading: p.planItems.docs === undefined,
      recipes,
      ingredients,
      stores: ctx.stores,
      ctx,
      /** The plan items as the grocery builder reads them. */
      inputs,
      /** Every generated plan line, removed ones included (regeneration keeps their flag). */
      built,
      /** IDs of the plan lines removed from the list (M17, R7.13). */
      removedIds,
      costs,
      budget,
      /** This view's draft and its document ID ("draft", or "draft-next" for the next period). */
      draft,
      draftId,
      /** This view's ordered lists (M26: a next-period order belongs to the next view until the rollover). */
      ordered,
      ready,
      supply,
      unexpired,
      projected,
      lotsByIngredient,
      /** What the period's uncooked items need, per ingredient (the next period's Supply is projected from it). */
      plannedNeeds,
      expiring,
      useItUp,
      livePrices,
    }),
    [view, hid, household, periodId, period, items, p.planItems.docs, recipes, ingredients, ctx, inputs, built, removedIds, costs, budget, draft, draftId, ordered, ready, supply, unexpired, projected, lotsByIngredient, plannedNeeds, expiring, useItUp, livePrices],
  );
}

/** Computes the current period's model and what the next period's needs from it. Only <PlanModelProvider> calls this. */
export function useComputePlanModel() {
  const hh = useActiveHousehold();
  const hid = hh.id;
  const household = hh.data;
  const periodId = household?.currentPeriodId ?? null;
  const period = usePeriod(hid, periodId);
  const planItems = usePlanItems(hid, periodId);
  const stores = useStores(hid);
  const rules = useSourcingRules(hid);
  const mappings = useBrandMappings(hid);
  const orderedAll = useOrderedLists(hid);
  const draft = useDraftList(hid);
  const tz = household?.timezone ?? "America/Toronto";
  const supply = useSupply(hid, tz);
  const livePrices = useLivePrices(household?.pcxStoreId);
  // The period after this one (M26): its ID is computed, never stored, until the rollover makes it current.
  const endMs = millis(period.data?.end);
  const periodDays = household?.periodDays ?? 7;
  const upcoming = useMemo(() => (endMs ? upcomingPeriod({ endMs }, periodDays, tz) : null), [endMs, periodDays, tz]);
  const upcomingId = upcoming?.id ?? null;
  const ordered = useMemo(() => (orderedAll.docs ? listsForView(orderedAll.docs, upcomingId, "current") : undefined), [orderedAll.docs, upcomingId]);
  const nextOrdered = useMemo(() => (orderedAll.docs ? listsForView(orderedAll.docs, upcomingId, "next") : undefined), [orderedAll.docs, upcomingId]);
  // Unexpired supply per ingredient (expired lots don't count, R8.15); leftover batches aren't ingredients.
  const unexpired = useMemo(() => unexpiredByIngredient(supply.items.values(), supply.now), [supply.items, supply.now]);
  const lotsByIngredient = useMemo(() => {
    const m = new Map<string, LedgerLot[]>();
    for (const it of supply.items.values()) if (it.ingredientId) m.set(it.ingredientId, [...(m.get(it.ingredientId) ?? []), ...it.lots]);
    return m;
  }, [supply.items]);
  // M26: a next-period order counts as incoming for the next period only.
  const incoming = useMemo(() => incomingFrom((ordered ?? []).map((d) => d.data)), [ordered]);
  const model = usePeriodModel({
    view: "current",
    hid,
    household,
    periodId,
    period: period.data,
    planItems,
    draftId: DRAFT_ID,
    draft,
    ordered,
    orderedAll: orderedAll.docs,
    stores: stores.docs,
    rules: rules.docs,
    mappings: mappings.docs,
    supply,
    livePrices,
    unexpired,
    lotsByIngredient,
    incoming,
    fromMs: supply.now,
    baseReady: true,
  });
  return useMemo(
    () => ({ ...model, upcoming, nextOrdered, orderedAll: orderedAll.docs, stores_: stores.docs, rules_: rules.docs, mappings_: mappings.docs }),
    [model, upcoming, nextOrdered, orderedAll.docs, stores.docs, rules.docs, mappings.docs],
  );
}

type CurrentModel = ReturnType<typeof useComputePlanModel>;
export type PlanModel = ReturnType<typeof usePeriodModel>;

/**
 * The next period's model (M26, R3.2–R3.4, R7.18), from the current one: the upcoming period's plan items and draft
 * (`draft-next`), its own ordered lists, and Supply as projected at its start (`supplyAtStart`: this period's uncooked
 * meals use the soonest-expiring lots and this period's orders first; what expires before the start drops out; the
 * next period's orders are added). Nothing is listened to while `enabled` is false.
 */
export function useComputeNextPlanModel(base: CurrentModel, enabled: boolean): PlanModel {
  const on = enabled && !!base.upcoming;
  const upcoming = base.upcoming;
  const nextId = on ? (upcoming?.id ?? null) : null;
  const planItems = usePlanItems(base.hid, nextId);
  const draft = useDraftList(base.hid, on ? NEXT_DRAFT_ID : null);
  const startMs = upcoming?.startMs ?? base.supply.now;
  const nextIncoming = useMemo(() => incomingFrom((base.nextOrdered ?? []).map((d) => d.data)), [base.nextOrdered]);
  const atStart = useMemo(
    () => (on ? supplyAtStart(base.lotsByIngredient, base.plannedNeeds, base.ctx.incoming, nextIncoming, base.supply.now, startMs) : { lots: new Map<string, LedgerLot[]>(), unexpired: new Map<string, number>() }),
    [on, base.lotsByIngredient, base.plannedNeeds, base.ctx.incoming, nextIncoming, base.supply.now, startMs],
  );
  const noIncoming = useMemo(() => new Map<string, number>(), []);
  // A period document doesn't exist yet: the view shows the computed dates and the household's budget.
  const period = useMemo<StoredPeriod | null>(
    () => (upcoming ? { start: Timestamp.fromMillis(upcoming.startMs), end: Timestamp.fromMillis(upcoming.endMs), budgetCents: base.household?.budgetCents ?? 0 } : null),
    [upcoming, base.household?.budgetCents],
  );
  return usePeriodModel({
    view: "next",
    hid: base.hid,
    household: base.household,
    periodId: nextId,
    period,
    planItems,
    draftId: NEXT_DRAFT_ID,
    draft,
    ordered: base.nextOrdered,
    orderedAll: base.orderedAll,
    stores: base.stores_,
    rules: base.rules_,
    mappings: base.mappings_,
    supply: base.supply,
    livePrices: base.livePrices,
    unexpired: atStart.unexpired,
    lotsByIngredient: atStart.lots,
    incoming: noIncoming,
    fromMs: startMs,
    // The projection reads the current period's needs: wait for its model.
    baseReady: on && base.ready && draft.data !== undefined,
  });
}

export const PlanModelContext = createContext<CurrentModel | null>(null);

/** The shell's shared plan model (M23): the current period's. */
export function usePlanModel(): CurrentModel {
  const m = useContext(PlanModelContext);
  if (!m) throw new Error("usePlanModel outside PlanModelProvider");
  return m;
}

export interface NextModelCtx {
  model: PlanModel;
  /** Registers a component that shows the next period; the model is only computed while one is mounted. */
  want: () => () => void;
}
export const NextPlanModelContext = createContext<NextModelCtx | null>(null);

/**
 * The next period's model (M26). Mounting this with `enabled` starts it (one extra plan-items listener and the next
 * draft); until it has loaded its `ready` is false.
 */
export function useNextPlanModel(enabled = true): PlanModel {
  const c = useContext(NextPlanModelContext);
  if (!c) throw new Error("useNextPlanModel outside PlanModelProvider");
  const want = c.want;
  useEffect(() => (enabled ? want() : undefined), [want, enabled]);
  return c.model;
}

/** The model for a view: the current period's, or the next period's (M26). */
export function useViewModel(view: PeriodView): PlanModel {
  const cur = usePlanModel();
  const next = useNextPlanModel(view === "next");
  return view === "next" ? next : cur;
}
