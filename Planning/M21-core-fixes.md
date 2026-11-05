# M21 — Core fixes

Status: done

## Goal

A pass over `packages/core` (2026-11-05): fix nine verified bugs, each with a unit test that fails before and passes
after, make the optimiser's hot path cheap, and tidy the core's structure (grocery split, one math module, named
ingredient types, retired helpers removed, tree-shakeable package) without changing its public surface.

## Requirements covered

No new requirement IDs. Behaviour notes added under existing ones: R8.13 (package and bundle amounts have no weight,
PRD v0.7), R6.17 (summary counts the servings multiplier), R6.13 / R6.25 (one minimum expiring spare). Spec §5, §6,
§7, §8, §15 updated.

## Items

### Bugs (each with a failing-first unit test)

- [x] **1. Freeze after "Still good".** `freezeLot()` clears `expiryExtendedToMs` on the frozen lot (whole or split;
      the fresh part of a split keeps it), so the frozen expiry applies. Same for Set date (R8.18). `ledger.test.ts`;
      spec §6 "Expiry".
- [x] **2. Package words aren't pieces.** `CONTAINER_WORDS` (can, tin, jar, bottle, bag, box, packet, pack, package,
      pkg, container, carton, tub, bunch, sprig) parse to a new `UnitKind` `"container"`; `toCanonical` reports
      `{ ok: false, reason: "container" }`, so the line keeps its wording with `canonicalAmount` 0: no Supply deduction,
      no grocery need, protein approximate. Natural pieces (clove, slice, stalk, head, fillet) stay counts. The importer
      warns ("has no weight; set grams"), the recipe page marks the line **NEEDS A WEIGHT** (signed in), the editor's
      existing "doesn't convert from" message covers it, and the skill's taxonomy says to write grams
      (`pnpm gen:skill`). `units.test.ts`, `cooklang.test.ts`; spec §5 table, PRD R8.13.
- [x] **3. Cooklang timers.** `~{30%s}` is 30 s (the unit is matched whole before stripping a plural `s`); s/sec/
      seconds, min/minutes, h/hr/hours. `cooklang.test.ts`.
- [x] **4. `parseAmount("1,000")`.** A comma followed by exactly three digits is a thousands separator ("12,345,678"),
      any other comma between digits is still a decimal comma ("1,5" → 1.5). `cooklang.test.ts`.
- [x] **5. Negative Celsius.** `fahrenheitOnly("-18°C")` → "0°F" (also U+2212 minus); "180-200°C" is still a range.
      `units.test.ts`.
- [x] **6. Protein and fibre × servings multiplier.** `proteinSummary` (used for both) multiplies each recipe's
      per-serving value by its `servingsMultiplier`. `plan.test.ts`; spec §7 protein summary.
- [x] **7. Minimum expiring spare in scoring.** `ALERT_MIN_GRAMS` / `ALERT_MIN_COUNT` moved to `expiry.ts` with
      `minSpare(unit)`; `expiringUses` / `expiryUrgency` ignore spare below it and recipes using less than it;
      `recipesUsing` (alerts and Use it up) takes the unit and leaves such recipes out. `IngredientMeta.canonicalUnit`
      (optional) is filled by the scoring snapshot. `scoring.test.ts`, `smarts.test.ts`; spec §7.
- [x] **8. `localMidnight` where DST changes at midnight.** Tries the offsets around the date and keeps the earliest
      candidate on that date: Santiago / Havana spring-forward days start at 01:00, a repeated midnight is the first.
      `period.test.ts` (with a whole-year property over five zones); spec §7 periods.
- [x] **9. `mergeDraft` and `removed: false`.** An un-removed line keeps `removed: false` (also through restore), so it
      isn't rewritten on every regeneration; `removed: true` behaves as in M17. `grocery.test.ts`.

### Structure and performance

- [x] **10. Optimiser hot path.** `linePricing()` / `lineCents()` precompute each ingredient's supply, incoming, pack
      size and cents per unit once per `marginalCostFn`; no `GroceryItem` or store set per evaluation. Property test
      against the line-building path (identical results, bit for bit). Benchmark (scratch script, 400 ingredients,
      250 recipes, 6 planned meals): 100 000 four-recipe set costs **7.21 s → 1.11 s**; optimiser three `next()` calls
      939 ms → 614 ms (4 114 cost calls, same sets).
- [x] **11. `grocery.ts` split** into `packages/core/src/grocery/` `builder.ts` (needs, packs, stores, prices, costs,
      manual lines, default stores), `staples.ts`, `draft.ts` (merge, removed lines), `copy.ts` (groups, Copy text),
      re-exported by `grocery/index.ts`; imports of `./grocery` unchanged.
- [x] **12. One math module.** `packages/core/src/math.ts`: `DAY_MS`, `EPS` (1e-6, stored amounts), `FLOAT_EPS`
      (1e-9, float noise), `round3`, `round6`; used by ledger, expiry, period, cadence, cooking, pricing, recipe,
      ingredientMerge, export, Cooklang, grocery and scoring.
- [x] **13. Ingredient types.** `ingredientTypes.ts`: `CanonicalUnit`, `IngredientRef`, `IngredientConversion`,
      `IngredientStorage`. `ConvertibleIngredient` is now an alias of `IngredientConversion`; `GroceryIngredient`,
      `SideIngredient`, `OrderIngredient` and the projection context build on them. No exported name removed.
- [x] **14. Retired cadence helpers.** `duePrompts`, `snoozeUntil`, `CadencePrompt`, `CADENCE_SNOOZE_SHARE` removed
      (nothing in web or functions used them). `snoozeCadence` stays (old commands are still applied and `isDue` honours
      `snoozedUntil`). Spec §8.
- [x] **15. Tree-shakeable core.** `"sideEffects": false` in `packages/core/package.json`; the one top-level statement
      (`tools.ts` alias map) is now an expression. Scoring worker 541 KB → 494 KB, optimiser worker 547 KB → 500 KB.
      **M23** will split a worker entry so UI-only modules (handsFree, timers, theme, landing, profile, collection)
      leave the workers entirely.

### Housekeeping

- [x] `.playwright-cli/` in `.gitignore`.
- [x] PRD header v0.7, 2026-11-05.
- [x] Spec §15 row, Planning/README row.

## Deviations

- **Container words are a new unit kind, not "vague".** Vague lines become optional and vanish from the grocery
  list; a can of tomatoes is a real need, so container lines stay required with no weight and are flagged instead.
- **"head", "slice", "stalk", "clove" stay counts.** The seed's unit weights for garlic (a clove), broccoli and cabbage
  (a head), bacon (a slice) and celery (a stalk) are written for exactly those words. "1 head garlic" still reads as one
  clove: left for the owner (see Owner attention in the report).
- **Canned ingredients counted by the can** (canned tuna 120 g, canned salmon 213 g) now need `{2}` (a count) or
  grams instead of `{2%cans}`; no shipped recipe uses package words, so nothing in `data/recipes` changed.
- **`removed: false` is preserved even through Regenerate (restore)**: restore only clears `true`, which avoids a
  pointless rewrite. The web app deletes the field on Undo, so `false` only comes from older data or other writers.
- **Two epsilons kept on purpose** (`EPS` 1e-6 for stored amounts, `FLOAT_EPS` 1e-9 for float noise) rather than
  forcing one value: merging them would change either the ledger's zero test or pack rounding at the boundary.
- **No e2e run**: the only visible change (the NEEDS A WEIGHT hint) applies to recipes with package words, which no
  e2e fixture uses; unit tests cover the behaviour. No design-compare: one hint word in an existing hint line.
