// The ingredient seed (data/ingredients/*.json), bundled into the scoring and optimiser workers only: categories,
// conversions, and pack sizes for every seed ingredient without reading their documents (see snapshot.ts).
import type { SnapshotIngredient } from "./snapshot";

const files = import.meta.glob<SnapshotIngredient[]>("../../../../data/ingredients/*.json", { eager: true, import: "default" });

export const SEED_INGREDIENTS: ReadonlyMap<string, SnapshotIngredient> = new Map(
  Object.values(files)
    .flat()
    .map((i) => {
      const { aliases: _a, ...rest } = i as SnapshotIngredient & { aliases?: unknown };
      void _a;
      return [(rest as SnapshotIngredient).id, rest as SnapshotIngredient];
    }),
);
