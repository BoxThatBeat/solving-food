// Substitutions (M28, PRD R6.35, R4.40, R7.20, R11.20; TECHNICAL_SPECS §7 "Substitutions"). A small, curated,
// deterministic table of common swaps keyed by seed ingredient IDs (data/ingredients), each with a ratio in canonical
// units: grams of the substitute per gram of the original. `basis` is the kitchen rule the ratio comes from ("1 clove →
// ⅛ tsp powder", "fresh : dried = 3 : 1 by volume"); a unit test recomputes every ratio from it with the seed's
// densities and unit weights. `both` entries work either way (the reverse ratio is 1 / ratio); `cookingOnly` ones are
// never offered for a baking recipe (butter ↔ oil). Nothing here buys a substitute: the grocery list is unchanged.

import { EPS } from "./math";

/** A kitchen measure in `basis`: grams, millilitres, spoons (volume), or one whole item (the seed's unit weight). */
export type SubstitutionUnit = "g" | "ml" | "tsp" | "tbsp" | "each";

export interface Substitution {
  /** The ingredient the recipe asks for. */
  from: string;
  /** What can stand in for it. */
  to: string;
  /** Grams of `to` per gram of `from` (canonical units; every seed ingredient is weighed in grams). */
  ratio: number;
  /** The rule behind the ratio: [amount of `from`, its unit, amount of `to`, its unit]. */
  basis: readonly [number, SubstitutionUnit, number, SubstitutionUnit];
  /** Works the other way too (the reverse ratio is 1 / ratio). */
  both?: true;
  /** Fine in cooking, not in baking (butter ↔ oil). */
  cookingOnly?: true;
  /** A tip shown with the swap ("add 1 tbsp vinegar per cup"). */
  note?: string;
}

export const SUBSTITUTIONS: readonly Substitution[] = [
  { from: "shallot", to: "onion", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "red-onion", to: "onion", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "sweet-onion", to: "onion", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "onion", to: "onion-powder", ratio: 0.0483, basis: [1, "each", 1, "tbsp"] },
  { from: "lime", to: "lemon", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "lime-juice", to: "lemon-juice", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "lime-zest", to: "lemon-zest", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "lemon", to: "lemon-juice", ratio: 0.464, basis: [1, "each", 45, "ml"] },
  { from: "lime", to: "lime-juice", ratio: 0.461, basis: [1, "each", 30, "ml"] },
  { from: "garlic", to: "garlic-powder", ratio: 0.0776, basis: [1, "each", 0.125, "tsp"] },
  { from: "fresh-ginger", to: "ground-ginger", ratio: 0.075, basis: [1, "tbsp", 0.25, "tsp"] },
  { from: "fresh-basil", to: "dried-basil", ratio: 0.233, basis: [3, "tsp", 1, "tsp"], both: true },
  { from: "fresh-oregano", to: "dried-oregano", ratio: 0.333, basis: [3, "tsp", 1, "tsp"], both: true },
  { from: "fresh-thyme", to: "dried-thyme", ratio: 0.333, basis: [3, "tsp", 1, "tsp"], both: true },
  { from: "fresh-rosemary", to: "dried-rosemary", ratio: 0.417, basis: [3, "tsp", 1, "tsp"], both: true },
  { from: "fresh-parsley", to: "dried-parsley", ratio: 0.133, basis: [3, "tsp", 1, "tsp"], both: true },
  { from: "fresh-dill", to: "dried-dill", ratio: 0.444, basis: [3, "tsp", 1, "tsp"], both: true },
  { from: "sour-cream", to: "plain-yogurt", ratio: 1.06, basis: [1, "ml", 1, "ml"], both: true },
  { from: "sour-cream", to: "greek-yogurt", ratio: 1.06, basis: [1, "ml", 1, "ml"], both: true },
  { from: "greek-yogurt", to: "plain-yogurt", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "buttermilk", to: "milk", ratio: 1, basis: [1, "ml", 1, "ml"], note: "add 1 tbsp vinegar or lemon juice per cup" },
  { from: "milk", to: "whole-milk", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "milk", to: "1-milk", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "milk", to: "skim-milk", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "half-and-half", to: "table-cream", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "chicken-thigh", to: "chicken-breast", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "ground-turkey", to: "ground-chicken", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "lean-ground-beef", to: "medium-ground-beef", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "lean-ground-beef", to: "extra-lean-ground-beef", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "chicken-broth", to: "vegetable-broth", ratio: 1, basis: [1, "ml", 1, "ml"], both: true },
  { from: "chicken-broth", to: "chicken-bouillon-powder", ratio: 0.0118, basis: [250, "ml", 1, "tsp"], note: "in 250 ml hot water" },
  { from: "spinach", to: "baby-spinach", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "canned-diced-tomato", to: "canned-whole-tomato", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "canned-diced-tomato", to: "canned-crushed-tomato", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "tomato", to: "roma-tomato", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "cherry-tomato", to: "grape-tomato", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "mushroom", to: "cremini-mushroom", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "red-bell-pepper", to: "orange-bell-pepper", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "red-bell-pepper", to: "yellow-bell-pepper", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "white-rice", to: "jasmine-rice", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "jasmine-rice", to: "basmati-rice", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "penne", to: "rotini", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "spaghetti", to: "linguine", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "linguine", to: "fettuccine", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "cheddar-cheese", to: "old-cheddar-cheese", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "cheddar-cheese", to: "marble-cheese", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "cheddar-cheese", to: "monterey-jack-cheese", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "canned-black-bean", to: "canned-kidney-bean", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "panko", to: "breadcrumb", ratio: 1.84, basis: [1, "ml", 1, "ml"], both: true },
  { from: "maple-syrup", to: "honey", ratio: 1.08, basis: [1, "ml", 1, "ml"], both: true },
  { from: "cucumber", to: "english-cucumber", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "zucchini", to: "yellow-squash", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "romaine-lettuce", to: "green-leaf-lettuce", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "potato", to: "yellow-potato", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "yellow-potato", to: "red-potato", ratio: 1, basis: [1, "g", 1, "g"], both: true },
  { from: "red-pepper-flake", to: "cayenne-pepper", ratio: 0.6, basis: [1, "tsp", 0.5, "tsp"], both: true },
  { from: "butter", to: "olive-oil", ratio: 0.719, basis: [1, "tbsp", 0.75, "tbsp"], both: true, cookingOnly: true },
];

/** One way a missing ingredient can be covered: the substitute, its ratio, and the entry's flags. */
export interface SubstituteOption {
  to: string;
  ratio: number;
  cookingOnly: boolean;
  note?: string | undefined;
}

let byFrom: Map<string, SubstituteOption[]> | null = null;

/** The substitutes for an ingredient, in table order (the first one with enough in Supply wins). */
export function substitutesFor(id: string): readonly SubstituteOption[] {
  if (!byFrom) {
    byFrom = new Map();
    const add = (from: string, o: SubstituteOption) => {
      const l = byFrom!.get(from);
      if (l) l.push(o);
      else byFrom!.set(from, [o]);
    };
    for (const s of SUBSTITUTIONS) {
      add(s.from, { to: s.to, ratio: s.ratio, cookingOnly: !!s.cookingOnly, note: s.note });
      if (s.both) add(s.to, { to: s.from, ratio: 1 / s.ratio, cookingOnly: !!s.cookingOnly, note: s.note });
    }
  }
  return byFrom.get(id) ?? [];
}

/** Grams of `to` per gram of `from` when the table has that swap, else null. */
export function substitutionRatio(from: string, to: string): number | null {
  return substitutesFor(from).find((o) => o.to === to)?.ratio ?? null;
}

/** Tags that make a recipe baking, where `cookingOnly` swaps (butter ↔ oil) are never offered. */
const BAKING_TAGS = new Set(["baking", "baked goods", "dessert", "cake", "cookie", "cookies", "bread", "muffin", "muffins", "pastry", "pie", "treat"]);

export function isBaking(tags: readonly string[] | undefined): boolean {
  return (tags ?? []).some((t) => BAKING_TAGS.has(t.toLowerCase()));
}

/** A missing ingredient covered by a substitute in Supply. */
export interface Swap {
  /** The ingredient the recipe asks for. */
  ingredientId: string;
  /** What stands in for it. */
  withIngredientId: string;
  /** Canonical amount of the original the swap covers (the shortfall). */
  replaces: number;
  /** Canonical amount of the substitute it takes. */
  amount: number;
  note?: string | undefined;
}

/**
 * The swaps that cover what Supply lacks (M28, R6.35, R4.40). For each needed ingredient that `have` doesn't cover,
 * the first substitute (table order) whose spare amount (what `have` holds minus what the same needs already ask of it
 * and minus earlier swaps) covers the shortfall × ratio. Only the shortfall is swapped: 100 g of onion with 60 g in
 * Supply takes the 60 g and 40 g of shallot. A baking recipe never gets a `cookingOnly` swap. Deterministic: needs in
 * their own order, substitutes in table order.
 */
export function findSwaps(needs: ReadonlyMap<string, number>, have: ReadonlyMap<string, number>, opts: { baking?: boolean | undefined } = {}): Swap[] {
  const out: Swap[] = [];
  const taken = new Map<string, number>();
  for (const [id, need] of needs) {
    const short = need - Math.max(0, have.get(id) ?? 0);
    if (!(short > EPS)) continue;
    for (const o of substitutesFor(id)) {
      if (o.cookingOnly && opts.baking) continue;
      const spare = Math.max(0, have.get(o.to) ?? 0) - (needs.get(o.to) ?? 0) - (taken.get(o.to) ?? 0);
      const amount = short * o.ratio;
      if (spare + EPS < amount) continue;
      taken.set(o.to, (taken.get(o.to) ?? 0) + amount);
      out.push({ ingredientId: id, withIngredientId: o.to, replaces: short, amount, ...(o.note ? { note: o.note } : {}) });
      break;
    }
  }
  return out;
}

/**
 * A substitute already in Supply for a whole grocery line (M28, R7.20): `have` is projected Supply (what planned meals
 * leave), the line's own ingredient ignored. Null when none covers `amount`.
 */
export function substituteInSupply(ingredientId: string, amount: number, have: ReadonlyMap<string, number>): Swap | null {
  if (!(amount > EPS)) return null;
  const without = new Map(have);
  without.delete(ingredientId);
  return findSwaps(new Map([[ingredientId, amount]]), without)[0] ?? null;
}

/** An accepted swap as the finishCooking command carries it: the substitute and how much of it was used. */
export interface SwapUse {
  ingredientId: string;
  withIngredientId: string;
  amount: number;
}

/**
 * What a meal uses once its accepted swaps are applied (M28, R4.40): each swap takes `amount` of the substitute and
 * `amount / ratio` less of the original (never below zero; dropped at zero). A pair the table doesn't have is ignored,
 * so a forged command can't move Supply between unrelated ingredients. The result keeps the needs' order, substitutes
 * appended.
 */
export function applySwaps(needs: ReadonlyMap<string, number>, swaps: readonly SwapUse[]): Map<string, number> {
  const out = new Map(needs);
  for (const s of swaps) {
    const ratio = substitutionRatio(s.ingredientId, s.withIngredientId);
    if (ratio === null || !(s.amount > 0) || !out.has(s.ingredientId)) continue;
    const left = (out.get(s.ingredientId) ?? 0) - s.amount / ratio;
    if (left > EPS) out.set(s.ingredientId, left);
    else out.delete(s.ingredientId);
    out.set(s.withIngredientId, (out.get(s.withIngredientId) ?? 0) + s.amount);
  }
  return out;
}

/** Swaps that cover what the suggestion factor counts as missing count this much of a missing ingredient (§7). */
export const SWAP_PENALTY = 0.25;

/** "garlic: use 0.8 g garlic powder from Supply" (the suggestion reason and the mise en place line). */
export function swapText(s: Pick<Swap, "ingredientId" | "withIngredientId" | "amount">, name: (id: string) => string, amount: (id: string, n: number) => string): string {
  return `${name(s.ingredientId)}: use ${amount(s.withIngredientId, s.amount)} ${name(s.withIngredientId)} from Supply`;
}
