# M30 — Servings as written, snacks without leftovers, the suggestion score explained

Status: done (owner: plan a recipe and cook a snack on the phone; see the exit criteria)

## Goal

Owner request (2026-11-17): "When adding recipe to plan it should just default to as written servings. Maybe remove
number of default servings in settings. Also recipes marked as snacks shouldn't have tracked leftovers since it's not
really a leftover, just that a certain amount was made and will be consumed over time. Not useful to track. Also, at
the bottom of a recipe, it should show 'household suggestion score' with the total and how the different parts
contribute to that total score."

## Root causes (verified)

- Create meal, the optimiser, the scoring snapshot, Use it or lose it, Use it up and cooking a saved meal all read
  `household.defaultServings` (`CreateMealSheet`, `addOptimiserSet`, `useScoringSnapshot`, `recipesUsing`,
  `/meals/:id/cook`). `SERVINGS_MAX` was 20, so a recipe written for 24 couldn't be planned as written.
- Snack leftovers: `leftoverPortionsByType` fell back to **lunch** for any leftover meal type that isn't plannable, so
  a snack recipe's "leftover portions" (`leftoverMealType: "snack"`, set by `defaultLeftoverMealType` for snack and
  dessert tags) became lunch leftovers in Supply and on the Plan page.
- The score exists per recipe (`ScoreResult.factors`, weights in `settings.scoreWeights`) but nothing shows how it's
  made beyond the two or three reason chips.

## Requirements covered

Changed: **R11.12** (servings as written; no household default), **R11.16** (Household section text). New:
**R6.36** (snack recipes track no leftovers), **R6.37** (household suggestion score on the recipe page). PRD v0.16.
Spec §4 (`households`), §7 (Creating meals, Coverage & leftovers, Suggestion score), §12, §14.1, §15.

## Items

- [x] **1. Servings as written** (R11.12). Core: `ScoreContext.servings` optional (absent: each recipe's own
      servings), `recipeNeeds` and `recipesUsing` follow it; `defaultServings` dropped from the new-household input,
      `buildNewHousehold`, the export fields, and made optional (legacy) in `householdSchema` and the rules;
      `SERVINGS_MAX` 20 → 100 (the recipe and plan item limit in the rules already). Web: Create meal defaults to the
      first picked recipe's servings with "As written" / "as written: N" under the stepper; the optimiser adds each
      recipe at its own servings; the snapshot, Use it or lose it and Use it up lose the household servings;
      `/meals/:id/cook` starts at the first recipe's servings; Settings → Household, the welcome form and the household
      switcher lose Default servings. Tests: `scoring.test.ts` (+1), `household.test.ts`, rules (`firestore.test.ts`
      +1), e2e `plan.spec.ts` (R11.12 rewritten), `settings.spec.ts`, `households.spec.ts`.
- [x] **2. Snacks track no leftovers** (R6.36). Core: `tracksLeftovers()` / `leftoverPortionsOf()` in `plan.ts`
      (tagged "snack", or leftovers set to feed snacks), used by `coverageFor` and `leftoverPortionsByType` (so
      `finishCooking` adds no leftover lot or plan items, and `recipeCleanup` passes tags). Web: the review's step 3 is
      "Notes" for a meal of only snack recipes (no leftover count sent); the editor shows a note in place of the
      leftover fields on a snack recipe
      and its "Leftovers for" labels Snack "not tracked" (kept as an option so a saved value still reads). Tests:
      `plan.test.ts` (+2), `cooking.test.ts` (+1), e2e `leftovers.spec.ts` (R6.36).
- [x] **3. Household suggestion score on the recipe page** (R6.37). Core: `ScoreResult.details` (one line per factor),
      `scoreBreakdown(result, weights)` (points per factor = 100 · sign · w · f ÷ Σ raising weights, most first;
      skipped and weight-0 factors listed). Web: `<SuggestionScore>` at the bottom of `RecipeDetail` (signed in):
      the total, one row per factor worth at least half a point with its line, weight, points and a bar (the rest
      named in one line, after the screenshot check showed eight "0" rows reading like claims), not-suggested reasons
      (blocked, already planned), and a link to Settings → Suggestion weights. Tests: `scoring.test.ts` (+2), e2e `recipe-detail.spec.ts`.
- [x] **4. Docs, screenshots, CI**: PRD v0.16, spec, this plan; phone and desktop screenshots of Create meal
      (As written, as written: N), Settings → Household, the editor's snack note and the recipe page's score. The
      review's notes-only step wasn't screenshotted (it needs a cooked snack in the dev data; it is one sub-text line in
      the step's existing layout, covered by `leftovers.spec.ts`). Typecheck, lint, unit, rules, functions tests and
      `pnpm e2e:coverage` pass locally; e2e runs in CI (no local e2e on the laptop).

## Exit criteria

- Adding a recipe written for 6 to the plan plans 6 servings without touching the stepper; Settings has no Default
  servings.
- Cooking a snack recipe adds no leftovers to Supply or the Plan page, and its review has no Leftovers step.
- The recipe page ends with the household suggestion score, whose rows add up to the total.
