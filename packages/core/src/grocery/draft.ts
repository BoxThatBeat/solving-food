// The stored grocery draft (TECHNICAL_SPECS §8 "Regeneration", M17 "Removing a line"): merging regenerated lines into
// what members have ticked, removed or added, and the totals without removed lines.

import type { GroceryItem } from "../types";
import type { PriceSource } from "../pricing";
import type { BuiltList } from "./builder";

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** Generated line sources: rewritten by regeneration; the rest (manual, cadence) are kept as stored. */
export function isGenerated(it: Pick<GroceryItem, "source">): boolean {
  return it.source === "plan" || it.source === "staple";
}

/**
 * Regeneration (§8): which fields of the stored draft to write so it matches the generated lines (plan lines and, since
 * M10, staple lines). Manual and cadence lines are kept; ticks on generated lines survive; generated lines no longer
 * wanted are removed. Field-level updates,
 * so two members regenerating or ticking at once don't overwrite each other (§11). Lines taken off with their ×
 * (`removed`, M17) keep the flag, unless `restore` (the Regenerate button, or a new period) puts them all back.
 */
export function mergeDraft(
  existing: Readonly<Record<string, GroceryItem>>,
  generated: Readonly<Record<string, GroceryItem>>,
  opts: { restore?: boolean } = {},
): { set: Record<string, GroceryItem>; remove: string[] } {
  const set: Record<string, GroceryItem> = {};
  const remove: string[] = [];
  for (const [id, gen] of Object.entries(generated)) {
    const e = existing[id];
    if (e && !isGenerated(e)) continue; // a manual line with an ingredient ID never collides (manual_<uuid>)
    const merged: GroceryItem = { ...gen, checked: e?.checked ?? false };
    delete merged.removed;
    if (e?.checkedBy) merged.checkedBy = e.checkedBy;
    // A removed line (M17, R7.13) stays removed through regeneration, until Regenerate restores it. An un-removed line
    // (Undo writes `removed: false`) keeps its flag too, so regeneration doesn't rewrite it every time (M21).
    if (e?.removed === true && !opts.restore) merged.removed = true;
    if (e?.removed === false) merged.removed = false;
    if (!e || stable(e) !== stable(merged)) set[id] = merged;
  }
  for (const [id, e] of Object.entries(existing)) if (isGenerated(e) && !(id in generated)) remove.push(id);
  return { set, remove };
}

/** A line taken off the draft with its × (M17, R7.13): not shown, copied, ordered, or counted. */
export function isRemoved(it: Pick<GroceryItem, "removed">): boolean {
  return it.removed === true;
}

/** IDs of the removed lines of a stored list (M17). */
export function removedLineIds(items: Readonly<Record<string, GroceryItem>> | undefined): Set<string> {
  return new Set(Object.entries(items ?? {}).flatMap(([id, it]) => (isRemoved(it) ? [id] : [])));
}

/**
 * The built plan lines without the ones the household removed (M17, R7.13), totals recomputed: what the next order
 * will actually buy, so the budget meter (R6.3) and Use it up (R6.25) leave removed lines out.
 */
export function withoutRemoved(built: BuiltList, removed: ReadonlySet<string>): BuiltList {
  if (!removed.size) return built;
  const items: Record<string, GroceryItem> = {};
  let totalCents = 0;
  let unknownPrices = 0;
  const sources: Record<PriceSource, number> = { live: 0, estimate: 0, unknown: 0 };
  for (const [id, line] of Object.entries(built.items)) {
    if (removed.has(id)) continue;
    items[id] = line;
    if (line.estPriceCents === null) unknownPrices++;
    else totalCents += line.estPriceCents;
    sources[line.estPriceCents === null ? "unknown" : (line.priceSource ?? "estimate")]++;
  }
  return { items, totalCents, unknownPrices, sources };
}

/**
 * Marking a store ordered (R7.14) inside a transaction (M23): of the lines the page shows for that store, the ones the
 * stored draft still holds (and that weren't taken off with their ×). A line another member has just ordered is gone
 * from the draft, so pressing at the same time can't put it on two ordered lists.
 */
export function orderableLines(
  stored: Readonly<Record<string, GroceryItem>> | undefined,
  shown: Readonly<Record<string, GroceryItem>>,
): Record<string, GroceryItem> {
  const out: Record<string, GroceryItem> = {};
  for (const [id, it] of Object.entries(shown)) {
    const s = stored?.[id];
    if (!s || isRemoved(s)) continue;
    out[id] = { ...it, checked: s.checked, ...(s.checkedBy ? { checkedBy: s.checkedBy } : {}) };
    if (!s.checkedBy) delete out[id]!.checkedBy;
  }
  return out;
}
