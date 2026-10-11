# M7 — Review fixes

Status: in progress (items 1–4 done by agent 1; agent 2 appends the rest)

## Goal

Fix the items from the owner's review after M6. This plan is shared: the first agent did items 1–4 below; a second
agent appends the remaining review items.

## Requirements covered

R8.13, R4.19, R4.21, R4.2 (agent 1); R3.1, R11.1, R4.14, R6.1, R6.2, R6.11, R6.17 (agent 2).

## Items (agent 1)

### 1. Units display rule v3 (R8.13)
- [x] `formatRecipeAmount()` shows one unit system per amount: imperial weights → metric only (`2 lb` → `900 g`,
      `8 oz` → `225 g`, 250 g–1 kg rounded to 25 g), fl oz / pints / quarts / gallons → ml / L only (`2 pints` →
      `950 ml`), cups and spoons as written (`1 cup`, `2 tbsp`, `½ tsp`), counts / metric / vague as written.
- [x] `withCelsius()` / `fahrenheitToCelsius()` removed; `fahrenheitOnly()` / `celsiusToFahrenheit()` rewrite step,
      prep and note text to Fahrenheit only (`220°C` → `430°F`, `350°F (175°C)` → `350°F`, `180°C (350°F)` → `350°F`).
- [x] Supply, grocery, receive, History, notifications, cook review unchanged (metric only); `toCanonical()` still
      converts cups and spoons for deduction and the grocery builder.
- [x] PRD R8.13, spec §5 display line and §9 house conventions, CLAUDE.md, README.md, Planning/README.md, the skill's
      SKILL.md and references/conventions.md.
- [x] Unit tests (`units.test.ts`, `recipe.test.ts`) and e2e (recipe-detail, cooking, sharing) on the new strings.

### 2. "Editing a recipe creates a v2 but there is no more v1 and I can't revert" (R4.19)
- [x] Checked the hypothesis first: every creation path (editor `createRecipe`, drop folder `importCook`, household
      import `createRecipeFromCook`) already writes `versions/1` in the same batch, and the live data (read-only, 125
      recipes) has `versions/1` for every recipe; the three edited ones have 1,2 / 1,2,3 / 1,2. The hypothesis is
      wrong and no recipe content was lost.
- [x] Likeliest cause on the phone: the history sheet rendered the live listener's first, cache-only result as the
      whole history; a phone that wrote v2 itself has v2 cached and v1 only on the server. `useVersions()` now also
      reads the versions from the server once when the sheet opens, merges the two, and the sheet says "Checking for
      older versions…" until the server has answered (`useLiveQuery` exposes `fromCache`).
- [x] `scripts/repair-versions.ts` (`pnpm repair:versions`, dry run by default, `--write`, create-only, idempotent)
      writes a missing `versions/{current}` snapshot from the recipe doc. Tested on the emulator; live dry run: 0
      missing.
- [x] Functions test: the drop-folder import's `versions/1` matches the recipe (editor shape), also for a pending
      duplicate. E2E (`recipe-edit.spec.ts`, @R4.19 @R4.16): a recipe dropped through the Drop page, history opened
      before editing, edited, history shows v2 and v1, v1 restored as v3.

### 3. Recipe page: no .cook download; Edit moves to the bottom (R4.21, R4.22 withdrawn)
- [x] The `.cook` button and its export code are gone from the recipe page; Copy link stays. The `sharing.spec.ts`
      export test and its `@R4.22` tag are removed; R4.22 is marked withdrawn in the PRD (no longer a bold ID, so
      coverage doesn't ask for it); spec §12 and §14.1 updated. `recipeToCooklang()` stays in core (the household data
      download writes each recipe as a `.cook`).
- [x] Edit is a text link under the recipe, in the Version history · Edit · Delete row, same style as Delete. The
      three links got a 24 px minimum height (WCAG 2.5.8 target size). Tests find it by role and name, so they're
      unchanged; the sharing test checks the .cook button is gone.

### 4. Recipes page: no "never cooked" text; skeleton while re-sorting (R4.5, R4.2)
- [x] Cards show no stats line for a never-cooked recipe (`madeLine()` returns ""); cooked ones keep "MADE n× · LAST
      …". PRD R4.5 says so. The recipe page's "Never cooked in this household" stat stays (not a card).
- [x] `useSettling()` + `<SettlingGrid>` on Recipes and Meals: skeleton cards (same size, no text, `aria-busy`) while
      a score sort waits for its first scores (capped at 4 s) and for ≥ 150 ms after any re-order (sort, filters, new
      scores re-ranking); typing a search re-orders without a skeleton. Keyboard focus on a card goes to the list
      while busy and back to the same card after. Spec §12 updated.
- [x] E2E (`recipes-browse.spec.ts`, @R4.2): switching A–Z → Suggested shows skeletons (aria-busy, no text), then the
      sorted cards; the page object's `titles()` / `goto()` wait for the list to settle. The never-cooked card check
      asserts no stats text.

## Items (agent 2)

### 5. Restart the plan period today or tomorrow (R3.1, new)
- [x] Core `planRestart()` / `restartBounds()` / `periodIdFor()` (`period.ts`): noop when the current period already
      starts on the chosen day; move a period that hasn't started yet (an earlier "Tomorrow"); otherwise a new period of
      `periodDays` from local midnight of the chosen day, the old one ending where the new one starts. Unit tests incl. a
      DST case and a property (no overlap, starts today/tomorrow).
- [x] `restartPeriod()` in `data/plan.ts`: one transaction; the rollover's carry code is factored into
      `plannedCandidates` / `readCarry` / `writeCarry` and used by both, so carried IDs, leftover checks and the budget
      snapshot are identical. Aborts when `currentPeriodId` changed since it was read. Periods rule unchanged (it already
      allows `start`/`end`/`budgetCents` with `end > start`).
- [x] Settings → Household → Plan & budget: "Restart period" with Today / Tomorrow, a confirm dialog ("Ends the current
      period now; n planned meals move to the new one (12–18 OCT)"), a no-op message, disabled with a note offline.
- [x] PRD R3.1 (and R11.5 points at it), spec §7 "Restart period" paragraph and §12 routes line.
- [x] E2E `rollover.spec.ts` @R3.1: two planned + one cooked meal, restart for tomorrow, both carried, strip and range
      show the new dates, old period kept (ends at the new start) with its cooked meal; Tomorrow again is a no-op;
      Today then moves the not-yet-started period without carrying again.

## Verification (items 1–4)

- Lint, typecheck: clean. Core unit 341/341, web unit 7/7, functions (emulator) 9 files / 54 tests.
- Playwright, `--workers=1`: recipes-browse, recipe-detail, recipe-edit, sharing, cooking: desktop-1080p 28 passed
  (+1 skipped touch-only; the manual-entry test and an R2.9 sign-in flake re-run green), phone-ios 29/29. Also on
  desktop-1080p: meals, a11y, drop-folder, responsive, data-transfer, sides 32/32. Visual baselines for the Recipes
  library re-recorded (cards lost the "NEVER COOKED HERE" line). After the footer change recipe-edit, sharing,
  recipe-detail re-ran 16/16 on both projects.
- `pnpm e2e:coverage`: all done milestones ok; M7 4/4 tagged.
- Design-compare (Latte, phone 430×932 and desktop 1920×1080) of Recipes and the recipe page against the prototype:
  layout, tokens and card shapes match. Intentional differences: never-cooked cards show no line (the prototype
  says "NEVER COOKED HERE"; the owner asked for nothing); the recipe page's Version history · Edit · Delete links sit
  on their own row under the "SHARED LIBRARY · V1" line at 13 px (were 11 px inline; Delete wrapped alone on phones),
  for tap targets. The header row on phones (Back, Save, Copy link, + Plan, Cook →) still wraps Cook → to a second
  line at 430 px, as before with fewer buttons.

- Deployed with `pnpm run deploy` (hosting, functions, rules, indexes): https://solvingfood.web.app 200, healthcheck
  `{"ok":true}`. `pnpm repair:versions -- --write` live: 125 recipes, 125 already have their current snapshot, 0
  written (every recipe also has `versions/1`; the three edited ones have all their versions).

## Owner items

- On the phone: open Ground Beef Tacos (v2) or Veggie Pizza Squares (v3) → Version history; v1 should be listed
  (briefly "Checking for older versions…") and restorable. If a recipe still shows only its current version, note
  which one.

## Deviations and assumptions

- Imperial volumes that aren't kitchen measures (fl oz, pints, quarts, gallons) are treated like imperial weights:
  converted to ml / L and shown metric only. They convert to **ml**, not grams, even when the ingredient has a
  density (a pint of cherry tomatoes reads `950 ml`).
- Weights converted from lb / oz between 250 g and 1 kg round to the nearest 25 g so `2 lb` reads `900 g` (plain
  `formatGrams()` would say `910 g`). Other magnitudes use `formatGrams()` rounding.
- °C → °F rounds to the nearest 5 (`180°C` → `355°F`), as asked, not to oven-dial 25s.
- Household notes (written by the household) are shown as typed; only the recipe's own notes are rewritten.
- Item 2: the reported loss could not be reproduced and the hypothesis (drop-folder imports without `versions/1`) was
  wrong; the fix hardens the history sheet against a cache-only result. If the owner still sees only the current
  version, note the recipe's name: the live data says every recipe has all its versions.
- Item 4: the skeleton is shown for re-orders on Recipes and Meals only; the Create meal sheet and Plan/History lists
  keep re-ordering in place.
