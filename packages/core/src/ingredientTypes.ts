// The named slices of an ingredient that core functions take (M21). Each module used to declare its own partial
// ingredient shape; they now build on these, so a field means the same thing everywhere. `IngredientDoc` (types.ts)
// is the full stored document and satisfies all of them.

import type { Measure, StorageLocation } from "./taxonomy";
import type { ShelfLife } from "./expiry";

/** Grams for anything with a weight or a conversion to one; a plain count only when there's no unit weight (§5). */
export type CanonicalUnit = "g" | "count";

/** An ingredient by ID and display name. */
export interface IngredientRef {
  id: string;
  name: string;
}

/** What unit conversions need (§5, R8.3). */
export interface IngredientConversion {
  allowedMeasures: readonly Measure[];
  canonicalUnit: CanonicalUnit;
  densityGPerMl?: number | undefined;
  unitWeightG?: number | undefined;
}

/** Where an ingredient lives and how long it keeps there (expiry estimates, §6). */
export interface IngredientStorage {
  canonicalUnit: CanonicalUnit;
  defaultLocation: StorageLocation;
  shelfLifeDays?: ShelfLife | undefined;
  freeUse?: boolean | undefined;
}
