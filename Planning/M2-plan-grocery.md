# M2 — Plan + Grocery

Status: in progress

All 27 work-breakdown tasks are built and verified (2026-10-10), deployed, and every M2 requirement ID has a passing,
tagged Playwright test. Only owner-side checks remain (see "What's left for the owner"); then set `Status: done` and
`pnpm e2e:coverage` enforces the 27 M2 IDs.

## Verification (2026-10-10)

| Layer | Result |
|---|---|
| Lint, typecheck | clean |
| Unit (`pnpm test`) | core 211 passed (15 files; new: period incl. DST and a fast-check tiling property, plan/coverage/strip, grocery builder incl. a pack-rounding property, pricing, budget, meal rows, cost/tools filters), web 7 passed |
| Rules (`pnpm test:rules`) | 66 passed (10 new in `tests/rules/plan.test.ts`) |
| Functions on the emulators | 21 passed (cleanup recomputes coverage and keeps `savedMealId`; maintenance refreshes stale summaries) |
| Playwright phone-ios | 90 passed, 6 skipped, 0 failed |
| Playwright desktop-1080p | 95 passed, 1 skipped, 0 failed |
| Playwright phone-android | 95 passed, 1 skipped, 0 failed |
| Playwright tablet + desktop-firefox (smoke) + desktop-4k + desktop-4k-2x | 33 passed, 6 skipped, 0 failed |
| `pnpm e2e:coverage` | M2 27/27 requirement IDs tagged |
| Live | `pnpm run deploy` (hosting, functions, Firestore rules, Storage rules); healthcheck ok; site 200; the maintenance job run once by hand refreshed all 28 live index summaries |

Projects were run one at a time: a single run of phone-ios + desktop-1080p together ran the Firestore emulator out of
heap (see Deviations). One WebKit flake seen once and passing 4/4 on repeat: recipes-browse "favourite from a card".

## What's left for the owner

1. Exit criterion 1 on a real phone: plan a 7-day period with Create meal (three one-recipe dinners, a three-recipe
   taco night saved as a meal, a dinner from that saved meal), check 5/7 and the budget, Copy for ChatGPT and paste.
   The first open after this deploy creates Silbrass Pvt's first period and default stores automatically.
2. Sign-off on feel (Plan, Create meal, Meals, Grocery, Settings), as for M0/M1.
3. Push `master` (first CI run; still open from M0/M1). Also still open from M1: the skill import test.

## Goal

The household can plan a period and get a grocery list out of it. Periods roll over, meals (recipe
collections) exist, the Plan page shows the coverage strip and a budget meter priced from estimates, brand
mappings and stores shape the list, and the Copy button hands the PC Express section to ChatGPT. Supply is
still empty (M3), so the grocery list equals the plan's needs minus nothing; the builder is written for the
real formula from the start.

## Requirements covered

R3 (plan period), R4.7 (Plan and Meals use `<CollectionView>`), R5.1–R5.5, R5.7, R5.8, R6.1–R6.6 (budget from estimates;
live prices are M5), R7.1–R7.6 (R7.4 grouping, R7.5 copy + ordered), R11.1 (kitchen tools), R11.5, R11.6,
R11.7, R11.11–R11.13, R10 page shell only.

## Prerequisites

M1 done (recipes exist to plan). `data/price-estimates.json` filled for the seeded ingredients.

## Deliverables

1. Periods and client-side rollover transaction.
2. Household settings pages: household (period, budget, timezone, servings, meal types), tools.
3. Saved meals: list, edit, favourites, share links; "Save as meal" from the create flow.
4. Plan page: `<CreateMealSheet>` (multi-select recipes or a saved meal → meal type, servings, optional save),
   list via `<CollectionView>`, `<CoverageStrip>`, `<BudgetMeter>`, remove, edit meal type/servings.
5. Stores, sourcing rules, brand mappings pages (manual product entry; PC Express search is M5).
6. Grocery builder in core; Grocery page grouped by store; manual items; Copy button → ordered; undo.
7. Price estimates and the budget math in core.

## Work breakdown

### 1. Periods

- [x] `packages/core/period.ts`: `periodBounds(start, periodDays, timezone)` using `Temporal` polyfill or
      `date-fns-tz`; `nextPeriod()`; `isEnded(period, now, timezone)`.
- [x] `apps/web/src/plan/rollover.ts`: on app open and on focus, if `period.end < now` run the Firestore
      transaction from spec §7 (create next period with budget snapshot, carry `planned` items with
      `carriedFromId`, advance `currentPeriodId`). Skip when offline with the "period ended" note.
- [x] Household creation (M0) now also creates the first period.

### 2. Settings

- [x] `/settings/household`: name, period length, budget, timezone picker, default servings, planned meal
      types toggles (all per R11.x). Zod-validated; writes `households/{hid}` fields.
- [x] `/settings/tools`: chip list of owned equipment with suggestions (Instant Pot, food processor, sous vide,
      stand mixer, air fryer, …). Recipe detail now flags missing tools (R4.14) and `<CollectionView>` gets
      the "has all tools" filter.

### 3. Meals

- [x] `packages/core/meal.ts` schema for **saved** meals; `meals` collection rules (allowlisted CRUD, public get).
- [x] `/meals`: `<CollectionView>` over a small meal index (built client-side from the `meals` collection;
      no function needed at this scale). `/meals/:id`: recipes with servings multipliers, total time, favourite,
      share, "Add to plan" (opens `<CreateMealSheet>` with the saved meal selected), edit name/recipes.
      There is no standalone "new meal" page: saved meals are born from the create flow (R5.8).
      Prototype page "Meals".
- [x] Deleting a recipe (M1 cleanup) removes it from saved meals and from plan items' recipe lists; verify
      with a functions test.

### 4. Plan page

- [x] `packages/core/plan.ts`: `planItem` schema (`kind`, `recipes[]`, `savedMealId?`, spec §4.2);
      `coverageFor(item, recipes, household)` → `{ dinner: 1, lunch: n }` per spec §7 (leftover portions summed
      across the item's recipes); `stripModel(items, period, plannedMealTypes)` → rows, filled cells, counts,
      overflow.
- [x] `<CreateMealSheet>` (R5.7, R5.8): primary button on `/plan`. Tab *Recipes*: `<CollectionView>` in
      multi-select mode, Suggested sort first (placeholder order until M5), selected recipes pinned at the top
      with a per-recipe multiplier. Tab *Saved meals*. Then meal type (from `plannedMealTypes` + snack),
      servings (default `defaultServings`), optional name + "Save as meal" toggle. "Add to plan" writes the
      plan item (and the `meals/{id}` doc when saving). Preselect support for the recipe shortcut.
- [x] `/plan`: `<CoverageStrip>` (non-interactive, labelled day cells, solid = cooked/eaten, outlined =
      planned, overflow "+n"), `<BudgetMeter>` (sticky; see §6), the plan list with `<CollectionView>`
      (filter/sort the planned items), empty state from the prototype with Create meal, per-item sheet to
      change servings/meal type, "Save as meal" for unsaved multi-recipe items, remove.
- [x] "Add to plan" buttons on recipe pages and cards (preselect in `<CreateMealSheet>`) and on saved meals.
- [x] Landing redirect now real: `/` → `/plan` when the current period has items.
- [x] Desktop layouts: 2 columns at `lg`, 3 at `xl` (plan · suggestions placeholder · budget/protein summary
      placeholder) matching the prototype's desktop mode.

### 5. Stores, sourcing rules, brand mappings

- [x] `/settings/stores`: list with kind (`pcExpress` | `inStore`) and `bulk` flag; seeded on household
      creation with "PC Express (Loblaws Greenbank Road)" and "Costco (in store, bulk)"; default store setting.
      PC Express store picker is M5; for now the store has a name and the default `pcxStoreId` from core config.
- [x] Sourcing rules: by category or by ingredient → store. UI on the same page.
- [x] `/settings/brands`: table of ingredient → product name, pack amount + measure, store. Manual entry
      now; M5 adds the PC Express product search. Prototype "Settings → Brands".

### 6. Prices and budget (estimates)

- [x] `data/price-estimates.json`: `$ per kg` or `$ per unit` per seeded ingredient (CAD, Ottawa, rough).
      Script to flag ingredients without an estimate.
- [x] `packages/core/pricing.ts`: `resolvePrice(ingredient, mapping?, livePrices?, estimates)` → cents per
      canonical unit with a `source` tag (`live` | `estimate` | `unknown`). Live is always undefined until M5.
- [x] `packages/core/budget.ts`: `marginalCost(item, supply, incoming, mappings, prices)` using shortfall packs
      from the grocery builder; `spent(plan, …)`; "price unknown" count for the meter.
- [x] `<BudgetMeter>`: `budget − spent`, red below zero, "n prices unknown" hint; never blocks adding.

### 7. Grocery builder and page

- [x] `packages/core/grocery.ts`: `buildList({ planItems, recipes, meals, ingredients, supply, incoming,
      mappings, rules, stores, manualItems })` implementing the spec §8 formula (needs − unexpired supply −
      incoming, pack size from mapping → default pack → raw, store resolution order, free-use excluded).
      Deterministic item IDs (`ingredientId` or `manual_<uuid>`) so regeneration preserves ticks.
- [x] `/grocery`: generated list grouped by store, per-item tick (field update on the items map, live for
      everyone), manual add (ingredient picker or free text), regenerate (keeps manual items and ticks),
      quantities in metric + imperial with pack counts and product names. Costco section as an in-store
      checklist. Prototype "Grocery" page, phase "order".
- [x] Copy button: formats the `pcExpress` section as in spec §8, copies to clipboard, sets `status: ordered`
      + `orderedAt`, toast with Undo (back to `draft`). "Mark ordered without copying" for completeness.
- [x] Ordered lists feed `incoming` into the builder and the budget. Receiving is M3.

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

- [ ] Owner plans a 7-day period on a phone in under 10 minutes using Create meal: three one-recipe dinners,
      one three-recipe taco night saved as a meal, and one dinner from that saved meal; sees 5/7 and a budget
      that goes down, copies the list into ChatGPT, and it reads cleanly.
      (The same flow passes in Playwright on phone-ios and phone-android: meals.spec.ts, plan.spec.ts, grocery.spec.ts.
      The timed run on a real phone and pasting into ChatGPT are the owner's.)
- [x] Two members see each other's ticks on the Grocery page live. (grocery.spec.ts "ticks show up live", NFR5.)
- [x] Period rolls over on the configured boundary with uncooked items carried. (rollover.spec.ts, incl. two members
      at once; boundaries across DST in packages/core/src/period.test.ts.)

## Risks and notes

- Without supply, the budget meter never goes back up in M2; that's expected and documented in R6.3.
- Price estimates are rough; the meter's accuracy improves in M5 with live prices. Don't polish estimates.

## Deviations and decisions (2026-10-10)

- **No price upload:** `data/price-estimates.json` (all 475 seeded ingredients, each the price of its default pack plus a
  derived `centsPerUnit`) is bundled into the web app: no Firestore reads, works offline. `pnpm prices:check` flags
  missing or unknown IDs and unconvertible packs; `-- --write` refreshes `centsPerUnit`. M5's live prices go in front.
- **Rollover:** periods are keyed by their local start date, so concurrent rollovers write the same document; carried
  copies are `<newPeriodId>_<fromItemId>` and the originals stay in the old period untouched. The same client
  bootstrap creates the first period and the default stores for households that have none (the owner's live
  household, and e2e households seeded without them). A budget change in Settings also updates the current period's
  snapshot; a new period length applies from the next period.
- **Grocery list documents:** the draft is `groceryLists/draft`, regenerated field by field while the Grocery page is
  open. Copy moves every item (all stores) into a new list with `status: ordered`, `orderedAt`, `orderedBy`; the Costco
  checklist travels with the order and stays tickable there. Undo moves the items back (ticks kept) and deletes the
  ordered list. A blocked clipboard shows the text in a sheet with "I copied it · mark ordered".
- **Manual lines** are free text, or an ingredient bought in whole packs (priced, but outside the budget, R6.4).
- **Cost per serving filter and Cheapest sort** are now live (estimates, no pack rounding), and **"Have the tools"**
  is a new filter. Both read two new index-summary fields, `tools` and `lines` (a map: Firestore can't store nested
  arrays, which the first try hit). Summaries written before M2 are refreshed by the weekly maintenance function
  (new step `refreshSummaries`), not a one-off script.
- **Recipe cleanup** now recomputes a plan item's coverage after removing a deleted recipe from it.
- **Rules:** periods, plan items, and stores use `isMemberAfter` (existsAfter on the member doc) so the creation batch
  can write them; clients create plan items as `planned` and can't change their status (M3 commands will).
- **Coverage:** leftover portions are the recipe's estimate, summed across a meal's recipes, not scaled by servings.
- **Suggestions placeholder:** the newest recipes not yet planned, each with a "+" into Create meal; **protein summary**
  shows plan averages per meal type without goals (goals are M5).
- **Plan item status changes, Cook buttons, expiry badges, pending reviews** are M3; the item card has Edit and
  remove (with Undo in the banner) instead.
- **Banners can carry an action** (Undo) in addition to a link.
- **Visual baselines** for the Recipes library were regenerated: recipe cards gain the "+ Add to plan" button.

## Design-compare notes (phone 430×932, desktop 1920×1080, Latte)

Compared with the prototype's Plan, Meals, Grocery (order phase), Settings, and Add to plan sheet. Matched: page
headers (kicker + Archivo Black), the desktop Plan's three columns (plan · suggested · budget/protein), plan item
cards (title, TO COOK badge, mono meta, badges, recipe rows, footer bar with cost), the phone budget bar under the
header, meal cards (two-up image strip, badges, recipe rows, star / Copy link / + Plan), grocery store cards (ink
header with total, rows with ×n), the Add to plan sheet (title, 2×2 meal-type chips, budget impact, full-width button).

Intentional differences:

- **Coverage strip** is not in the prototype; built as a card in its language (labelled day columns, solid accent =
  cooked, outlined = planned, dashed = open, "n/N · +k").
- **Create meal** has a pick step the prototype lacks (multi-select with multipliers, Saved meals tab) before its
  Add to plan sheet; the details step adds servings, Save as meal, and name.
- **Grocery rows** all have a tick box (the prototype ticks only Costco) because ticks are live for every member; the
  sub-line shows need → packs in metric and imperial; the staples prompt, "Groceries arrived? Confirm", and receipt
  phase are M3/M5. Ordered lists show below the draft with "Undo order".
- **Settings** stay separate pages (M0 decision) styled as the prototype's cards; stores and sourcing rules have their
  own page with per-category selects, brands a table plus form.
- Not shown yet: Pending reviews, Use it or lose it, Budget optimiser, protein goals, Cook buttons (M3/M5).
