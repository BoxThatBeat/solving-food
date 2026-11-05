// Staples on the grocery list (M10, PRD R7.12, R7.7, R8.14; TECHNICAL_SPECS §8): free-use and staple ingredients that
// are due by cadence, used by the plan, or run out get one default pack each, keyed `staple_<id>`.

import type { GroceryItem } from "../types";
import { cadenceInterval, isDue, type CadenceLike } from "../cadence";
import { manualItem, type BuildContext, type GroceryIngredient, type PlanItemInput } from "./builder";

const EPS = 1e-9;


export interface StapleIngredient extends GroceryIngredient {
  isStaple?: boolean | undefined;
  defaultCadenceDays?: number | undefined;
}

export interface StapleInput {
  /** The period's plan items: free-use ingredients their recipes and sides use (with an amount) count as needed. */
  items: readonly PlanItemInput[];
  /** The household's cadence docs (every staple it has bought). */
  cadence: ReadonlyArray<{ ingredientId: string; c: CadenceLike }>;
  /** Ingredients already on a list: any draft line other than a staple line, the plan lines, ordered lists. */
  onList: ReadonlySet<string>;
  /** `dismissedStaples` of the draft: ingredient → until (ms). */
  dismissed?: Readonly<Record<string, number>> | undefined;
  nowMs: number;
}

export type StapleReason = "cadence" | "plan" | "out";

/** Free-use ingredients the planned, uncooked items use with an amount (optional and vague lines don't count). */
export function freeUseNeeded(items: readonly PlanItemInput[], ctx: { recipes: BuildContext["recipes"]; ingredients: (id: string) => Pick<GroceryIngredient, "freeUse"> | undefined }): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    if (it.status !== "planned") continue;
    for (const ref of it.recipes) {
      for (const line of ctx.recipes(ref.recipeId)?.ingredients ?? []) {
        if (line.optional || !(line.canonicalAmount > 0)) continue;
        if (ctx.ingredients(line.ingredientId)?.freeUse) out.add(line.ingredientId);
      }
    }
  }
  return out;
}

/**
 * The staples the list adds by itself (R7.12), most overdue first, then by name. A staple (marked `isStaple`, which every
 * free-use ingredient but water is) is due when:
 *   - cadence: bought before and 85 % of its interval has passed (the R7.7 rule; a snooze is respected);
 *   - plan:    free-use, a planned meal uses it, and the household has never bought it (or the cadence says it's due);
 *   - out:     a tracked staple bought before with no unexpired Supply left.
 * Never when it's already on a list or the household removed it from the list until a later time.
 */
export function dueStaples(input: StapleInput, ctx: { recipes: BuildContext["recipes"]; ingredients: (id: string) => StapleIngredient | undefined; supply: BuildContext["supply"] }): Array<{ ingredientId: string; reason: StapleReason }> {
  const cadence = new Map(input.cadence.map((x) => [x.ingredientId, x.c]));
  const usedByPlan = freeUseNeeded(input.items, ctx);
  const ids = new Set([...cadence.keys(), ...usedByPlan]);
  const out: Array<{ ingredientId: string; reason: StapleReason; rank: number }> = [];
  for (const id of ids) {
    const ing = ctx.ingredients(id);
    // Marked staple (every free-use ingredient is one, except water, which nobody buys).
    if (!ing || !ing.isStaple) continue;
    if (input.onList.has(id)) continue;
    if ((input.dismissed?.[id] ?? 0) > input.nowMs) continue;
    const c = cadence.get(id) ?? null;
    if (c?.snoozedUntilMs && input.nowMs < c.snoozedUntilMs) continue; // "Not yet" from a pre-M10 prompt
    const bought = !!c?.lastPurchasedAtMs;
    const days = cadenceInterval(c, ing.defaultCadenceDays);
    const ratio = bought && days ? (input.nowMs - c!.lastPurchasedAtMs!) / (days * 86_400_000) : 0;
    if (bought && isDue(c, ing, input.nowMs)) out.push({ ingredientId: id, reason: "cadence", rank: ratio });
    else if (ing.freeUse && usedByPlan.has(id) && !bought) out.push({ ingredientId: id, reason: "plan", rank: 0 });
    else if (!ing.freeUse && bought && (ctx.supply.get(id) ?? 0) <= EPS) out.push({ ingredientId: id, reason: "out", rank: ratio });
  }
  const name = (id: string) => ctx.ingredients(id)?.name ?? id;
  return out.sort((a, b) => b.rank - a.rank || name(a.ingredientId).localeCompare(name(b.ingredientId))).map(({ ingredientId, reason }) => ({ ingredientId, reason }));
}

/** The draft key of a staple line. */
export const stapleKey = (ingredientId: string) => `staple_${ingredientId}`;

/** The staple lines (one default pack each, priced and store-resolved like a manual line), keyed `staple_<id>`. */
export function stapleLines(input: StapleInput, ctx: Omit<BuildContext, "ingredients"> & { ingredients: (id: string) => StapleIngredient | undefined }): Record<string, GroceryItem> {
  const out: Record<string, GroceryItem> = {};
  for (const { ingredientId, reason } of dueStaples(input, ctx)) {
    out[stapleKey(ingredientId)] = { ...manualItem({ ingredientId, packs: 1 }, ctx), source: "staple", stapleReason: reason };
  }
  return out;
}

/** Until when a removed staple stays off the list: its usual interval, and at least to the end of the period. */
export function stapleDismissUntil(ingredient: { defaultCadenceDays?: number | undefined }, cadence: Pick<CadenceLike, "avgIntervalDays" | "purchaseCount"> | null, nowMs: number, periodEndMs: number | null): number {
  const days = cadenceInterval(cadence, ingredient.defaultCadenceDays) ?? 7;
  return Math.max(nowMs + days * 86_400_000, periodEndMs ?? 0);
}
