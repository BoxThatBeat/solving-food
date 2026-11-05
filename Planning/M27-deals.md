# M27 — Deal awareness

Status: in progress

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
- [ ] **5. UI**: Brands row chip; grocery line chip and "on sale" staple reason; suggestion and plan cards' Deal chip;
      reasons line; Settings → Suggestion weights lists "On sale"; History → Prices card.
- [ ] **6. E2E** tagged @R6.32 @R6.33 @R6.34 @R7.19 @R10.4.
- [ ] **7. Docs**: PRD, spec, README row, this plan.
- [ ] **8. Screenshot check** on phone (430×932) and desktop (1920×1080).

## Deviations

## Verification
