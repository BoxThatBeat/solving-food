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

## Deviations and assumptions

- Imperial volumes that aren't kitchen measures (fl oz, pints, quarts, gallons) are treated like imperial weights:
  converted to ml / L and shown metric only. They convert to **ml**, not grams, even when the ingredient has a
  density (a pint of cherry tomatoes reads `950 ml`).
- Weights converted from lb / oz between 250 g and 1 kg round to the nearest 25 g so `2 lb` reads `900 g` (plain
  `formatGrams()` would say `910 g`). Other magnitudes use `formatGrams()` rounding.
- °C → °F rounds to the nearest 5 (`180°C` → `355°F`), as asked, not to oven-dial 25s.
- Household notes (written by the household) are shown as typed; only the recipe's own notes are rewritten.
