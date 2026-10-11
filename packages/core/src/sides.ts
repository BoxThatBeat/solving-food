// Sides (PRD R5.9, R5.10, R11.14; TECHNICAL_SPECS §4.1 `ingredients.side`, §4.2 `settings.sides`): ingredients eaten
// as they are, picked onto a meal with a per-person portion. The effective list is the global side flags (seed data
// or the ingredient editor) plus the household's own flags and portion overrides. Portions are canonical (g, or count
// for count-canonical ingredients) and are snapshotted onto the meal when it is created. Pure: no Firebase.

import { formatCanonical } from "./grocery";
import { formatGrams, formatQuantity } from "./units";
import type { Measure } from "./taxonomy";

export interface SideIngredient {
  id: string;
  name: string;
  canonicalUnit: "g" | "count";
  unitWeightG?: number | undefined;
  allowedMeasures: readonly Measure[];
  freeUse: boolean;
  side?: { portion: number } | undefined;
}

export type SideSettings = Readonly<Record<string, { portion: number }>>;

export interface EffectiveSide<T extends SideIngredient = SideIngredient> {
  ingredient: T;
  /** The portion a new meal gets: the household's override, else the ingredient's. */
  portion: number;
  /** "seed": flagged on the ingredient itself (seed data or the editor); "household": flagged only in Settings. */
  source: "seed" | "household";
  /** The ingredient's own portion when the household overrides it (for "Reset"). */
  defaultPortion?: number;
}

/** Every side a household can pick, sorted by name. Unknown household entries (deleted ingredients) are skipped. */
export function effectiveSides<T extends SideIngredient>(ingredients: Iterable<T>, settings: SideSettings | undefined): Array<EffectiveSide<T>> {
  const out: Array<EffectiveSide<T>> = [];
  for (const ing of ingredients) {
    const own = settings?.[ing.id];
    const seed = ing.side && ing.side.portion > 0 ? ing.side.portion : undefined;
    if (seed === undefined && !(own && own.portion > 0)) continue;
    if (seed !== undefined) {
      const e: EffectiveSide<T> = { ingredient: ing, portion: own && own.portion > 0 ? own.portion : seed, source: "seed" };
      if (own && own.portion > 0 && own.portion !== seed) e.defaultPortion = seed;
      out.push(e);
    } else out.push({ ingredient: ing, portion: own!.portion, source: "household" });
  }
  return out.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
}

/** Whole or half units of a g-canonical ingredient with a unit weight, else null (portion shown in grams). */
function unitsOf(portion: number, ing: Pick<SideIngredient, "canonicalUnit" | "unitWeightG" | "allowedMeasures">): number | null {
  if (ing.canonicalUnit !== "g" || !ing.unitWeightG || !ing.allowedMeasures.includes("count")) return null;
  const n = portion / ing.unitWeightG;
  const half = Math.round(n * 2) / 2;
  return half >= 0.5 && Math.abs(n - half) < 0.02 ? half : null;
}

/** A portion in metric (R8.13): "150 g", "1 (55 g)" for a bun, "2 (100 g)" for tortillas. */
export function formatPortion(portion: number, ing: Pick<SideIngredient, "canonicalUnit" | "unitWeightG" | "allowedMeasures">): string {
  if (ing.canonicalUnit === "count") return formatCanonical(portion, "count", ing.unitWeightG);
  const n = unitsOf(portion, ing);
  return n === null ? formatGrams(portion) : `${formatQuantity(n)} (${formatGrams(portion)})`;
}

/** How a portion is edited: in units ("count") when the ingredient is counted or has a unit weight, else grams. */
export function portionInputUnit(ing: Pick<SideIngredient, "canonicalUnit" | "unitWeightG" | "allowedMeasures">): "g" | "count" {
  if (ing.canonicalUnit === "count") return "count";
  return ing.unitWeightG && ing.allowedMeasures.includes("count") ? "count" : "g";
}

/** The value shown in the portion editor, in `portionInputUnit` units. */
export function portionToInput(portion: number, ing: Pick<SideIngredient, "canonicalUnit" | "unitWeightG" | "allowedMeasures">): number {
  if (portionInputUnit(ing) === "count" && ing.canonicalUnit === "g") return Math.round((portion / ing.unitWeightG!) * 100) / 100;
  return Math.round(portion * 100) / 100;
}

/** A typed portion (in `portionInputUnit` units) back to canonical. */
export function portionFromInput(value: number, ing: Pick<SideIngredient, "canonicalUnit" | "unitWeightG" | "allowedMeasures">): number {
  if (portionInputUnit(ing) === "count" && ing.canonicalUnit === "g") return Math.round(value * ing.unitWeightG! * 1000) / 1000;
  return value;
}
