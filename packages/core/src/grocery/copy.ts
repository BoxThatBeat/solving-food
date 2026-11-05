// Showing and copying a grocery list (PRD R7.5, R8.13; TECHNICAL_SPECS §8 "Copy"): store sections, metric amounts and
// the PC Express text for ChatGPT.

import type { GroceryItem } from "../types";
import { formatGrams, formatQuantity } from "../units";
import { DEFAULT_PCX_STORE_ID, DEFAULT_PCX_STORE_LABEL } from "../config";
import { UNASSIGNED_STORE, type StoreEntry } from "./builder";

/** Store sections in display order: PC Express first, then the others by name. Empty stores are left out. */
export function groupByStore(items: Readonly<Record<string, GroceryItem>>, stores: readonly StoreEntry[]): Array<{ store: StoreEntry; items: Array<[string, GroceryItem]> }> {
  const byStore = new Map<string, Array<[string, GroceryItem]>>();
  for (const [id, it] of Object.entries(items)) {
    const sid = stores.some((s) => s.id === it.storeId) ? it.storeId : UNASSIGNED_STORE;
    if (!byStore.has(sid)) byStore.set(sid, []);
    byStore.get(sid)!.push([id, it]);
  }
  const ordered = [...stores].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "pcExpress" ? -1 : 1));
  const out = ordered.filter((s) => byStore.has(s.id)).map((store) => ({ store, items: sortLines(byStore.get(store.id)!) }));
  if (byStore.has(UNASSIGNED_STORE)) out.push({ store: { id: UNASSIGNED_STORE, name: "No store", kind: "inStore", bulk: false }, items: sortLines(byStore.get(UNASSIGNED_STORE)!) });
  return out;
}

const SOURCE_ORDER: Record<GroceryItem["source"], number> = { plan: 0, staple: 1, cadence: 1, manual: 2 };

function sortLines(lines: Array<[string, GroceryItem]>): Array<[string, GroceryItem]> {
  // Plan lines alphabetically, then staples (M10) alphabetically, then manual lines in the order they were added.
  return lines.sort(([, a], [, b]) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.source === "manual" ? 0 : a.productName.localeCompare(b.productName)));
}

/** A canonical amount in metric (R8.13): "140 g", "3 (640 g)", or "3" for a count with no unit weight. */
export function formatCanonical(amount: number, unit: string, unitWeightG?: number): string {
  if (unit === "count") return unitWeightG ? `${formatQuantity(amount)} (${formatGrams(amount * unitWeightG)})` : formatQuantity(amount);
  return formatGrams(amount);
}

/** One clipboard line: "- Mutti Polpa, 400 g × 2", "- Baby spinach, 140 g", "- Bananas × 1". */
export function copyLine(it: GroceryItem): string {
  if (it.freeText) return `- ${it.productName} × ${it.packs}`;
  if (it.packLabel) return `- ${it.productName}, ${it.packLabel} × ${it.packs}`;
  if (it.measure === "count") return `- ${it.productName} × ${formatQuantity(Math.max(1, it.amount))}`;
  return `- ${it.productName}, ${formatGrams(it.amount)}`;
}

/**
 * The Copy button's text (R7.5, §8): only the PC Express section, LLM-friendly, with quantities and brands. Lines
 * already ticked off are still included (a tick isn't an order).
 */
export function copyText(items: Readonly<Record<string, GroceryItem>>, stores: readonly StoreEntry[], opts: { store?: string | null; instructions?: string | null } = {}): string {
  const pcx = new Set(stores.filter((s) => s.kind === "pcExpress").map((s) => s.id));
  const lines = groupByStore(items, stores)
    .filter((g) => pcx.has(g.store.id))
    .flatMap((g) => g.items.map(([, it]) => copyLine(it)));
  const store = opts.store?.trim();
  const extra = opts.instructions?.trim();
  return [
    store ? `Please add these to my PC Express cart at the ${store} store (use this store; don't ask me to pick one):` : "Please add these to my PC Express cart:",
    ...lines,
    "Substitutions: closest equivalent size; skip if unavailable.",
    ...(extra ? [extra] : []),
  ].join("\n");
}

/** The household's PC Express store as ChatGPT should hear it (R7.5): the picked store's name, else the default's. */
export function pcxStoreForCopy(pcxStoreId: string | null | undefined, pcxStoreName: string | null | undefined): string | null {
  if (pcxStoreName?.trim()) return pcxStoreName.trim();
  return !pcxStoreId || pcxStoreId === DEFAULT_PCX_STORE_ID ? DEFAULT_PCX_STORE_LABEL : null;
}

/** Instructions for ChatGPT the household adds to the copied list (R7.5), at most this many characters. */
export const COPY_INSTRUCTIONS_MAX = 1000;

/** The PC Express lines of a list (what Copy sends). */
export function pcExpressLines(items: Readonly<Record<string, GroceryItem>>, stores: readonly StoreEntry[]): Array<[string, GroceryItem]> {
  const pcx = new Set(stores.filter((s) => s.kind === "pcExpress").map((s) => s.id));
  return Object.entries(items).filter(([, it]) => pcx.has(it.storeId));
}
