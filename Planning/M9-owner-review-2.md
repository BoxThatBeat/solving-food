# M9 — Owner review 2

Status: in progress

## Goal

Twelve change requests from the owner's second review (2026-10-12), turned into ordered tasks. The owner's words are
quoted under each item; decisions taken without the owner (the run was unattended) are recorded under "Decisions".

## Requirements covered

R11.9 (changed: Latte only), R4.2 (changed: meal type first), R4.28 (new: side recipes), R8.17 (new: Supply search),
R4.10 (changed: long steps scroll), R4.12 (changed: back returns to mise en place), R9.5 (changed: a review marks the
meal eaten), R6.23 (new: eating out), R6.24 (new: expiring meals first), R6.25 (new: use it up before ordering), R6.26
(new: fibre), R6.27 (new: nutrition tracking switch).

## Items (in build order)

### 1. Latte only; accents stay (item 2, R11.9)
> "Remove Catppuccin flavours in settings, the only theme should be Latte and it shouldn't be shown. Remove all tests
> associated with trying other themes. Keep accent colors"
- [ ] Core `normalizeTheme()` always returns `flavour: "latte"` (a stored frappé/macchiato/mocha is tolerated and read
      as Latte); `FLAVOURS`, `FLAV` and the token structure stay so a flavour could come back. The rules still accept
      the four stored values.
- [ ] Settings → Theme shows only the accent picker ("Accent", just you); the index.html first-paint script ignores a
      cached non-Latte theme.
- [ ] Tests: `theme.spec.ts` rewritten (accent only; a stored Mocha shows Latte), the Mocha loops removed from
      `a11y.spec.ts` and `visual.spec.ts`, the eight `*-mocha-*.png` baselines deleted. `theme.test.ts` covers the
      tolerance.
- [ ] PRD R11.9 and §12 visual design, spec §4.1 (`theme`), §12 Theming, §14.1 visual row, CLAUDE.md.

### 2. Meal type is the first filter; "side" recipes (items 6 and 5, R4.2, R4.28)
> "Meal type should be first filter" · "Should also have a category of 'side' for recipes too"
- [ ] Core `RECIPE_COURSES = [...MEAL_TYPES, "side"]` (taxonomy.ts): the meal-type tags a recipe can carry.
      `mealTypesOf()`, the `meal` URL filter and `tagCounts()` use it, so "side" is a meal-type group option, not a tag.
- [ ] `isSideOnly(recipe)`: tagged side and no other meal type. Side-only recipes are never in Suggested, the optimiser,
      or "Use it up" / expiry-alert proposals, and sort last in a Suggested sort (as blocked ones do). They can still
      be picked in Create meal next to a main.
- [ ] Filter sheet: Meal type group first (Breakfast, Lunch, Dinner, Snack, Side). The editor's tag suggestions and the
      Leftovers-feed list are unchanged (a side is not a slot).
- [ ] Skill: `tags` lists `side` as a meal type for side dishes (taxonomy.md via `pnpm gen:skill`, conventions.md).
- [ ] Unit tests (collection, scoring); e2e `recipes-browse.spec.ts` (@R4.2 meal type first; @R4.28 side filter, not
      in Suggested).

### 3. Supply search (item 7, R8.17)
> "Supply should have a search"
- [ ] A search box at the top of the Supply page (same look as the Recipes search) filtering rows by ingredient name
      and aliases, combined with the location/expiry filters; "No Supply matches" empty state.
- [ ] e2e `supply.spec.ts` @R8.17.

### 4. Cooking: long steps scroll; back returns to mise en place (items 10 and 9, R4.10, R4.12)
> "When a recipe step text is very long, it should be scrollable text. Not just overflow over the UI buttons" ·
> "should be able to go back to mise en place mode with the back button"
- [ ] Step text sits in its own scroll area (`min-h-0 flex-1 overflow-y-auto`) inside the step card; the step nav and
      timers never move under it (no fade hint: the scroll area is focusable and scrolls by touch, wheel and keys).
- [ ] Each cook phase is a history entry (`?mode=mise|steps` on the cook routes, pushed when moving forward, replaced
      otherwise); the browser back button from step mode returns to mise en place (and from mise en place to the
      order list for multi-recipe meals). A finished plan meal's cook page says it's cooked instead of starting over.
- [ ] e2e `cooking.spec.ts`: @R4.10 a very long step at 360×640 keeps Back / Next visible and the text scrolls;
      @R4.12 back from step mode lands on mise en place.

### 5. A review marks the meal eaten (item 12, R9.5)
> "When a meal is reviewed. Mark it as eaten, not as another step for the user"
- [ ] `submitReview` (when it confirms the amounts) sets the cooked plan item to `eaten` in the same transaction;
      Supply and the ledger are unchanged (eaten on a cooked meal never touched Supply).
- [ ] Plan card: a cooked meal shows "Cooked · review to finish" and a **Review** button (its pending review) instead of
      "Mark eaten". Leftovers ("Ate one") and snacks ("Ate it") keep their buttons.
- [ ] Functions test; e2e `leftovers.spec.ts` @R9.5 (the cooked meal is reviewed from its card and becomes eaten).

### 6. Eating out (item 1, R6.23)
> "Mark off meals in the plan where you know you will be eating out."
- [ ] Plan item `kind: "out"`: meal type, `recipes: []`, `servings: 1`, coverage of one slot, optional note as `name`.
      No grocery lines, no budget, no Supply, no cooking. Rules allow the kind (recipes empty, no sides).
- [ ] Create meal sheet: an **Eating out** choice (meal type + optional note) next to Recipes / Saved meals.
- [ ] Plan: an "Eating out" card (no cost line; remove only) and its own strip cell state (hatched, counted as covered).
      Not carried over at rollover or restart (it belongs to its period).
- [ ] Core: `stripModel` "out" cells; `buildEatingOut()`; unit tests. e2e `plan.spec.ts` @R6.23.

### 7. Planned meals sorted by soonest-expiring ingredient (item 8, R6.24)
> "Sort the planned meals by the soonest expiring ingredient involved in the recipe/meal first so the user makes that
> first"
- [ ] Core `planOrder()`: planned meals whose ingredients (unexpired Supply lots they would use) expire soonest come
      first, ties and the rest keep the previous order (Suggested). The Plan list's default sort is this order
      ("Expiring first"); the expiry badge ("Salmon expires in 2 days") is the hint of why.
- [ ] Unit tests; e2e `plan.spec.ts` @R6.24.

### 8. Use it up before ordering (item 11, R6.25)
> "… I should have been warned something in the grocery list would be expiring soon when I get it and not enough meals
> use it … a new use up short expiry food recipe suggestion section so it can be in the plan BEFORE ordering groceries."
- [ ] Core `orderSpare()`: adds each plan grocery line of the draft (what the next order buys, pack-rounded) as a
      virtual lot arriving now, expiring after the ingredient's shelf life in its default location, and runs the same
      `expiringSpare()` rule the "Use it or lose it" alert uses on the result. An ingredient is flagged when the order
      leaves spare that expires within the period (or the next four days) and no planned meal uses it.
- [ ] Plan page **Use it up · before you order** card (above Suggested): each flagged item with the spare amount, when
      it will expire, and up to two recipes that use it (`recipesUsing`, scored tie-break), + adds via Create meal. Gone
      once the list is ordered (the received lots are then covered by the existing alert).
- [ ] Spec §7 "Use it up before ordering"; unit tests; e2e `suggestions.spec.ts` @R6.25.

### 9. Nutrition tracking switch and fibre (items 3 and 4, R6.26, R6.27)
> "Should be able to toggle all features related to protein tracking. When toggled off, it should just hide it all,
> not remove the household data" · "Add a fibre goal in the same way protein works"
- [ ] Ingredients `fibrePer100g` (seed data for all 480, editor field, new-ingredient form, merge copies it); recipes
      `fibrePerServingG` / `fibreApproximate` derived like protein (`nutritionPerServing`), recomputed when an
      ingredient's fibre changes; recipe index summary carries them.
- [ ] Household `settings.fibreGoals` (per meal type, off when absent) and `settings.nutrition` (`false` hides; absent
      = on). Settings → Preferences: a **Track protein and fibre** switch; goal lists for both when on.
- [ ] Shown like protein: recipe cards and page tiles, Create meal rows, plan rows, meals, Suggested, the Plan
      summary card ("Protein & fibre / serving", both bars), the optimiser's "meets the goals" filter, the
      `proteinGoal` scoring factor's sibling `fibreGoal`, filters "Fibre per serving", sort "Most fibre".
- [ ] Switch off: every protein and fibre number, goal, bar, filter, sort, optimiser toggle and the goal scoring
      factors are hidden/inactive; goals and recipe data are kept, and switching back restores them.
- [ ] Skill and `.cook`: nothing to add (protein and fibre are derived from the ingredient list, never written in the
      file; checked `solving-food-skill` and `functions/src/dropFolder.ts`: neither reads protein). `pnpm gen:skill` up
      to date.
- [ ] Unit tests (recipe, scoring, plan summary); e2e `settings.spec.ts` @R6.27, `recipe-detail.spec.ts` /
      `plan.spec.ts` @R6.26.

## Decisions

## Verification

## Owner checks
