// The grocery builder (PRD R7.1–R7.6, R6.3, R6.4; TECHNICAL_SPECS §8 "Builder", §7 "Budget").
//
//   needs     = Σ requirements of planned, uncooked items (scaled by servings), excluding free-use ingredients
//               + Σ side.portion × servings (R5.10, R7.11; free-use sides excluded)
//   incoming  = Σ amounts on this household's lists with status "ordered" (copied, not yet received)
//   shortfall = max(0, needs − unexpired supply − incoming)
//   packSize  = brandMapping.packAmount ?? ingredient.defaultPackAmount ?? shortfall      // no rounding if unknown
//   packs     = ceil(shortfall / packSize)
//   store     = brandMapping.storeId → ingredient sourcing rule → category sourcing rule → household default store
//
// Supply is empty until M3, but it is an input from the start. The budget meter's "spent" is the priced shortfall:
// what the next order will cost (R6.3). Pure: no Firebase.

import type { Measure } from "../taxonomy";
import type { IngredientConversion, IngredientRef } from "../ingredientTypes";
import type { GroceryItem } from "../types";
import { packToCanonical, resolvePrice, type LivePrice, type PriceEstimate, type PriceSource } from "../pricing";
import type { RecipeRef } from "../plan";
import { FLOAT_EPS as EPS, round3 } from "../math";

export interface GroceryIngredient extends IngredientRef, IngredientConversion {
  category: string;
  freeUse: boolean;
  defaultPackAmount?: number | undefined;
  defaultPackMeasure?: Measure | undefined;
}

/** A side on a meal (R5.9): an ingredient eaten as is, `portion` per person in canonical units. */
export interface SideRef {
  ingredientId: string;
  portion: number;
}

export interface PlanItemInput {
  id: string;
  status: string;
  servings: number;
  recipes: readonly RecipeRef[];
  sides?: readonly SideRef[] | undefined;
}

export interface RecipeLines {
  servings: number;
  ingredients: ReadonlyArray<{ ingredientId: string; canonicalAmount: number; optional: boolean }>;
}

export interface StoreEntry {
  id: string;
  name: string;
  kind: "pcExpress" | "inStore";
  bulk: boolean;
}

export interface MappingEntry {
  productName: string;
  productCode?: string | undefined;
  packAmount: number;
  packMeasure: Measure;
  storeId: string;
}

export interface RuleEntry {
  match: { category: string } | { ingredientId: string };
  storeId: string;
}

export interface PricingContext {
  estimates: Readonly<Record<string, PriceEstimate>>;
  /** Live PC Express price for a mapped product (M5). */
  live?: (ingredientId: string, mapping: MappingEntry) => LivePrice | undefined;
  nowMs?: number;
}

export interface BuildContext {
  recipes: (id: string) => RecipeLines | undefined;
  ingredients: (id: string) => GroceryIngredient | undefined;
  /** Unexpired supply per ingredient, canonical (expired lots excluded by the caller, R8.15). */
  supply: ReadonlyMap<string, number>;
  incoming: ReadonlyMap<string, number>;
  mappings: ReadonlyMap<string, MappingEntry>;
  rules: readonly RuleEntry[];
  stores: readonly StoreEntry[];
  defaultStoreId?: string | undefined;
  prices: PricingContext;
}

export const UNASSIGNED_STORE = "unassigned";

/** Canonical requirements of the planned items and their sides, free-use, optional, and vague lines excluded (R8.14). */
export function needsFor(items: readonly PlanItemInput[], ctx: { recipes: BuildContext["recipes"]; ingredients: (id: string) => Pick<GroceryIngredient, "freeUse"> | undefined }): Map<string, number> {
  const needs = new Map<string, number>();
  for (const it of items) {
    if (it.status !== "planned") continue;
    for (const ref of it.recipes) {
      const r = ctx.recipes(ref.recipeId);
      if (!r || r.servings <= 0) continue;
      const factor = (it.servings * ref.servingsMultiplier) / r.servings;
      for (const line of r.ingredients) {
        if (line.optional || line.canonicalAmount <= 0) continue;
        const ing = ctx.ingredients(line.ingredientId);
        if (ing?.freeUse) continue;
        needs.set(line.ingredientId, (needs.get(line.ingredientId) ?? 0) + line.canonicalAmount * factor);
      }
    }
    // Sides (R5.10): one portion per serving. A side that's also a recipe ingredient is summed.
    for (const side of it.sides ?? []) {
      if (!(side.portion > 0)) continue;
      if (ctx.ingredients(side.ingredientId)?.freeUse) continue;
      needs.set(side.ingredientId, (needs.get(side.ingredientId) ?? 0) + side.portion * it.servings);
    }
  }
  return needs;
}

function clean(n: number, digits = 2): string {
  return Number(n.toFixed(digits)).toString();
}

/** "400 g", "2 kg", "946 ml", "4 L", "12 ct". */
export function packLabel(amount: number, measure: Measure): string {
  if (measure === "weight") return amount >= 1000 ? `${clean(amount / 1000)} kg` : `${clean(amount, 0)} g`;
  if (measure === "volume") return amount >= 1000 ? `${clean(amount / 1000)} L` : `${clean(amount, 0)} ml`;
  return `${clean(amount)} ct`;
}

export interface PackSize {
  /** Canonical amount per pack. */
  amount: number;
  label: string;
  source: "mapping" | "default";
}

/** Pack size: the brand mapping's, else the ingredient's typical pack, else none (R7.1). */
export function packSizeFor(ing: GroceryIngredient, mapping?: MappingEntry): PackSize | null {
  if (mapping) {
    const c = packToCanonical(mapping.packAmount, mapping.packMeasure, ing);
    if (c) return { amount: c, label: packLabel(mapping.packAmount, mapping.packMeasure), source: "mapping" };
  }
  if (ing.defaultPackAmount && ing.defaultPackMeasure) {
    const c = packToCanonical(ing.defaultPackAmount, ing.defaultPackMeasure, ing);
    if (c) return { amount: c, label: packLabel(ing.defaultPackAmount, ing.defaultPackMeasure), source: "default" };
  }
  return null;
}

/** Store resolution (§8): mapping → ingredient rule → category rule → default store → first store. */
export function storeFor(ing: Pick<GroceryIngredient, "id" | "category">, ctx: Pick<BuildContext, "mappings" | "rules" | "stores" | "defaultStoreId">): string {
  const known = new Set(ctx.stores.map((s) => s.id));
  const ok = (id: string | undefined): id is string => !!id && known.has(id);
  const m = ctx.mappings.get(ing.id)?.storeId;
  if (ok(m)) return m;
  const byIng = ctx.rules.find((r) => "ingredientId" in r.match && r.match.ingredientId === ing.id)?.storeId;
  if (ok(byIng)) return byIng;
  const cat = ing.category.toLowerCase();
  const byCat = ctx.rules.find((r) => "category" in r.match && r.match.category.toLowerCase() === cat)?.storeId;
  if (ok(byCat)) return byCat;
  if (ok(ctx.defaultStoreId)) return ctx.defaultStoreId;
  return ctx.stores[0]?.id ?? UNASSIGNED_STORE;
}

function priceOf(ing: GroceryIngredient, ctx: Pick<BuildContext, "mappings" | "prices">): { cpu: number | null; source: PriceSource } {
  const mapping = ctx.mappings.get(ing.id);
  const live = mapping ? ctx.prices.live?.(ing.id, mapping) : undefined;
  const r = resolvePrice(ing, mapping, live, ctx.prices.estimates, ctx.prices.nowMs);
  return { cpu: r.centsPerUnit, source: r.source };
}

/** How much a shortfall costs to buy: whole packs when a pack size is known, else the raw amount. */
function purchase(ing: GroceryIngredient, shortfall: number, ctx: Pick<BuildContext, "mappings" | "prices">) {
  const pack = packSizeFor(ing, ctx.mappings.get(ing.id));
  const packs = pack ? Math.ceil(shortfall / pack.amount - EPS) : 1;
  const amount = pack ? packs * pack.amount : shortfall;
  const { cpu, source } = priceOf(ing, ctx);
  return { pack, packs, amount, cents: cpu === null ? null : Math.round(amount * cpu), source };
}

/** The plan line for one ingredient, or null when supply and incoming cover it. */
export function lineFor(ingredientId: string, need: number, ctx: BuildContext): GroceryItem | null {
  const ing = ctx.ingredients(ingredientId);
  if (!ing) return null;
  const shortfall = Math.max(0, need - Math.max(0, ctx.supply.get(ingredientId) ?? 0) - Math.max(0, ctx.incoming.get(ingredientId) ?? 0));
  if (shortfall <= EPS) return null;
  const p = purchase(ing, shortfall, ctx);
  const mapping = ctx.mappings.get(ingredientId);
  const item: GroceryItem = {
    ingredientId,
    amount: round3(p.amount),
    measure: ing.canonicalUnit,
    need: round3(shortfall),
    packAmount: p.pack ? round3(p.pack.amount) : null,
    packs: p.packs,
    productName: mapping?.productName ?? capitalise(ing.name),
    storeId: storeFor(ing, ctx),
    estPriceCents: p.cents,
    priceSource: p.source,
    source: "plan",
    checked: false,
  };
  if (p.pack) item.packLabel = p.pack.label;
  return item;
}


function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface BuiltList {
  /** Plan lines keyed by ingredient ID. */
  items: Record<string, GroceryItem>;
  /** Σ estimated price of the plan lines: the budget meter's "spent" (R6.3). */
  totalCents: number;
  /** Plan lines without a price (count as $0, flagged on the meter). */
  unknownPrices: number;
  /** How many plan lines are priced from each source (the meter's source mix, M5). */
  sources: Record<PriceSource, number>;
}

/** `buildList(...)`: the generated (plan) part of the list. Manual items are merged separately (`mergeDraft`). */
export function buildList(items: readonly PlanItemInput[], ctx: BuildContext): BuiltList {
  const needs = needsFor(items, ctx);
  const out: Record<string, GroceryItem> = {};
  let totalCents = 0;
  let unknownPrices = 0;
  const sources: Record<PriceSource, number> = { live: 0, estimate: 0, unknown: 0 };
  for (const [id, need] of [...needs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const line = lineFor(id, need, ctx);
    if (!line) continue;
    out[id] = line;
    if (line.estPriceCents === null) unknownPrices++;
    else totalCents += line.estPriceCents;
    sources[line.estPriceCents === null ? "unknown" : (line.priceSource ?? "estimate")]++;
  }
  return { items: out, totalCents, unknownPrices, sources };
}

/** Cost of buying the shortfall of a set of needs. */
export function costOfNeeds(needs: ReadonlyMap<string, number>, ctx: BuildContext): { cents: number; unknown: number } {
  let cents = 0;
  let unknown = 0;
  for (const [id, need] of needs) {
    const line = lineFor(id, need, ctx);
    if (!line) continue;
    if (line.estPriceCents === null) unknown++;
    else cents += line.estPriceCents;
  }
  return { cents, unknown };
}

/**
 * Marginal cost of each planned item in the given order (oldest first): what it adds to the order on top of the items
 * before it. Pack rounding makes this order-dependent (the first recipe needing flour pays for the bag), which is
 * accepted (§7). The costs sum to `buildList(...).totalCents`.
 */
export function itemCosts(items: readonly PlanItemInput[], ctx: BuildContext): Map<string, { cents: number; unknown: number }> {
  const out = new Map<string, { cents: number; unknown: number }>();
  const planned = items.filter((i) => i.status === "planned");
  let prev = { cents: 0, unknown: 0 };
  for (let i = 0; i < planned.length; i++) {
    const now = costOfNeeds(needsFor(planned.slice(0, i + 1), ctx), ctx);
    out.set(planned[i]!.id, { cents: now.cents - prev.cents, unknown: Math.max(0, now.unknown - prev.unknown) });
    prev = now;
  }
  return out;
}

/** What adding `candidate` to the plan would add to the next order (the Create meal sheet's budget impact). */
export function addedCost(items: readonly PlanItemInput[], candidate: PlanItemInput, ctx: BuildContext): { cents: number; unknown: number } {
  const before = costOfNeeds(needsFor(items, ctx), ctx);
  const after = costOfNeeds(needsFor([...items, { ...candidate, status: "planned" }], ctx), ctx);
  return { cents: after.cents - before.cents, unknown: Math.max(0, after.unknown - before.unknown) };
}

/**
 * What pricing one ingredient's line needs, computed once (M21): what Supply and incoming already cover, the pack
 * size and the cents per canonical unit. `lineCents` from it equals `lineFor(...).estPriceCents` exactly.
 */
export interface LinePricing {
  /** Unexpired supply and incoming, kept apart so the arithmetic matches `lineFor` to the last bit. */
  supply: number;
  incoming: number;
  packAmount: number | null;
  centsPerUnit: number | null;
}

/** The pricing table entry for one ingredient, or null when the ingredient is unknown (no line). */
export function linePricing(ingredientId: string, ctx: BuildContext): LinePricing | null {
  const ing = ctx.ingredients(ingredientId);
  if (!ing) return null;
  return {
    supply: Math.max(0, ctx.supply.get(ingredientId) ?? 0),
    incoming: Math.max(0, ctx.incoming.get(ingredientId) ?? 0),
    packAmount: packSizeFor(ing, ctx.mappings.get(ingredientId))?.amount ?? null,
    centsPerUnit: priceOf(ing, ctx).cpu,
  };
}

/** A line's estimated cents at `need` from its pricing entry: 0 when covered, null when the price is unknown. */
export function lineCents(p: LinePricing | null, need: number): number | null {
  if (!p) return 0;
  // Same arithmetic as lineFor/purchase, so results are identical to the line-building path.
  const shortfall = Math.max(0, need - p.supply - p.incoming);
  if (shortfall <= EPS) return 0;
  const amount = p.packAmount ? Math.ceil(shortfall / p.packAmount - EPS) * p.packAmount : shortfall;
  return p.centsPerUnit === null ? null : Math.round(amount * p.centsPerUnit);
}

/**
 * A fast marginal-cost function over a fixed plan (suggestions and the optimiser price hundreds of candidates): the
 * plan's needs are summed once, and a candidate's cost is Σ over its own ingredients of (line cost with it − line cost
 * without it). Lines are independent per ingredient, so this equals `addedCost` exactly, shared packs included. Each
 * ingredient's cover, pack and price are looked up once per function (`linePricing`), not per call (M21: the optimiser
 * calls this 10⁵–10⁶ times).
 */
export function marginalCostFn(planned: readonly PlanItemInput[], ctx: BuildContext): (extra: ReadonlyMap<string, number>) => { cents: number; unknown: number } {
  const base = needsFor(planned, ctx);
  const table = new Map<string, { p: LinePricing | null; base: number; before: number | null }>();
  const entry = (id: string) => {
    let e = table.get(id);
    if (!e) {
      const p = linePricing(id, ctx);
      const b = base.get(id) ?? 0;
      e = { p, base: b, before: b > 0 ? lineCents(p, b) : 0 };
      table.set(id, e);
    }
    return e;
  };
  return (extra) => {
    let cents = 0;
    let unknown = 0;
    for (const [id, add] of extra) {
      if (!(add > 0)) continue;
      const e = entry(id);
      const after = lineCents(e.p, e.base + add);
      if (after === null || e.before === null) {
        if (after === null && e.before !== null) unknown++;
        continue;
      }
      cents += after - e.before;
    }
    return { cents, unknown };
  };
}

/** Incoming = canonical amounts on ordered (not yet received) lists, per ingredient (§8). */
export function incomingFrom(lists: ReadonlyArray<{ status: string; items: Record<string, Pick<GroceryItem, "ingredientId" | "amount">> }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lists) {
    if (l.status !== "ordered") continue;
    for (const it of Object.values(l.items)) {
      if (!it.ingredientId || !(it.amount > 0)) continue;
      m.set(it.ingredientId, (m.get(it.ingredientId) ?? 0) + it.amount);
    }
  }
  return m;
}

/** A manual line (R7.6): an ingredient (priced and stored like plan lines, in packs) or free text. */
export function manualItem(
  input: { ingredientId?: string | undefined; freeText?: string | undefined; packs: number; storeId?: string | undefined },
  ctx: BuildContext,
): GroceryItem {
  const packs = Math.max(1, Math.round(input.packs));
  const ing = input.ingredientId ? ctx.ingredients(input.ingredientId) : undefined;
  if (ing) {
    const mapping = ctx.mappings.get(ing.id);
    const pack = packSizeFor(ing, mapping);
    const { cpu, source } = priceOf(ing, ctx);
    const amount = pack ? packs * pack.amount : 0;
    const item: GroceryItem = {
      ingredientId: ing.id,
      amount: round3(amount),
      measure: ing.canonicalUnit,
      packAmount: pack ? round3(pack.amount) : null,
      packs,
      productName: mapping?.productName ?? capitalise(ing.name),
      storeId: input.storeId ?? storeFor(ing, ctx),
      estPriceCents: cpu !== null && pack ? Math.round(amount * cpu) : null,
      priceSource: pack ? source : "unknown",
      source: "manual",
      checked: false,
    };
    if (pack) item.packLabel = pack.label;
    return item;
  }
  const text = (input.freeText ?? "").trim();
  return {
    freeText: text,
    amount: 0,
    measure: "",
    packs,
    productName: capitalise(text),
    storeId: input.storeId ?? (ctx.defaultStoreId && ctx.stores.some((s) => s.id === ctx.defaultStoreId) ? ctx.defaultStoreId : (ctx.stores[0]?.id ?? UNASSIGNED_STORE)),
    estPriceCents: null,
    priceSource: "unknown",
    source: "manual",
    checked: false,
  };
}

/** The default stores every household starts with (Planning/M2 §5). */
export const DEFAULT_STORES: ReadonlyArray<StoreEntry> = [
  { id: "pc-express", name: "PC Express (Loblaws Greenbank Road)", kind: "pcExpress", bulk: false },
  { id: "costco", name: "Costco (in store, bulk)", kind: "inStore", bulk: true },
];
export const DEFAULT_STORE_ID = "pc-express";
