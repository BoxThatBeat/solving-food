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
- [x] Spec §4.1, §4.2, §6, §7, §8, §10, §12, §14.1; §15 M6 row (done); `Planning/README.md` row (done).

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
- [x] Design-compare Plan, Create meal, Settings → Sides (phone 430×932, desktop 1920×1080).

### 6. Tests
- [x] Rules tests.
- [x] e2e: `sides.spec.ts` (one file instead of six, see Deviations): @R5.9 @R5.10 @R7.11 @R11.14 @R10.1.
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

## Deviations and decisions (2026-10-11)

- **Seed sides.** 30 existing ingredients flagged (french-fry already existed as "french fries" with the alias
  "fries", so no `frozen-french-fry` was added; `hash-brown` 100 g was flagged too), 5 added: sweet potato fries
  150 g / 567 g pack, tater tots 120 g / 907 g, onion rings 80 g / 400 g, garlic bread 75 g / 350 g, salad kit
  100 g / 300 g, each with a price estimate. "corn chips" became an alias of tortilla chips. Every seed ingredient
  is g-canonical, so bread portions are unit weight × count: hamburger bun 55, hot dog bun 45, dinner roll 35,
  pita 60, naan 90, flour tortilla 100 (2), corn tortilla 78 (3), sourdough 80 and multigrain 70 (2 slices).
- **Core `sides.ts`** (not in the design): `effectiveSides`, `formatPortion` ("1 (55 g)" for a g-canonical item with a
  unit weight, which the design's `formatCanonical` alone can't show), and portion input in pieces or grams.
- **Titles.** An unnamed meal's title lists its sides ("Salmon + french fries"); a named meal (or one whose name
  doesn't mention them) gets a "WITH …" line instead, so the sides are never shown twice. The cook view's title and
  the cook event's title stay recipe-only; History adds the "WITH …" line from `cookEvent.sides`.
- **Free-use** ingredients are refused (not just warned) in Settings → Sides and the ingredient editor: a free-use
  side would never reach the list or Supply, which reads as a bug.
- **Ingredient editor** gained a "Side" card (portion per person, blank = not a side), because `side` is now an
  optional key an edit would otherwise clear.
- **Tests** live in one `sides.spec.ts` rather than spread over six specs: the flows cross pages and share fixtures.
- **Rules** check the `sides` list length (≤ 12) and kind (meal only), not each entry's shape (the client's zod schema
  and the function's `sidesOf` filter do); Firestore rules can't loop over a list.
- `useSides()` reads the session without requiring it, so the signed-out shared meal page still renders.
- The picker closes after a pick (the open list covered the controls below it on phones).

## Verification (2026-10-11, local, Emulator Suite)

- Core unit: 25 files, 340 tests pass (grocery property test with sides, plan, cooking, meal, export, types, sides).
- Rules: 7 files, 96 tests pass. Functions: 9 files, 54 tests pass (sides deducted 4 × 150 g, review puts 100 g
  back, command sides win, snack eaten deducts).
- e2e `sides.spec.ts`: 6/6 on desktop-1080p and 6/6 on phone-ios. Regression: plan, grocery, meals, review, settings,
  history, cooking, data-transfer, a11y on desktop-1080p (49 + 27 pass after the signed-out meal page fix; one
  sign-in fixture flake re-passed); plan, grocery, meals, review, settings, history on phone-ios 38/38.
- `pnpm e2e:coverage`: M6 4/4 tagged. Lint and typecheck clean.

## Design-compare notes (phone 430×932, desktop 1920×1080, Latte)

The prototype has no sides, so the new parts reuse its language: the Sides section in Create meal uses the mono
section label with a right-hand hint, accent chips with the ✕ square (as the selected recipes), and the same
dropdown as the ingredient picker (accent active row, mono right-hand detail). Plan rows add one mono uppercase
"WITH …" line under the title, like the recipe meta line. Settings → Sides copies the Brands page: card with ink
header bar, rows with a mono amount, a grey badge, and a secondary Change button; the flag form is a second card
(first on phones so it isn't below 35 rows). Fixed during the pass: the picker used `type="search"`, whose native
blue clear button doesn't match the prototype's inputs.

## What's left for the owner

- Try the exit criteria on the phone (above).
- Ingredients you edited in the app keep your edit: the seed upload skips them, so if one of the seed sides was edited
  in the app it isn't flagged; flag it in Settings → Sides instead (the upload report lists how many were skipped).
