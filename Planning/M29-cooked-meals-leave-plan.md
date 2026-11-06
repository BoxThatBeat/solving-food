# M29 — Cooked meals leave the plan

Status: done (owner: cook a planned recipe from its page on the phone; see the owner checks)

## Goal

The owner cooked a planned recipe and found it still on the Plan page. Cook on a recipe's page ran "a recipe that
isn't on the plan" (no `planItemId`), so `finishCooking` never marked the plan item cooked and the strip cell stayed
white. Make every cook of a planned recipe or saved meal the plan item, take cooked meals off the Plan list (the strip
keeps them, accent-filled), give mise en place a Back button and the ingredient amounts step mode shows, and let
Add to plan from a recipe page choose This period or Next period.

## Root cause (verified)

- `/recipes/:id/cook` built a CookSession target without `planItemId`; `/meals/:id/cook` too. `finishCooking` sets the
  plan item to `cooked` only when the payload carries `planItemId`.
- The strip was already right: `stripModel` counts cooked and eaten items as cooked and `<CoverageStrip>` paints them
  `bg-acc`, planned ones `bg-base` with `border-line`. Checked in the dev data: the planned dinner's cell turned accent
  once the cook from the recipe page carried the plan item.
- Mise en place amounts: imported prep tasks (a Cooklang `prep:` list) are plain text with no `{{ing:…}}` placeholders,
  so `prepList` found no ingredient segments; editor tasks showed only the first one's amount.

## Requirements covered

New: **R9.7** (Cook on a planned recipe's or saved meal's page cooks the plan item), **R4.41** (Back on mise en place),
**R4.42** (amounts on mise en place). Changed: **R3.2** (Add to plan outside the Plan page offers This period · Next
period), **R6.1** (the list holds only what's still to cook or eat), **R6.2**
(cooked cells accent-filled, planned white outlined), **R9.5** (cooked meals leave the list; the review from Pending
reviews). PRD v0.15. Spec §7 (What the Plan list shows), §12 (`<CoverageStrip>`, `<MiseEnPlace>`), §14.1, §15.

## Items

- [x] **1. Core**: `plannedMealFor(items, start, soonDays)` and `listedOnPlan(status)` in `plan.ts`;
      `renderPrepTask()` in `prepTask.ts` (placeholders like steps; plain text: names found, a written quantity and a
      count noun after the name become the scaled badge, `amountText` for R8.13). Unit tests: `prepTask.test.ts` (7),
      `plan.test.ts` (+4).
- [x] **2. Web: planned cooks**: `usePlannedMeal()` (decided once when the plan has loaded; no period → off the plan;
      queued offline finishes don't count), `planCookTarget()` shared by `/plan/:itemId/cook`, `/recipes/:id/cook` and
      `/meals/:id/cook`; the cook header says **Planned** (**Planned dinner** from `sm`).
- [x] **3. Web: Plan list**: only `planned` items listed; cards lose the Review button and the cooked Mark eaten; an
      "Everything planned this period is cooked" empty state.
- [x] **4. Web: mise en place**: Back chip (recipe page's style, 44 px) → recipe page or the meal's list; prep tasks
      rendered from `renderPrepTask` with step mode's inline amount chips; hands-free reads "garlic, 4 cloves".
- [x] **4b. Web: Add to plan period choice** (owner request, added mid-milestone): `<CreateMealSheet>` outside `/plan`
      shows `<PeriodSwitch>` at the top (This period first) and adds to the chosen view's model (M26's next-period
      model, no duplicate logic); on the Plan page the page's switch decides.
- [x] **5. E2E**: cooking.spec (@R9.7 @R6.2 @R6.1: cell `planned` → `cooked` after Done cooking from the recipe page,
      off the list; a meal of several from one recipe's page; @R4.41; @R4.42), plan.spec (accent fill, cooked / eaten /
      skipped not listed), leftovers.spec (@R9.5 reworked), offline.spec, review.spec (saved meal checked on the doc), plan.spec (@R3.2: Add to plan from the recipe page, Next period, the item
      in the next period only; no choice in the sheet on the Plan page).
- [x] **6. Docs**: PRD v0.15, spec, README row, this plan.
- [x] **7. Screenshot check** (phone 430×932, desktop 1920×1080): mise en place from the recipe page of the planned
      dev dinner (Back, amounts, kicker), Plan after Done cooking (strip cell accent, list empty state, Pending
      reviews), Add to plan from the recipe page (phone; desktop with Next period chosen: dates, next-period budget impact).
      Fixed: the kicker "Planned · Mise en place" wrapped to three lines on the phone header; now "Planned"
      on phones and "Planned dinner" from `sm`.

## Deviations

- **No new review line; Pending reviews is it.** The Plan page already shows **Pending reviews** (R9.4) above the strip
  with a Review button per cooked meal, disappearing once reviewed; a second "Tacos cooked Tue · Review" line in the
  alerts style would repeat it. R9.5 now points there.
- **Exact matches first.** If a recipe is planned alone and also inside a multi-recipe meal, Cook on its page takes the
  one-recipe meal even when the Plan page lists the bigger meal first; otherwise the Plan page's order (meal type, then
  soonest-expiring ingredient). Ties don't use the Suggested score (it lives in the worker), so equal-expiry meals
  fall back to document order rather than the Plan page's Suggested tie-break.
- **Servings come from the plan item.** A planned cook uses the plan item's servings, not the recipe page's servings
  stepper, since the grocery list bought for those.
- **Kicker wording.** "Planned dinner" (the meal type) rather than "Planned · Taco night": the meal's name is already
  the header's title line, and the phone header has room for one short word.
- **Plain prep tasks are matched by name.** Imported prep tasks have no ingredient links, so names are found in the
  wording (display text, without preparation words, singular); a task that words an ingredient differently from the
  recipe ("Juice 2 lemons" for the line "lemon juice") gets no badge and keeps its text.
- **A match is locked, "not planned" isn't.** The first CI run failed on Android: opening `/recipes/:id/cook` straight
  after the period changed, the first snapshots came from the device's cache (the household's older period), so the
  hook locked "not planned". Now only a match is kept for the session; until one appears the cook runs off the plan and
  switches to the planned meal when the fresh snapshot arrives (a moment's flicker at most).
- **Recipe page "Before you start" unchanged.** Only mise en place renders amounts, as asked.

## Verification

- Typecheck, lint: clean. `pnpm e2e:coverage`: green, M29 7/7 tagged.
- Unit: core 777 → 788, web 48.
- Functions: 95/96 locally (no function change); the one failure is `ai.test.ts` "Gemini down", the order-dependent
  flake M28 recorded. CI decides. Rules: 104 (no rule change).
- E2E: written, not run locally (owner rule: memory); CI runs the matrix.

## Owner checks

- With a recipe planned this period, open it from Recipes, tap **Cook →**: the header says PLANNED; Done cooking, then
  the Plan page: the meal is gone from the list, its cell is green, and Pending reviews has its Review.
- Recipe page → **+ Plan**: pick **Next period**, add; it shows under Plan → Next period, not this period.
- Mise en place: the **Back** button, and the amounts next to the prep tasks (try a recipe with "Mince 5 garlic cloves"
  at a different serving count).
