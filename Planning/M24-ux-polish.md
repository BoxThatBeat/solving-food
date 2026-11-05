# M24 — UX polish

Status: in progress

## Goal

A pass over what a visual and code review of the live app (2026-11-05, phone 430×932 and desktop 1920×1080) found
rough: the Plan page's alerts pushing the plan below the fold on phones, Suggested mixing muffins with dinners, stub
recipes suggested with zeros, Supply's filter sheet applying instantly while Recipes' uses a draft, touch targets under
44 px, step mode's clickable span and doubled live regions, History's stats saying "Nothing yet" while loading, and the
use-it-up wording. Plus the CI failure left by M23 and planning housekeeping.

## Requirements covered

New: **R6.30** (Suggested by meal type), **R6.31** (alerts fold once seen), **R12.2** (44 px touch targets). Changed:
R6.11 (stub recipes never suggested, "Needs ingredients"), R8.12 (Supply's filter sheet is a draft), R10.3 (stats load
before saying "Nothing yet", with a line on what will appear), R6.13 / R6.25 (row copy). PRD v0.10. Spec §7 (M24
paragraph under the suggestion score; folding under Use it up), §14.1 (`a11y.spec.ts` row), §15 row.

## Items

- [x] **0. M23 CI failure.** `pwa.spec.ts` on phone-android: with one navigation per width (M23) the phone mounted no
      sync status, so nothing said OFFLINE. The phone header shows an OFFLINE badge (`PhoneOffline` in `AppShell.tsx`).
      Separate commit, noted under M23's Deviations.
- [x] **1. Plan alerts fold (R6.31).** `<PlanAlerts>` (`components/plan/PlanAlerts.tsx`) wraps the expired-lot prompts
      (moved from above the grid into the alerts column), Use it or lose it and Use it up. Seen keys per household in
      `localStorage` (`sf.planAlertsSeen`); all seen when the page opened → one summary button with a chevron
      (`aria-expanded`); anything new → full. Below `lg` only. `plan.spec.ts` @R6.31 (phone): first view full, second view
      folded with the strip, "This period" and the first meal inside the viewport, the chevron opens them, a new expired
      lot shows them in full again.
- [x] **2. Suggested by meal type (R6.30).** `<MealTypeTabs>` (in `MealTypePicker.tsx`, same look as the picker, with
      All first) filters `SuggestedSection`; default `emptiestMealType()` (core `plan.ts`, unit test); recipes' meal types
      from `plannedMealTypesOf()` (core `collection.ts`, unit test), which the optimiser now uses too. See more carries
      `meal=<tab>`. `suggestions.spec.ts` @R6.30.
- [x] **3. Stub recipes.** `needsIngredients()` (core, unit test); `score()` blocks with "Needs ingredients" (`stub`),
      `combinedSuggestion` ignores a stub next to a real recipe (unit tests); `<RecipeCard>` says "Needs ingredients".
      `suggestions.spec.ts` @R6.11.
- [x] **4. Supply filter draft.** `<FilterSheet>` (`components/FilterSheet.tsx`) shared by `<CollectionView>` and Supply;
      Supply edits a draft and applies on "Show N items". `supply.spec.ts` @R8.12 extended (picking counts, Escape
      discards).
- [x] **5. Touch targets (R12.2).** Audited with a script on the phone viewport (Plan, Recipes, recipe page, editor,
      new recipe, Supply, Supply item, Grocery, History, Settings, Stores, Trash, Ingredients, mise en place, step mode).
      Fixed at the primitives (`Button` default/sm `min-h-11`, sm `min-w-11`, icon `size-11`; `ToggleChip`, `Select`,
      `Stepper` compact 44 px) and in place: phone header household button and tab bar, Recipes/Meals segment, Trash,
      Add recipe, recipe card favourite and + (44 px transparent hit area around the 34/38 px faces, `press-face`
      utility), recipe page top bar and footer actions, editor icon buttons, photo remove, tag/tool chips and "Insert"
      chips (hit area around the small pill), cuisine/protein choices, back links, Plan's Weights / See more / goals
      links and Dismiss buttons, checkbox labels, Grocery's Brands/Stores and line ×, Supply unit buttons, notification
      banner actions and dismiss, review skip, cooking's Stop. `a11y.spec.ts` @R12.2 fails on any visible button, link
      or toggle under 44 × 44 px on the phone project.
- [x] **6. StepMode.** The more-text arrow is a `<button>` ("Scroll down for more of this step", 44 px); the step card
      is no longer `aria-live` (its timers ticked inside it); one sr-only live region announces "Step n of m". The edge
      tap strips are `data-hit-exempt`. `cooking.spec.ts` (arrow) and `a11y.spec.ts` (one live region).
- [x] **7. Landing.** Traced a cold load of `/` on phone and desktop (pathname and `<h1>` every 15 ms), with and without
      the remembered answer: `/` → `/recipes` before anything renders, no other page's heading in between. No change.
- [x] **8. Use-it-up copy.** M21's `minSpare()` already keeps out slivers (Veggie Pizza Squares' 3 tbsp of broccoli is
      ~2.5 g at 4 servings, so it isn't offered). Rows now read "uses 450 g of the salmon fillet expiring tomorrow"
      (`expiringWhen()`, core, unit test) and "uses 170 g of the spare baby spinach". `suggestions.spec.ts` updated.
- [x] **9. History stats.** The tiles showed "Nothing yet." while their queries loaded (events, ratings, received
      lists, periods, the recipe index for cuisines); the seed data shape was fine (checked with cook events and a
      rating in the dev emulator). Now "Loading…" until loaded, then "Nothing yet." with what will appear there; spend
      counts as empty until a list is received. `history.spec.ts` @R10.3 extended.
- [x] **10. Housekeeping.** "Waiting on the owner:" lines at the top of M1–M4; README rows M21–M24 in order; spec §15
      rows sorted (M17/M18 and M22/M23 were out of order).

## Deviations

- **Fold rule: new items unfold, removed ones don't.** The brief said "whenever the set of items changes"; resolving a
  lot (Still good) would then unfold everything again, so only an item this device hasn't shown before does.
- **The first view stays in full**, so the strip-in-the-first-screen check is on the second view (the test asserts both).
- **No folding on wide screens (lg+):** the alerts have their own column there, as in the prototype's desktop mode.
- **Expired-lot prompts moved into the alerts column** (above the strip on phones, right column on desktop) so the
  summary line covers them; before, they were above the grid at full width.
- **Untagged desserts and appetizers are snacks** (`plannedMealTypesOf`); other untagged recipes stay dinners, as the
  optimiser already assumed. This also takes Cake Mix Brownies and cookies out of the optimiser's dinners.
- **Tabs filter, they don't rescore:** the protein goal still uses each recipe's own meal tag; one scoring run serves
  every tab.
- **Touch targets grew visibly where a face couldn't hide them:** `Button size="sm"`, toggle chips, selects and the
  editor's choice chips are 44 px tall now (were 36–40 px), and back links are 44 px rows; small faces (icons, tag
  pills, card buttons) keep their size inside transparent hit areas. Desktop-only controls (the rail's collapse
  button) weren't changed; the check runs on the phone project.
- **Design-compare:** Plan (phone folded and open, desktop), Supply's filter sheet, Recipes, the recipe page, the editor
  and History on phone; Plan and History on desktop. Prototype has no tabs or fold line: built in its tokens (peach
  summary like the Use it or lose it card, tabs like the meal-type picker). The prototype's alert rows put "uses 300 g"
  on the right; the sentence now sits under the title.
