# M27 — Deal awareness

Status: done (owner: look at Settings → Brands and History → Prices after the first two or three Monday refreshes; deals need 4 prices)

## Goal

Prices are refreshed weekly per mapped PC Express product (maintenance, M5/M14), and since M25 each received line and
brand mapping carries the price paid. Nothing remembered prices over time or told the household when something is
cheap. Keep a short price history per brand mapping, work out the usual price and when a product is on sale, and use it:
chips on brands, grocery lines and suggestion cards, a suggestion factor, staples pulled forward when on sale, and a
Prices card on History.

## Requirements covered

New: **R6.32** (price history, usual price, on sale), **R6.33** (Deal chips: Settings → Brands, the grocery line, the
suggestion and plan cards), **R6.34** (the "On sale" suggestion factor and its reason), **R7.19** (an on-sale staple due
within two periods pulled forward while the budget has room), **R10.4** (History → Prices: this week's five biggest
movers). Changed: R6.11 (the factor table), R6.12/R11.3 (the weights list), R7.12 (staple reasons), R7.17 (the paid
price feeds the history). PRD v0.13. Spec §2 (quota rows), §4.2 (`brandMappings.priceHistory`), §7 (factor, weights),
§8 ("Price history and deals", staples), §13 (maintenance), §14.1, §15.

## Items

- [x] **0. CI for M26.** The Checks run for 21fc3f1 failed on the @R3.4 note test (all projects): M26's item 10 made
      "400 g" non-breaking and the test's regex had a plain space. Fixed in its own commit, noted under M26's Deviations.
- [x] **1. Core** `packages/core/src/priceHistory.ts`: `appendObservation` (bounded `PRICE_HISTORY_MAX` = 16, a second
      PC Express price the same week replaces the first), `priceDeal` (usual = median of the observations before the
      current price; current = the live price at the store when fresh, else the newest observation; on sale =
      `DEAL_THRESHOLD` 15 % below usual with `DEAL_MIN_OBSERVATIONS` = 4, a current PC Express price), `dealsFromMappings`,
      `priceMovers`, `dealLabel`. Scoring: `onSale` factor and `saleUses` (`factors.ts`), weight `onSale` (Balanced 2,
      Cheap week 4, Use it up 1, Adventurous 1; stored weights without it keep their preset), the reason label
      ("Chicken thighs 20% below usual") and `ScoreResult.deal` for the card chip. Staples: `sale` input on
      `dueStaples` / `stapleLines` (reason `sale`, headroom shared). Unit tests: `priceHistory.test.ts`, scoring, grocery
      (staples on sale; the deal price in the list, meter and marginal cost).
- [x] **2. Functions**: `refreshPrices` (maintenance) appends the week's price to every brand mapping of the product
      (`mappedPairs` keeps the mapping refs; report `histories`); `receiveGroceries` appends the paid price per pack
      (source `receipt`) with `lastPaidCents`. The stub's `_stubPcx/{hid}.prices` apply to that household only. Functions
      tests: `pcx.test.ts` (history appended per mapping, a second run the same week replaces), `commands.test.ts`.
- [x] **3. Rules**: a member's edit of a brand mapping may keep the function-written `priceHistory`, `lastPaidCents`,
      `lastPaidAt` exactly (a merge) or drop them (a replace), never set them. Rules test in `plan.test.ts`.
- [x] **4. Web data**: `deals` in the plan model (`dealsFromMappings` over the mapping docs and live prices, both views);
      the worker snapshot carries only the on-sale ingredients (`deals: [id, { dealPct }]`) and the worker prices them
      with `linePricing` from its build context; `saveMapping` merges when the product (code and pack) is unchanged.
- [x] **5. UI**: `<DealChip>` ("20% below usual · usual $1.99", accent badge) on Settings → Brands rows and grocery lines;
      staple reason "on sale, due soon"; a Deal badge on suggestion cards (`ScoreResult.deal`) and planned meals
      (`mealDeal`); the reason "Chicken thighs 20% below usual"; Settings → Suggestion weights lists "On sale" (from
      `FACTORS`); History → **Prices · this week vs usual** tile (`priceMovers`, from the shell's plan model: no reads).
- [x] **6. E2E**: prices.spec (@R6.32 @R6.33: a stubbed drop via `_stubPcx/{hid}.prices`, brand row, saving the same
      product keeps the history, grocery line, planned meal), suggestions.spec (@R6.34 @R6.33: reason, Deal, the weight),
      history.spec (@R10.4: movers up and down, stale and unchanged left out, empty state), cadence.spec (@R7.19: pulled
      forward, gone without budget room). Each test gets its own PC Express store ID (`ownPcxStore`) so other tests'
      prices docs can't change its live prices.
- [x] **7. Docs**: PRD v0.13 (R6.32–R6.34, R7.19, R10.4; R6.11 table, R7.17), spec §2, §4.2, §7, §8, §13, §14.1, §15,
      README row, this plan.
- [x] **8. Screenshot check** (dev emulator with seeded histories and live prices; phone 430×932, desktop 1920×1080):
      Plan (Deal on the planned meal, Deal + reason on suggestions), Grocery (chips on the chicken line and the pulled
      milk staple), Settings → Brands (chip under the live price), History (Prices tile). Fixed: History's fourth tile sat
      alone on a row at 1920 px (now four columns from 2xl); Deal badges wrap instead of overflowing a phone card.

## Deviations

- **History lives on the brand mapping, not the price doc.** The mapping is per household and covers products without a
  PC Express code (Costco lines with a receipt price); the client already listens to it, so History and the chips need
  no new reads. Cost: the weekly refresh writes each mapping of a refreshed product once (~50 writes a week), §2 row.
- **"Current" is the live price when there is one.** The product search writes a fresher `prices/*` doc than the weekly
  history, so `priceDeal` takes the live price as current and every history entry before it as usual; the weekly
  observation written with the same timestamp isn't counted twice.
- **Receipts count toward usual but are never a deal** (they are what was paid, not what it costs now).
- **4 observations include the current one** (three earlier prices plus today's).
- **Deal chip rule:** the brief's "main protein" is read as a meat or fish ingredient the order buys (`mainProtein` is a
  taxonomy value, not an ingredient); otherwise the most expensive line to buy. Cheap garnish on sale gets no chip.
- **The factor is skipped while nothing is on sale** (like a goal that's off), so the card's 0–100 score doesn't drop for
  every recipe when the household has no deals.
- **Staples pull-forward needs a learned interval** (bought before) and uses the meter's `remainingCents` as headroom,
  shared in list order; it doesn't count against the budget, like every staple.
- **Optimiser unchanged**: a core test shows the sale price reaches the list, the meter and `marginalCostFn`.
- **No local e2e** (owner rule change mid-milestone: the machine's memory kills the runs). One early local run of the new
  tests found two test bugs (tomato vs tomatoes; another run's copy of the recipe tying at 100), fixed; CI runs the matrix.
- **Stub prices per household**: `_stubPcx/{hid}.prices` used to fill a module-global override other tests saw.

## Verification

- Typecheck, lint: clean. `pnpm e2e:coverage`: green, M27 tagged.
- Unit: core 732 → 747 (`priceHistory.test.ts` 9, scoring +3, grocery +2, mealDeal 1), web 48.
- Functions: 93 → 94 (pcx history appended per mapping and once per week; receive appends the paid price).
- Rules: 104 (brand mapping test extended: function-written fields kept by a merge, dropped by a replace, never set).
- E2E: see the CI run in the report (not run locally, deviation above).
