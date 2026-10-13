// "Merge into…" (Planning/M8 item 2, PRD R4.27, R8.16, TECHNICAL_SPECS §6 "Merging ingredients"): the pure parts of
// moving everything that names a duplicate ingredient onto the ingredient it means. The `mergeIngredient` function
// does the reads and writes; this module decides what changes, so it is unit-tested without Firestore.

import { EPS, type LedgerLot, type LedgerTx } from "./ledger";
import { normalizeName } from "./names";
import { needsReview } from "./ingredient";
import type { GroceryItem, IngredientDoc, MealSide } from "./types";

/** What `mergeIngredient` moved (or, for a dry run, would move): the confirm dialog's counts. */
export interface MergeReport {
  fromId: string;
  intoId: string;
  fromName: string;
  intoName: string;
  dryRun: boolean;
  /** The duplicate was already merged into this target (a re-run). */
  alreadyMerged: boolean;
  recipes: number;
  versions: number;
  meals: number;
  households: number;
  /** Households whose Supply had a row for the duplicate. */
  supplyRows: number;
  planItems: number;
  groceryLists: number;
  householdDocs: number;
  aliasesAdded: string[];
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The factor that turns the duplicate's canonical amounts into the target's: 1 for the same unit, the unit weight
 * between grams and counts, null when they can't be converted (the merge is refused).
 */
export function mergeFactor(
  from: Pick<IngredientDoc, "canonicalUnit" | "unitWeightG">,
  into: Pick<IngredientDoc, "canonicalUnit" | "unitWeightG">,
): number | null {
  if (from.canonicalUnit === into.canonicalUnit) return 1;
  const w = into.unitWeightG ?? from.unitWeightG;
  if (!w) return null;
  return from.canonicalUnit === "g" ? 1 / w : w; // g → count: ÷ weight per piece; count → g: × it
}

export interface MovedLots {
  /** The target's lots after the move. */
  lots: LedgerLot[];
  /** Source lot ID → the ID it has on the target (renamed only when the target already had it). */
  renamed: Map<string, string>;
  /** Σ moved, in the target's unit. */
  moved: number;
  /** The source's transactions: one `merge` (−) per lot it gave up. */
  sourceTxs: LedgerTx[];
}

/** Appends every lot of the duplicate's supply to the target's (amounts × factor). */
export function moveLots(target: readonly LedgerLot[], source: readonly LedgerLot[], factor: number, note: string): MovedLots {
  const lots = target.map((l) => ({ ...l }));
  const taken = new Set(lots.map((l) => l.lotId));
  const renamed = new Map<string, string>();
  const sourceTxs: LedgerTx[] = [];
  let moved = 0;
  for (const l of source) {
    if (l.amount <= EPS) continue;
    let id = l.lotId;
    for (let n = 1; taken.has(id); n++) id = `${l.lotId}-m${n}`;
    taken.add(id);
    if (id !== l.lotId) renamed.set(l.lotId, id);
    const amount = round(l.amount * factor);
    lots.push({ ...l, lotId: id, amount });
    moved = round(moved + amount);
    sourceTxs.push({ delta: -round(l.amount), kind: "merge", lotId: l.lotId, note });
  }
  return { lots, renamed, moved, sourceTxs };
}

/**
 * The target's side of the history: the duplicate's transactions copied (deltas × factor, lot IDs renamed), plus one
 * `merge` transaction for whatever the copies don't explain (0 when the duplicate's ledger was consistent), so
 * Σ transactions == canonicalAmount still holds on the target.
 */
export function copiedHistory<T extends { delta: number; lotId: string }>(
  sourceTxs: readonly T[],
  moved: number,
  factor: number,
  renamed: ReadonlyMap<string, string>,
): { copies: T[]; balance: number } {
  const copies = sourceTxs.map((t) => ({ ...t, delta: round(t.delta * factor), lotId: renamed.get(t.lotId) ?? t.lotId }));
  const sum = copies.reduce((s, t) => s + t.delta, 0);
  return { copies, balance: round(moved - sum) };
}

/** Recipe lines, meal sides and the like: every `ingredientId` that names the duplicate now names the target. */
export function repointLines<T extends { ingredientId: string }>(lines: readonly T[], fromId: string, intoId: string): { lines: T[]; changed: boolean } {
  let changed = false;
  const out = lines.map((l) => {
    if (l.ingredientId !== fromId) return l;
    changed = true;
    return { ...l, ingredientId: intoId };
  });
  return { lines: out, changed };
}

/** Sides on a meal: repointed; a side that is now listed twice keeps the first entry. */
export function repointSides(sides: readonly MealSide[], fromId: string, intoId: string): { sides: MealSide[]; changed: boolean } {
  const r = repointLines(sides, fromId, intoId);
  if (!r.changed) return { sides: [...sides], changed: false };
  const seen = new Set<string>();
  return { sides: r.lines.filter((s) => (seen.has(s.ingredientId) ? false : (seen.add(s.ingredientId), true))), changed: true };
}

export function uniqueIds(ids: readonly string[], fromId: string, intoId: string): string[] {
  return [...new Set(ids.map((i) => (i === fromId ? intoId : i)))];
}

/**
 * A draft or ordered grocery list: the duplicate's plan line (keyed by its ingredient ID) joins the target's line at
 * the same store (amounts, packs and estimate added), or takes the target's key; manual lines just change ingredient.
 * Returns the whole new items map, or null when nothing names the duplicate.
 */
export function mergeGroceryItems(items: Readonly<Record<string, GroceryItem>>, fromId: string, intoId: string, factor: number): Record<string, GroceryItem> | null {
  let changed = false;
  const out: Record<string, GroceryItem> = { ...items };
  for (const [key, it] of Object.entries(items)) {
    if (it.ingredientId !== fromId) continue;
    changed = true;
    const scaled: GroceryItem = {
      ...it,
      ingredientId: intoId,
      amount: round(it.amount * factor),
      ...(it.need !== undefined ? { need: round(it.need * factor) } : {}),
      ...(it.packAmount ? { packAmount: round(it.packAmount * factor) } : {}),
    };
    delete out[key];
    const targetKey = key === fromId ? intoId : key;
    const there = out[targetKey];
    if (there && there.ingredientId === intoId && there.storeId === it.storeId) {
      out[targetKey] = {
        ...there,
        amount: round(there.amount + scaled.amount),
        ...(there.need !== undefined || scaled.need !== undefined ? { need: round((there.need ?? 0) + (scaled.need ?? 0)) } : {}),
        packs: there.packs + scaled.packs,
        estPriceCents: there.estPriceCents === null || scaled.estPriceCents === null ? there.estPriceCents ?? scaled.estPriceCents : there.estPriceCents + scaled.estPriceCents,
        checked: there.checked && scaled.checked,
      };
    } else if (there) {
      out[`${targetKey}_m`] = scaled; // a different store or a manual line already under that key
    } else {
      out[targetKey] = scaled;
    }
  }
  return changed ? out : null;
}

const MAX_ALIASES = 40; // the ingredients rule (firestore.rules validIngredient)

/**
 * The target after the merge: the duplicate's name and aliases become aliases (alias learning: the next import
 * matches them), capped at 40, and any conversion or protein the target lacks is taken from the duplicate.
 */
export function mergedTarget(into: IngredientDoc, from: IngredientDoc): { doc: IngredientDoc; aliasesAdded: string[] } {
  const have = new Set([into.name, ...into.aliases].map(normalizeName));
  const aliases = [...into.aliases];
  const aliasesAdded: string[] = [];
  for (const n of [from.name, ...from.aliases]) {
    const k = normalizeName(n);
    if (!k || have.has(k) || aliases.length >= MAX_ALIASES) continue;
    have.add(k);
    aliases.push(n.trim().toLowerCase());
    aliasesAdded.push(n.trim().toLowerCase());
  }
  const doc: IngredientDoc = { ...into, aliases };
  if (doc.densityGPerMl === undefined && from.densityGPerMl !== undefined && doc.allowedMeasures.includes("volume")) doc.densityGPerMl = from.densityGPerMl;
  if (doc.unitWeightG === undefined && from.unitWeightG !== undefined && doc.allowedMeasures.includes("count")) doc.unitWeightG = from.unitWeightG;
  if (doc.proteinPer100g === undefined && from.proteinPer100g !== undefined) doc.proteinPer100g = from.proteinPer100g;
  if (doc.fibrePer100g === undefined && from.fibrePer100g !== undefined) doc.fibrePer100g = from.fibrePer100g;
  doc.needsReview = needsReview(doc);
  return { doc, aliasesAdded };
}

/** Why a merge isn't allowed, or null. A catalogue (seed) ingredient is never merged into one that isn't. */
export function mergeRefusal(
  fromId: string,
  from: (IngredientDoc & { id?: string }) | undefined,
  intoId: string,
  into: (IngredientDoc & { id?: string }) | undefined,
): string | null {
  if (!fromId || !intoId) return "Pick two ingredients";
  if (fromId === intoId) return "An ingredient can't be merged into itself";
  if (!from) return `No ingredient ${fromId}`;
  if (!into) return `No ingredient ${intoId}`;
  if (into.mergedInto) return `${into.name} was merged into another ingredient; merge into that one`;
  if (from.mergedInto && from.mergedInto !== intoId) return `${from.name} is already merged into another ingredient`;
  if (!from.createdBy && into.createdBy) return `${from.name} is in the shipped catalogue; merge ${into.name} into it instead`;
  if (mergeFactor(from, into) === null) return `${from.name} is counted and ${into.name} is weighed; give one of them a weight per piece first`;
  return null;
}
