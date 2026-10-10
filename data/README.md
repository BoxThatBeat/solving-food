# data

Seed data shipped with the app. Filled in by M1 (ingredients) and M2/M5 (price estimates).

## `ingredients/`

One JSON file per category (e.g. `produce.json`), each an array of ingredient documents in the shape of
`ingredientSchema` in `packages/core/src/types.ts` (TECHNICAL_SPECS §4.1, §5), plus an `id` (slug) per entry:

```json
[{ "id": "potato", "name": "potato", "aliases": ["potatoes"], "category": "Produce", "defaultLocation": "pantry",
   "allowedMeasures": ["weight", "count"], "canonicalUnit": "g", "unitWeightG": 213, "proteinPer100g": 2,
   "shelfLifeDays": { "pantry": 30 }, "freezable": false, "isStaple": false, "freeUse": false, "needsReview": false }]
```

Sources: USDA FoodData Central (portion weights, protein) and USDA FoodKeeper (shelf lives). A validator and an upload
script arrive with M1.

## `price-estimates.json`

Fallback prices when PC Express has no fresh price (TECHNICAL_SPECS §8): `estimates` maps an ingredient ID to
`{ "priceCents": number, "packAmount": number, "packMeasure": "weight" | "volume" | "count" }` in CAD.
