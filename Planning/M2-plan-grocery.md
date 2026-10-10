# M2 — Plan + Grocery

Status: not started

## Goal

The household can plan a period and get a grocery list out of it. Periods roll over, meals (recipe
collections) exist, the Plan page shows the coverage strip and a budget meter priced from estimates, brand
mappings and stores shape the list, and the Copy button hands the PC Express section to ChatGPT. Supply is
still empty (M3), so the grocery list equals the plan's needs minus nothing; the builder is written for the
real formula from the start.

## Requirements covered

R3 (plan period), R4.7 (Plan and Meals use `<CollectionView>`), R5.1–R5.5, R6.1–R6.6 (budget from estimates;
live prices are M5), R7.1–R7.6 (R7.4 grouping, R7.5 copy + ordered), R11.1 (kitchen tools), R11.5, R11.6,
R11.7, R11.11–R11.13, R10 page shell only.

## Prerequisites

M1 done (recipes exist to plan). `data/price-estimates.json` filled for the seeded ingredients.

## Deliverables

1. Periods and client-side rollover transaction.
2. Household settings pages: household (period, budget, timezone, servings, meal types), tools.
3. Meals: CRUD, favourites, share links, planning as a unit.
4. Plan page: list via `<CollectionView>`, `<CoverageStrip>`, `<BudgetMeter>`, add/remove, meal type, servings.
5. Stores, sourcing rules, brand mappings pages (manual product entry; PC Express search is M5).
6. Grocery builder in core; Grocery page grouped by store; manual items; Copy button → ordered; undo.
7. Price estimates and the budget math in core.

## Work breakdown

### 1. Periods

- [ ] `packages/core/period.ts`: `periodBounds(start, periodDays, timezone)` using `Temporal` polyfill or
      `date-fns-tz`; `nextPeriod()`; `isEnded(period, now, timezone)`.
- [ ] `apps/web/src/plan/rollover.ts`: on app open and on focus, if `period.end < now` run the Firestore
      transaction from spec §7 (create next period with budget snapshot, carry `planned` items with
      `carriedFromId`, advance `currentPeriodId`). Skip when offline with the "period ended" note.
- [ ] Household creation (M0) now also creates the first period.

### 2. Settings

- [ ] `/settings/household`: name, period length, budget, timezone picker, default servings, planned meal
      types toggles (all per R11.x). Zod-validated; writes `households/{hid}` fields.
- [ ] `/settings/tools`: chip list of owned equipment with suggestions (Instant Pot, food processor, sous vide,
      stand mixer, air fryer, …). Recipe detail now flags missing tools (R4.14) and `<CollectionView>` gets
      the "has all tools" filter.

### 3. Meals

- [ ] `packages/core/meal.ts` schema; `meals` collection rules (allowlisted CRUD, public get).
- [ ] `/meals`: `<CollectionView>` over a small meal index (built client-side from the `meals` collection;
      no function needed at this scale). `/meals/:id`: recipes with servings multipliers, total time, favourite,
      share, "Add to plan". `/meals/new`, edit. Prototype page "Meals".
- [ ] Deleting a recipe (M1 cleanup) removes it from meals; verify with a functions test.

### 4. Plan page

- [ ] `packages/core/plan.ts`: `planItem` schema; `coverageFor(item, recipe|meal, household)` →
      `{ dinner: 1, lunch: n }` per spec §7; `stripModel(items, period, plannedMealTypes)` → rows, filled
      cells, counts, overflow.
- [ ] `/plan`: `<CoverageStrip>` (non-interactive, labelled day cells, solid = cooked/eaten, outlined =
      planned, overflow "+n"), `<BudgetMeter>` (sticky; see §6), the plan list with `<CollectionView>`
      (filter/sort the planned items), empty state from the prototype, "Add" sheet (search recipes and meals,
      pick meal type and servings; defaults from household), remove, change servings/meal type.
- [ ] "Add to plan" buttons on recipe and meal pages and cards.
- [ ] Landing redirect now real: `/` → `/plan` when the current period has items.
- [ ] Desktop layouts: 2 columns at `lg`, 3 at `xl` (plan · suggestions placeholder · budget/protein summary
      placeholder) matching the prototype's desktop mode.

### 5. Stores, sourcing rules, brand mappings

- [ ] `/settings/stores`: list with kind (`pcExpress` | `inStore`) and `bulk` flag; seeded on household
      creation with "PC Express (Loblaws Greenbank Road)" and "Costco (in store, bulk)"; default store setting.
      PC Express store picker is M5; for now the store has a name and the default `pcxStoreId` from core config.
- [ ] Sourcing rules: by category or by ingredient → store. UI on the same page.
- [ ] `/settings/brands`: table of ingredient → product name, pack amount + measure, store. Manual entry
      now; M5 adds the PC Express product search. Prototype "Settings → Brands".

### 6. Prices and budget (estimates)

- [ ] `data/price-estimates.json`: `$ per kg` or `$ per unit` per seeded ingredient (CAD, Ottawa, rough).
      Script to flag ingredients without an estimate.
- [ ] `packages/core/pricing.ts`: `resolvePrice(ingredient, mapping?, livePrices?, estimates)` → cents per
      canonical unit with a `source` tag (`live` | `estimate` | `unknown`). Live is always undefined until M5.
- [ ] `packages/core/budget.ts`: `marginalCost(item, supply, incoming, mappings, prices)` using shortfall packs
      from the grocery builder; `spent(plan, …)`; "price unknown" count for the meter.
- [ ] `<BudgetMeter>`: `budget − spent`, red below zero, "n prices unknown" hint; never blocks adding.

### 7. Grocery builder and page

- [ ] `packages/core/grocery.ts`: `buildList({ planItems, recipes, meals, ingredients, supply, incoming,
      mappings, rules, stores, manualItems })` implementing the spec §8 formula (needs − unexpired supply −
      incoming, pack size from mapping → default pack → raw, store resolution order, free-use excluded).
      Deterministic item IDs (`ingredientId` or `manual_<uuid>`) so regeneration preserves ticks.
- [ ] `/grocery`: generated list grouped by store, per-item tick (field update on the items map, live for
      everyone), manual add (ingredient picker or free text), regenerate (keeps manual items and ticks),
      quantities in metric + imperial with pack counts and product names. Costco section as an in-store
      checklist. Prototype "Grocery" page, phase "order".
- [ ] Copy button: formats the `pcExpress` section as in spec §8, copies to clipboard, sets `status: ordered`
      + `orderedAt`, toast with Undo (back to `draft`). "Mark ordered without copying" for completeness.
- [ ] Ordered lists feed `incoming` into the builder and the budget. Receiving is M3.

## Data & rules introduced

`households/*/periods`, `planItems`, `stores`, `sourcingRules`, `brandMappings`, `groceryLists`, `meals`.
All member read/write per the generic rule; `meals` global.

## Tests

- Unit: period bounds across DST in `America/Toronto`; coverage and strip model (overflow, meal types off);
  budget math with pack rounding; grocery builder (incoming subtraction, pack fallback chain, store resolution,
  free-use exclusion, tick preservation); copy text format.
- Rules: household collections member-only; meals public get.
- Functions: recipe delete cleanup now covers meals and plan items.
- E2E: `meals`, `plan` (M2 parts: strip, budget, add/remove, landing), `rollover`, `grocery` (M2 parts),
  `settings` (household, tools, stores, brands).

## Exit criteria

- [ ] Owner plans a 7-day period with 5 dinners and 2 meals on a phone in under 10 minutes, sees 5/7 and a
      budget that goes down, copies the list into ChatGPT, and it reads cleanly.
- [ ] Two members see each other's ticks on the Grocery page live.
- [ ] Period rolls over on the configured boundary with uncooked items carried.

## Risks and notes

- Without supply, the budget meter never goes back up in M2; that's expected and documented in R6.3.
- Price estimates are rough; the meter's accuracy improves in M5 with live prices. Don't polish estimates.
