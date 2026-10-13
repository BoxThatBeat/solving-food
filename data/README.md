# data

Seed data shipped with the app: ingredients (M1), the household recipes (`recipes/`, see its README), and price
estimates (M2/M5).

## `ingredients/`

475 ingredients (M1 target ≥ 250, plan 500) in one JSON file per category: `produce`, `meat`, `fish`, `dairy`,
`grains`, `pantry`, `baking`, `spices`, `condiments`, `bakery`, `frozen`, `beverages` (the `category` field equals the
file name). Each is an array of ingredient documents in the shape of `ingredientSchema` in
`packages/core/src/types.ts` (TECHNICAL_SPECS §4.1, §5), plus an `id` = `ingredientSlug(name)`:

```json
[{ "id": "potato", "name": "potato", "aliases": ["potatoes"], "category": "Produce", "defaultLocation": "pantry",
   "allowedMeasures": ["weight", "count"], "canonicalUnit": "g", "unitWeightG": 213, "proteinPer100g": 2,
   "shelfLifeDays": { "pantry": 30 }, "freezable": false, "isStaple": false, "freeUse": false, "needsReview": false }]
```

Field rules:

- `densityGPerMl` whenever `volume` is allowed; `unitWeightG` whenever `count` is allowed on a gram-canonical item
  (one clove of garlic, one egg, one lemon). `proteinPer100g` and `fibrePer100g` (M9, total dietary fibre, USDA FoodData Central) on everything. `needsReview` is derived and must match (fibre isn't a review reason: a missing value only makes recipes' fibre approximate).
- `shelfLifeDays` per storage location in days; `null` everywhere = never expires.
- `defaultPackAmount` is in grams (weight), millilitres (volume), or pieces (count), per `defaultPackMeasure`.
- `freeUse` (oils, salt, pepper, butter, sugar, condiments, water; PRD R8.14) items are staples with a
  `defaultCadenceDays` (water excepted); spices are tracked, not free-use. Every staple has a cadence.
- Names and aliases are unique after `normalizeName()` across all files (matching ignores case, punctuation, and plurals),
  and every ingredient the 28 household recipes mention resolves to exactly one entry.

Scripts (repo root):

- `pnpm ingredients:validate`: schema, completeness, uniqueness, and recipe resolution. Exit 1 on problems.
- `pnpm ingredients:upload:emulator` / `pnpm ingredients:upload` (live): idempotent upsert into `ingredients`; skips
  unchanged docs and keeps ones edited in the app (`updatedBy` set) unless `-- --force`.

Sources: USDA FoodData Central (portion weights, protein) and USDA FoodKeeper (shelf lives), curated in M1.

## `price-estimates.json`

Fallback prices when PC Express has no fresh price (TECHNICAL_SPECS §8): `estimates` maps every seeded ingredient ID to
`{ "priceCents", "packAmount", "packMeasure": "weight" | "volume" | "count", "centsPerUnit" }` in CAD (rough Ottawa
supermarket prices, 2026). `packAmount` is grams, millilitres, or pieces; the price is what that pack costs (the
ingredient's default pack where it has one). `centsPerUnit` is derived: cents per canonical unit (gram or piece) from the
seed's conversions, used by the recipe cost-per-serving filter.

The file is bundled into the web app (no upload, no reads). `pnpm prices:check` flags missing estimates, unknown IDs,
packs that can't be converted, and a stale `centsPerUnit`; `pnpm prices:check -- --write` refills `centsPerUnit`.
Run both after adding ingredients. M5 adds live PC Express prices in front of these.
