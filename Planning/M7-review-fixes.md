# M7 — Review fixes

Status: in progress

## Goal

Fix the items from the owner's review after M6. This plan is shared: the first agent did items 1–4 below; a second
agent appends the remaining review items.

## Requirements covered

R8.13, R4.19, R4.21, R4.2.

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

## Deviations and assumptions

- Imperial volumes that aren't kitchen measures (fl oz, pints, quarts, gallons) are treated like imperial weights:
  converted to ml / L and shown metric only. They convert to **ml**, not grams, even when the ingredient has a
  density (a pint of cherry tomatoes reads `950 ml`).
- Weights converted from lb / oz between 250 g and 1 kg round to the nearest 25 g so `2 lb` reads `900 g` (plain
  `formatGrams()` would say `910 g`). Other magnitudes use `formatGrams()` rounding.
- °C → °F rounds to the nearest 5 (`180°C` → `355°F`), as asked, not to oven-dial 25s.
- Household notes (written by the household) are shown as typed; only the recipe's own notes are rewritten.
