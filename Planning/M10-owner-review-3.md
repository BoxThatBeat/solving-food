# M10 — Owner review 3

Status: done (owner checks below; deploy and `pnpm ingredients:upload` are the owner's)

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
- [x] One `<RecipeThumb>` (the Suggested card's 4 rem framed image, cuisine stripes when there's no photo), used by
      Suggested and everywhere a recipe name is a row: Plan cards (single and multi-recipe rows), Create meal (picker
      rows and the chosen recipes), saved meals (Meals page cards), History rows, Use it up and expiry-alert proposals,
      the optimiser's set, pending reviews, duplicate review, the cook order list, a saved meal's page (its recipe rows and
      the add-a-recipe search). The Meals page cards already had a two-image header (kept).
- [x] Phone (360–412 px) and 4K checked; visual baselines: none changed (the two baselined pages, sign-in and the
      Recipes library, show no recipe rows), confirmed with `--update-snapshots=changed` on the four Chromium projects.
- [x] e2e `plan.spec.ts` @R4.29 (plan card and Create meal show the thumbnail; a recipe without a photo shows the
      placeholder).

### 4. Staples appear on the grocery list (item 4, R7.12, R7.7, R8.14, R6.4)
> "ingredients marked as staple should auto appear in grocery list if it doesn't already"
- [x] Core `stapleLines()` (grocery.ts): the household's staples that are due and not on any list become `staple_<id>`
      lines (source `staple`, one default pack, priced, store-resolved). Due = the cadence's rule (85 % of the
      interval since the last purchase, R7.7), or a free-use ingredient a planned meal uses that the household has
      never bought. Not added when already on the draft (any line for that ingredient), on an ordered list, or removed
      from the list until later (its usual interval, at least to the period's end). Not in the budget (R6.4).
- [x] Grocery page: staple lines in their store card under a "Staples" divider, each removable (×) and tickable;
      removing one records it in the draft's `dismissedStaples` (ingredient → until) so it isn't re-added.
      Rules allow `dismissedStaples`.
- [x] The "Are you out of milk?" prompt is retired (Grocery and Plan pages): the staple line replaces it.
- [x] PRD R7.7, R7.12, R8.14, R6.4; spec §5 free-use, §8 builder and cadence; unit tests; rules test; e2e
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

- **Skill (item 1):** the rule lives in `references/conventions.md` (hand-written, not generated, so `pnpm gen:skill` has
  nothing to regenerate) with a before/after example; a single action is never split, qualifying sentences and timers
  stay with their action, and separate source steps are never merged. The example is a plain code block (not
  `cooklang`), so the skill test that imports every `cooklang` example doesn't need a full file for it.
- **More-text arrow (item 2):** a chevron in a dark circle on a fade of the card colour, pinned to the bottom of the
  step text area, `aria-hidden` (the area itself is focusable and labelled "Step text"). It shows while more than 4 px
  remain below and is re-measured on scroll, resize and step change; tapping it scrolls 80 % of the area. No animation
  (nothing for reduced-motion users to switch off).
- **Thumbnails (item 3):** one `<RecipeThumb>` (the Suggested card's 4 rem framed image; `sizes="4rem"` so the 480 px
  WebP) and `<MealThumb>` (first recipe + "+N") for rows naming a meal of several recipes (Create meal's saved meals
  and confirm step, History, pending reviews). A single-recipe plan card puts it beside the title; a multi-recipe card
  puts one on each recipe row. Eating-out cards have no recipe, so no image. The Meals page cards already had a large
  two-image header and keep it. Without a photo, the cuisine stripes (the Suggested and recipe-card placeholder); a
  decorative placeholder is now `aria-hidden` instead of an image named " (no photo)".
- **Staples (item 4):** "auto appear" is read as "appear when the household probably needs them", not "every staple
  every time": the seed has 113 staples and free-use ingredients, and listing them all on every order would bury the
  list and send them all to ChatGPT. A staple line is added when the cadence says it's due (the R7.7 rule), when a
  planned meal uses a free-use staple with an amount ("to taste" salt doesn't count) that the household has never
  bought, or when a tracked staple it has bought has run out in Supply. The "Are you out of milk?" prompt is
  **retired**: it asked about exactly the lines that now appear by themselves; removing the line is the "not yet",
  and it keeps the staple off for its usual interval and at least until the period ends (stored on the draft as
  `dismissedStaples`, so no new command or function). Old `cadence_` lines and snoozes are still honoured. Staple
  lines are generated like plan lines (ticks kept), priced, grouped by store under a "Staples" divider, copied for
  ChatGPT, and excluded from the budget (R6.4).
- **Nutrition data (item 5):** Health Canada's Canadian Nutrient File, through its public API, for 453 of 480
  ingredients (food codes in `data/nutrition-sources.json`, chosen per ingredient by four parallel mapping passes and
  spot-checked against the existing protein/fibre values); 27 reference entries where CNF has nothing fitting (blends,
  plant milks, some prepared and frozen foods, water: USDA FoodData Central or label estimates, noted per ingredient);
  CNF gaps (sugars for 32 foods, saturated fat for 3) filled from USDA SR Legacy or estimates, noted in
  `nutrientSource`. Protein and fibre keep their M1/M9 fields and values (changing them would move every protein
  figure and goal); the panel shows them from those fields. Ground coffee and coffee beans are dry-grounds estimates
  (they overstate a brewed drink).
- **Nutrition model (item 5):** `nutrients` per 100 g on ingredients and `nutrition` per serving on recipes, keyed
  `kcal … ironMg`; `nutritionApproximate` lists the keys an ingredient lacked, so each value gets its own "~". The
  recipe index summary is unchanged (cards don't show the panel), so `recipeIndex` chunks don't grow. In-app-edited
  ingredients keep their edits on `pnpm ingredients:upload` but get the seed's nutrients when they have none, so every
  existing recipe gets its panel.
- **Panel and the switch (item 5):** the panel is a fact sheet, not tracking, so the "Track protein and fibre" switch
  doesn't hide it (R6.27 says so); it shows on the signed-out share page too. Native `<details>` (closed by default,
  keyboard and screen reader for free) styled as a brutalist card with a Canadian Nutrition Facts table: Health Canada
  rounding and % daily values (none for carbohydrate, protein and cholesterol, as on Canadian labels).

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: core 608/608 (+ M10: nutrition per serving and the Canadian
  label rows, staple lines), web 11/11. `pnpm test:rules` 98/98 (+ nutrients on ingredients and recipes, dismissed
  staples). `pnpm test:functions` 61/61 (+ an ingredient's new nutrients recompute a recipe's nutrition without a
  version bump). `pnpm ingredients:validate` (480, all with nutrients and a source), `pnpm nutrition:write -- --check`
  up to date, `pnpm gen:skill -- --check` up to date, `pnpm prices:check` complete. `pnpm e2e:coverage`: every
  milestone ok; M10 9/9 tagged.
- Playwright, `--workers=1`, one project and a few specs per emulator session:
  - desktop-1080p: recipe-detail, sharing, ingredients 9/9; plan, suggestions, history, meals, optimiser, review 39/39;
    cadence, grocery, receive, core-loop, prices, sides, suggestions 25/26, the one failure being grocery's Copy text,
    which now (correctly) includes the olive-oil staple line: expectation updated, re-run 1/1; then every `@smoke` test
    plus everything tagged R4.10/R4.29/R4.30/R7.12: 26 passed, 1 skipped (a project-specific skip).
  - phone-android: cooking, plan, cadence, grocery, recipe-detail, a11y, responsive: 55 passed, 1 skipped (the
    tablet-rail test, tablet only). The axe checks pass with the arrow, thumbnails and the panel.
  - phone-ios: cooking, plan, cadence, grocery, recipe-detail, sharing: 44/44.
  - desktop-firefox runs only its own subset of specs ("No tests found" for these tags), so it wasn't used.
  - visual.spec.ts on phone-android, desktop-1080p, desktop-4k, desktop-4k-2x: 8/8, no baseline changed.
- Design pass (Latte; dev emulator data; phone 412×915 and 360×640, desktop 1920×1080, 4K 3840×2160; screenshots in the
  session scratchpad): Plan cards (single and multi-recipe rows), Create meal (picker, selected rows, confirm step),
  Use it or lose it rows, Suggested, the Grocery page's Staples group, the recipe page's Nutrition facts (closed and
  open) on phone and desktop, a long step with the arrow at 360×640 (and none on desktop, where the step fits), the
  Plan page at 4K. The prototype has no thumbnails on plan rows, no staples group and no nutrition panel; they reuse
  its card, kicker, mono-label and border patterns. Fix from the pass: water (free-use, not a staple) was being listed
  as a staple; only `isStaple` ingredients are now.

## Owner checks

- Deploy, then run `pnpm ingredients:upload` (no `--force`): it writes `nutrients` + `nutrientSource` to the 480 seed
  ingredients; ingredients edited in the app keep their edits and get the seed's nutrients only if they have none.
  The ingredient trigger then recomputes every recipe, so every recipe (old ones included) gets its Nutrition facts.
  Until then the panel says there's no data yet. An ingredient created in the app (not in the seed) has no nutrients
  until someone fills the new fields in Ingredients → edit; recipes using it show "~" values.
- Open a few recipes → Nutrition facts and sanity-check them against a label you know. Judgement calls are listed in
  `data/README.md` (2 % milk, fat-free Greek yogurt, brewed tea, dry-grounds coffee estimates, label estimates for the
  salted spice blends).
- Grocery: with meals planned, look at the **Staples** group (free-use staples your meals use that you've never bought
  through the app, and staples the cadence thinks are low). Remove what you have; each stays off for its usual
  interval. Tell me if you'd rather see more (every staple) or fewer (cadence only); the "Are you out of milk?" card is
  gone.
- Cook a recipe with a long step on your phone and check the down arrow; ask Claude for a recipe with long steps and
  check the `.cook` file splits them (re-download the skill from the Drop page first).
- Plan page and Create meal: every recipe row has its picture; recipes without a photo show the cuisine stripes.
