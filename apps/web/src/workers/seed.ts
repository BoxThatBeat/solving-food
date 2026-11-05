// The ingredient seed (data/ingredients/*.json), bundled into the plan worker only: categories, conversions, and pack
// sizes for every seed ingredient without reading their documents (see snapshot.ts). The virtual module is built by
// vite.config.ts (`sfSeedIngredients`) with only the fields scoring and costing read (M23: no nutrients or aliases).
import seed from "virtual:sf-seed-ingredients";
import type { SnapshotIngredient } from "./snapshot";

export const SEED_INGREDIENTS: ReadonlyMap<string, SnapshotIngredient> = new Map((seed as unknown as readonly SnapshotIngredient[]).map((i) => [i.id, i]));
