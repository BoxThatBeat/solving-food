# data

Seed data shipped with the app: ingredients (M1), the household recipes (`recipes/`, see its README), and price
estimates (M2/M5).

## `ingredients/`

480 ingredients (M1 target ≥ 250, plan 500) in one JSON file per category: `produce`, `meat`, `fish`, `dairy`,
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

### Nutrition facts (M10, PRD R4.30)

Every ingredient also has `nutrients` (per 100 g: `kcal`, `fatG`, `satFatG`, `transFatG`, `carbG`, `sugarsG`,
`sodiumMg`, `cholesterolMg`, `potassiumMg`, `calciumMg`, `ironMg`; the first six are required by the validator, the rest
when the source has them) and `nutrientSource`. They come from **Health Canada's Canadian Nutrient File** (CNF, the
public API at `https://food-nutrition.canada.ca/api/canadian-nutrient-file/`, no key) through
`nutrition-sources.json`, which names the CNF food code chosen for each ingredient (453 of 480; raw for meat, fish and
produce, dry for pasta, rice and legumes, as sold for the rest), or, where CNF has nothing fitting (27: blends,
plant milks, some prepared and frozen foods, water), reference values with their source (USDA FoodData Central or a
label estimate). A `fill` entry supplies a value the CNF food lacks (sugars for 32 foods, saturated fat for 3), with
`fillSource`. Protein and fibre keep their own fields (`proteinPer100g`, `fibrePer100g`, from M1/M9) and are not
replaced.

- `pnpm nutrition:write`: fetches each CNF food's nutrient amounts (cached in `data/.cnf-cache/`, gitignored;
  `-- --refresh` refetches), writes `nutrients` + `nutrientSource` into `ingredients/*.json` and runs prettier.
  Re-run after changing `nutrition-sources.json` or adding an ingredient (add its entry first), then
  `pnpm ingredients:validate`.
- `pnpm nutrition:write -- --check`: exits 1 when the JSON doesn't match the sources (offline: needs the cache).

Judgement calls worth knowing: `milk` is 2 %, `greek-yogurt` fat-free, tea is brewed (CNF has no dry leaves), ground
coffee and coffee beans are an estimate for dry grounds (they overstate a brewed drink), several pasta shapes share
the dry spaghetti or macaroni entry, and the salted spice blends (Cajun, Montreal steak spice, everything bagel) are
label estimates.

## `price-estimates.json`

Fallback prices when PC Express has no fresh price (TECHNICAL_SPECS §8): `estimates` maps every seeded ingredient ID to
`{ "priceCents", "packAmount", "packMeasure": "weight" | "volume" | "count", "centsPerUnit" }` in CAD (rough Ottawa
supermarket prices, 2026). `packAmount` is grams, millilitres, or pieces; the price is what that pack costs (the
ingredient's default pack where it has one). `centsPerUnit` is derived: cents per canonical unit (gram or piece) from the
seed's conversions, used by the recipe cost-per-serving filter.

The file is bundled into the web app (no upload, no reads). `pnpm prices:check` flags missing estimates, unknown IDs,
packs that can't be converted, and a stale `centsPerUnit`; `pnpm prices:check -- --write` refills `centsPerUnit`.
Run both after adding ingredients. M5 adds live PC Express prices in front of these.
