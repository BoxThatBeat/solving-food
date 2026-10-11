# M6 — Sides

Status: in progress

## Goal

Meals often come with things that need no recipe: frozen fries, frozen vegetables, corn chips, rice, buns. A
**side** is an ingredient eaten as it is. While creating a meal the user picks sides from a search dropdown;
each side has a per-person portion, so a meal for N servings needs N portions. Sides land on the grocery list
(rounded to packs), count in the budget, and are tracked in Supply: Done cooking deducts them and the review
corrects them. Settings → Sides lists the shipped seed sides plus any ingredient the household flags, with a
portion override that applies to meals created afterwards.

## Requirements covered

R5.9, R5.10, R7.11, R11.14.

## Decisions

- Portion is stored in **canonical units** (`g`, or `count` for count-canonical ingredients) and **resolved when
  the meal is created**: plan items and saved meals carry `sides: [{ ingredientId, portion }]`, so the builder,
  functions, export and History never read Settings. Changing a portion only affects meals created afterwards.
- Effective side list = ingredients with `side` (global: seed data or the ingredient editor) ∪
  `household.settings.sides` (household flag and/or portion override). Effective portion =
  `settings.sides[id]?.portion ?? ingredient.side?.portion`.
- Free-use sides are not tracked (R8.14): `needsFor` skips them like recipe lines, the seed validator forbids
  `side` on a `freeUse` ingredient, Settings → Sides warns when flagging one. Pickles (`dill-pickle`, free-use)
  are not seed sides.
- A meal still needs ≥ 1 recipe. Leftover plan items never carry sides (rules enforce it).
- Suggestions and the optimiser rank recipes only; sides only feed the planned needs they price against.

## Work breakdown

### 0. Docs
- [x] PRD R5.9, R5.10, R7.11, R11.14; R6.1 and R10.1 wording.
- [ ] Spec §4.1, §4.2, §6, §7, §8, §10, §12, §14.1; §15 M6 row (done); `Planning/README.md` row (done).

### 1. Data model
- [x] `types.ts`: `ingredient.side`, `mealSideSchema`, `MEAL_SIDES_MAX = 12`, `meal.sides`, `planItem.sides`,
      `settings.sides`, `cookEvent.sides`. `commands.ts`: `finishCooking.sides`.
- [x] `export.ts` `exportMealSchema.sides`; `importHousehold` `resolveMeals` copies sides.
- [x] `firestore.rules`: `validIngredient` side, `validMeal` sides, `validPlanItem` sides (meal only), finishCooking
      payload key.
- [x] Seed validator: a side needs `portion > 0`, a default pack, and can't be free-use.
- [x] Web: `OPTIONAL_INGREDIENT_KEYS` + `side`; `data/sides.ts` (`useSides`, `saveSides`).

### 2. Core math
- [x] `grocery.ts`: `SideRef`, `PlanItemInput.sides`, `needsFor` adds portion × servings (free-use skipped).
- [x] `cooking.ts`: `mealRequirements(..., sides)`.
- [x] `plan.ts`: `createMealInputSchema.sides`, `buildPlanItem` copies them, `planItemTitle` with sides,
      `sidesLine`, `defaultMealName(titles, sideNames)`; `carryOver` keeps sides; `proteinSummary` ignores them.
- [x] `meal.ts`: `newMeal(..., sides)`, `combineSummaries` searchable side names, rows pass sides.
- [x] Unit tests: grocery (scale, packs, free-use, supply/incoming, addedCost, property), plan, cooking, meal,
      export, types.
- [x] `sides.ts` (added): `effectiveSides`, `formatPortion` ("1 (55 g)"), portion input in units or grams.

### 3. Functions
- [x] `finishCooking` deducts sides (payload or plan item), stores `sides` on the cook event; `markEaten` snack path.
- [x] Functions tests: 4 × 150 g fries deducted from a 2 kg lot, review correction puts 100 g back, snack eaten.

### 4. Seed data
- [x] Flag existing seed ingredients as sides; add frozen fries, sweet potato fries, tater tots, onion rings,
      garlic bread, salad kit with price estimates. Validate, prices check.

### 5. UI
- [x] `<SidePicker>`.
- [x] Create meal: Sides section, saved meal copies sides, budget impact, auto name, submit.
- [x] `data/plan.ts` + `planModel.ts`: sides through create/update/save, side ingredients loaded, `ready` gating.
- [x] Plan row sub-line, plan item sheet Sides editor, save as meal keeps sides.
- [x] Settings → Sides page and link.
- [x] Meals: detail page shows/edits sides; list rows "with …".
- [x] History rows list sides.
- [x] Cooking: finish sends sides; review pre-fills them.
- [ ] Design-compare Plan, Create meal, Settings → Sides (phone 430×932, desktop 1920×1080).

### 6. Tests
- [x] Rules tests.
- [ ] e2e: plan @R5.9, grocery @R7.11 @R5.10, meals @R5.9, cooking @R5.10, settings @R11.14, history.
- [ ] `pnpm e2e:coverage`.

### 7. Ship
- [ ] Deploy (rules + functions + hosting), upload ingredient seed live (no `--force`), healthcheck.

## Exit criteria

1. On the phone, Create meal → pick a recipe → Sides: type "fries", pick "frozen french fries" → Add to plan. The
   plan row reads "… + frozen french fries" (or the meal name with a "WITH …" line), and the budget meter rises.
2. Grocery shows a frozen french fries line of 1 × 1 kg for a 4-serving meal.
3. Receiving it adds 1 kg to Supply; Done cooking takes 600 g; the review lists fries and can correct the amount.
4. Settings → Sides shows the seed sides; changing fries to 200 g makes the next meal use 200 g per person, and
   the existing one keeps 150 g. Flagging another ingredient makes it pickable.
5. A saved meal with sides re-planned from Saved meals keeps them. History shows the sides.

## Edge cases

- Count vs g portions: a bun is a count-canonical or g-canonical item; g-canonical items with a unit weight store
  count × unit weight; displays use `formatCanonical` ("150 g", "1 (55 g)").
- A side that is also a recipe ingredient in the same meal is summed (expected).
- Rollover, undo, and restore copy whole plan item docs, so sides survive. Old clients patching `servings` leave
  `sides` intact (field-level update).
- `planModel.ready` waits for side ingredients, otherwise `lineFor` would skip them and the meter would read low.
- The seed upload skips ingredients edited in the app; a household flags those via Settings → Sides instead.

## Deviations and decisions

## What's left for the owner
