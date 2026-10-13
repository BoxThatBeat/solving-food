# M10 — Owner review 3

Status: in progress

## Goal

Five change requests from the owner's third review (2026-10-13), turned into ordered tasks. The owner's words are
quoted under each item; decisions taken without the owner (the run was unattended) are recorded under "Decisions".

## Requirements covered

R4.17 (changed: the skill splits long steps), R4.10 (changed: a "more text" arrow in step mode), R4.29 (new: a recipe
thumbnail wherever a recipe name is listed), R7.12 (new: staples on the grocery list), R7.7 (changed: the cadence adds
staples instead of asking), R8.14 (changed), R6.4 (changed wording), R4.30 (new: nutrition facts panel), R6.27 (changed
wording: the panel isn't tracking).

## Items (in build order)

### 1. The skill splits long steps (item 1, R4.17)
> "should add to the skill: if a recipe has many sentences in a single step, break it up if logical"
- [x] `references/conventions.md` → Body: a source step with several sentences that are separate actions becomes
      several steps (one paragraph each), in the original order and wording; one action is never split, and sentences
      that only qualify an action ("Season with salt.", "It should be golden.") stay with it. Timers stay with their
      action. A before/after example.
- [x] SKILL.md step 4 and the final checklist point at the rule. `pnpm gen:skill -- --check` (the generated files are
      taxonomy.md and ingredients.md; conventions.md and SKILL.md are hand-written).

### 2. Step mode: an arrow says there's more text (item 2, R4.10)
> "Need to have an arrow indicating there is more text in a step"
- [x] The step text scroll area (M9) shows a downward chevron pinned to its bottom edge (on a fade of the card colour)
      while the text overflows and isn't scrolled to the end; it disappears at the end and comes back when scrolled up.
      It is decoration (`aria-hidden`); the scroll region is already focusable and labelled. Tapping it scrolls down
      a screenful (a convenience, not the only way).
- [x] e2e `cooking.spec.ts` @R4.10: a long step at 360×640 shows the arrow; scrolled to the end it's gone; a short step
      never shows it.

### 3. A recipe image next to every recipe name (item 3, R4.29)
> "show image of recipe in the plan cards and when creating a meal. Recipe names should always have an image
> associated with it. It should be the same small image the suggested recipes on plan page have"
- [ ] One `<RecipeThumb>` (the Suggested card's 4 rem framed image, cuisine stripes when there's no photo), used by
      Suggested and everywhere a recipe name is a row: Plan cards (single and multi-recipe rows), Create meal (picker
      rows and the chosen recipes), saved meals (Meals page cards), History rows, Use it up and expiry-alert proposals,
      the optimiser's set, pending reviews, duplicate review, the cook order list.
- [ ] Phone (360 px) and 4K checked; visual baselines updated (Chromium projects).
- [ ] e2e `plan.spec.ts` @R4.29 (plan card and Create meal show the thumbnail; a recipe without a photo shows the
      placeholder).

### 4. Staples appear on the grocery list (item 4, R7.12, R7.7, R8.14, R6.4)
> "ingredients marked as staple should auto appear in grocery list if it doesn't already"
- [ ] Core `stapleLines()` (grocery.ts): the household's staples that are due and not on any list become `staple_<id>`
      lines (source `staple`, one default pack, priced, store-resolved). Due = the cadence's rule (85 % of the
      interval since the last purchase, R7.7), or a free-use ingredient a planned meal uses that the household has
      never bought. Not added when already on the draft (any line for that ingredient), on an ordered list, or removed
      from the list this period. Not in the budget (R6.4).
- [ ] Grocery page: staple lines in their store card under a "Staples" divider, each removable (×) and tickable;
      removing one records it in the draft's `dismissedStaples` (cleared when the period changes) so it isn't re-added.
      Rules allow `dismissedStaples`.
- [ ] The "Are you out of milk?" prompt is retired (Grocery and Plan pages): the staple line replaces it.
- [ ] PRD R7.7, R7.12, R8.14, R6.4; spec §5 free-use, §8 builder and cadence; unit tests; rules test; e2e
      `cadence.spec.ts` @R7.7 @R7.12 rewritten, `grocery.spec.ts` free-use check updated.

### 5. Nutrition facts on every recipe (item 5, R4.30, R6.27)
> "In every recipe including ones already added, add a nutrition facts drop down that is closed by default. nutrition
> pulled from a database (e.g. USDA FoodData Central) preferably Canadian."
- [x] Data: `data/nutrition-sources.json` maps every seed ingredient to a Canadian Nutrient File food code (or a
      noted reference); `pnpm nutrition:write` (`data/scripts/nutrition.ts`) fetches CNF per-100 g values (cached in
      `data/.cnf-cache/`, gitignored) and writes `nutrients` + `nutrientSource` into `data/ingredients/*.json`;
      `ingredients:validate` requires them. `data/README.md`.
- [x] Core: `NUTRITION_KEYS`, ingredient `nutrients` (per 100 g: kcal, fat, saturated, trans, carbohydrate, sugars,
      sodium, cholesterol, potassium, calcium, iron) and recipe `nutrition` (per serving) + `nutritionApproximate`
      (the keys an ingredient lacked), derived in `deriveRecipe()` by the generalised `nutrientPerServing()`;
      `nutritionFacts()` (Canadian label rounding and % daily values). Unit tests.
- [x] Functions: derived keys, `conversionChanged` includes `nutrients`, so `pnpm ingredients:upload` recomputes every
      recipe; merge copies nutrients. Rules allow the new fields. Functions/rules tests.
- [x] Web: a "Nutrition facts" disclosure on the recipe page and the share page, closed by default, Canadian-label
      look; "~" and a note when approximate. Ingredient editor and new-ingredient form get optional fields.
- [x] PRD non-goals line, R4.30, R6.27; spec §4.1, §5, §2 quota note. e2e `recipe-detail.spec.ts` @R4.30 (and the
      share page).

## Decisions

## Verification

## Owner checks
