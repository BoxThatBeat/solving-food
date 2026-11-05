# M28 — Cook notes and substitutions

Status: in progress

## Goal

The review's "notes for next time" were stored on the cook event and never shown again, and a recipe was "missing"
anything Supply didn't hold even when an obvious stand-in was in the cupboard. Surface the last cook's notes where the
next cook starts (mise en place, the recipe page, the review) with per-step notes in step mode, and add a small,
deterministic substitution table that suggestions, Can make, mise en place (deducting the substitute) and the grocery
list use, behind a household switch.

## Requirements covered

New: **R4.38** (last cook's note on mise en place and the recipe page, Show earlier), **R4.39** (per-step notes),
**R9.6** (the review shows the previous note, Keep this note), **R6.35** (substitutions in suggestions and Can make),
**R4.40** (the swap on mise en place, deducted by Done cooking), **R7.20** (the grocery "have …" hint), **R11.20**
(Settings → Preferences → Suggest substitutions). Changed: R6.11 (missing ingredients factor), R9.2 (review step 3).
PRD v0.14. Spec §4.2 (cookEvents fields, settings), §6 (finishCooking, submitReview), §7 (Substitutions, the factor),
§8 (grocery hint), §12 (Cook notes), §14.1, §15.

## Items

- [x] **1. Core** `cookNotes.ts`: `recipeNotes` (newest first, the reviewed event left out, ≤ `COOK_NOTES_SHOWN` = 5),
      `latestStepNotes` (the newest event carrying step notes for the recipe; "" = cleared), `stepNotesToSend` (shown
      notes carried forward with this cook's edits), `notedRecipeIds`. `substitutions.ts`: `SUBSTITUTIONS` (57 entries,
      50 both ways, canonical ratio + kitchen `basis`), `substitutesFor`, `substitutionRatio`, `isBaking`, `findSwaps`
      (shortfall only, spare after the recipe's own use and earlier swaps, table order), `substituteInSupply` (grocery),
      `applySwaps` (table pairs only), `swapText`, `SWAP_PENALTY` = 0.25. Scoring: `ScoreContext.substitute`,
      `missingIngredients(needs, ctx, swaps)`, the reason "Missing lemon · garlic: use 0.8 g garlic powder from Supply",
      `ScoreResult.swaps`. `supplyCoverage(…, { substitute, baking })` → `swaps`. Commands: `finishCooking.substitutions`
      and `.stepNotes`; cookEvent `stepNotes`, `notedRecipeIds`, `substitutions`; settings `substitutions`. Unit tests:
      `substitutions.test.ts` (table against the seed via `data/scripts/ingredients.ts`' loader, ratios from `basis`,
      swaps, apply, factor, reason, can make, payload), `cookNotes.test.ts`.
- [x] **2. Functions**: `finishCooking` applies accepted swaps (`applySwaps`; unknown pairs, free-use substitutes and
      a second swap of one ingredient ignored) so `defaults`/`used`/`deducted` hold the substitute, stores
      `substitutions`, `stepNotes` (of the recipes cooked) and `notedRecipeIds`; `submitReview` with a note adds every
      recipe of the meal to `notedRecipeIds`. Functions test in `commands.test.ts`.
- [x] **3. Rules and index**: `finishCooking` payload keys `substitutions`, `stepNotes` (rules test in `supply.test.ts`);
      the composite index `cookEvents (notedRecipeIds CONTAINS, cookedAt DESC)`.
- [ ] **4. Web: cook notes**: `useRecipeCookNotes(hid, recipeId)` (one bounded listener); "Last time (12 Oct, Aaron)"
      with Show earlier on mise en place and the recipe page; step notes under the step text and a Note sheet in step
      mode, carried in the session and sent with Done cooking; the review's previous note and Keep this note.
- [ ] **5. Web: substitutions**: the snapshot's `substitute`; Can make with swaps ("CAN MAKE · SWAPS"); the mise en place
      swap line with Use it / Undo, sent with Done cooking and applied to the pending review's amounts; the grocery
      "have …" hint; Settings → Preferences → Suggest substitutions.
- [ ] **6. E2E**: cooking.spec (@R4.38 @R4.39 @R4.40), review.spec (@R9.6), suggestions.spec (@R6.35), grocery.spec
      (@R7.20), preferences.spec (@R11.20).
- [ ] **7. Docs**: PRD v0.14, spec, README row, this plan.
- [ ] **8. Screenshot check** (phone 430×932, desktop 1920×1080): mise en place (note, swap), step mode (step note,
      sheet), review (previous note), recipe page, a suggestion card, Recipes Can make, Grocery hint, Settings →
      Preferences.

## Deviations

- **Step notes are an array, not a map**: `stepNotes: [{ recipeId, step, text }]` instead of `{ [index]: text }`, since
  one cook event can hold several recipes; ≤ 60 per event, ≤ 200 characters each.
- **Step notes carry forward**: each Done cooking sends the notes it showed plus this cook's edits (a cleared one as
  ""), so the newest event with step notes for a recipe is the whole set and a note doesn't fall out of the five-event
  window. Notes are written at Done cooking (step mode comes before the cook event exists), not by the review.
- **One new listener, one composite index**: the "Last time" query is `notedRecipeIds array-contains <recipe>`, newest
  5 by `cookedAt`, only on mise en place / step mode and the recipe page (shared by both: one listener per recipe on
  screen). Reusing the 300-event suggestions listener would open it on pages that don't have it. `notedRecipeIds` is
  written by the functions; the composite index is the project's first (deployed with `--only firestore`).
- **Ratios are stored, not computed at run time**: grams of substitute per gram of original, checked by a unit test
  against the seed's densities and unit weights within 1 %, so the worker needs no conversion data.
- **Butter ↔ oil is in the table but inert today**: both are free-use (never "missing", never deducted).
- **The penalty is on the missing-ingredients factor only**: a swapped ingredient counts 0.25 of a missing one;
  supply utilisation, cost and the grocery list are unchanged (we don't buy substitutes).
- **Can make counts swaps, no toggle**: the simpler choice; the badge reads "CAN MAKE · SWAPS" when a swap was needed.

## Verification
