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
  (one clove of garlic, one egg, one lemon). `proteinPer100g` on everything. `needsReview` is derived and must match.
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

Fallback prices when PC Express has no fresh price (TECHNICAL_SPECS §8): `estimates` maps an ingredient ID to
`{ "priceCents": number, "packAmount": number, "packMeasure": "weight" | "volume" | "count" }` in CAD.
