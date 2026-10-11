# M5 — Smarts

Status: done (exit criteria 3 and 4 wait on the owner: PC Express secrets, two weekly refreshes, a month of billing)

## Goal

The app starts making decisions easier: suggestions ranked by expiry, supply, taste, variety, protein and
cost; tunable weights with presets; the "n dinners under $x" optimiser; expiry alerts; the staples cadence
prompt; and live PC Express prices with in-app store and product search. After M5 the product is feature
complete against the PRD.

## Requirements covered

R3 step 1 (Suggested sort everywhere), R4.2 (Suggested sort), R6.11–R6.14, R6.16–R6.22, R7.7, R7.10, R11.2,
R11.3, R11.4.

## Prerequisites

M3 done (supply, stats, ratings exist). M4 is not required. PC Express credentials set by the owner in Secret
Manager before the price work starts (`PCX_EMAIL`, `PCX_PASSWORD`).

## Deliverables

1. `packages/core/scoring` with all factors, weights, presets; Web Worker; Suggested sort in `<CollectionView>`.
2. Settings: food preferences, suggestion weights with presets, protein goals; Plan page protein summary.
3. Expiry alerts on Plan with suggestions that use the expiring item.
4. Optimiser with Next/Back/Accept and exhaustion.
5. Staples cadence prompts.
6. PC Express module: auth, store search, product search, price lookup, weekly refresh in the maintenance job;
   store picker and product search UI; live prices in the budget with estimate fallback.

## Work breakdown

### 1. Scoring

- [x] `packages/core/scoring/factors.ts`: one pure function per factor in spec §7 table, each returning
      [0, 1], with the inputs they need (projected supply with lot expiries, plan, stats, ratings, favourites,
      preferences, tools, protein goals, prices). `recentlyCooked` and `variety` share a history lookup.
- [x] `packages/core/scoring/index.ts`: `score(recipe, ctx, weights)`; default weights; presets "Use it up",
      "Cheap week", "Adventurous", "Balanced". Dislikes/diets as hard filters; missing tools hard filter.
- [x] `apps/web/src/workers/scoring.worker.ts`: receives a snapshot of ctx, returns ordered IDs; debounced
      300 ms on data changes. `useSuggestions(filterIds?)`.
- [x] `<CollectionView>`: Suggested sort uses the worker on the current filtered set (Recipes, Meals, Plan add
      sheet). Plan page "Suggested" section with the prototype's card row and "why" chips (top two factors).

### 2. Preferences, weights, protein

- [x] `/settings/preferences`: likes, dislikes, dietary restrictions (chips with ingredient/cuisine picker).
      Prototype "prefKind".
- [x] `/settings/weights`: slider per factor + preset buttons (prototype `SET.preset`); stored in
      `settings.scoreWeights`.
- [x] Protein goals per planned meal type with on/off; `<ProteinSummary>` on Plan (average per meal type vs.
      goal) and the "meets protein goal" factor and optimiser toggle.

### 3. Expiry alerts

- [x] Plan page alert card: supply lots expiring within the period that no planned item uses, with the
      quantity and a "Recipes that use it" row sorted by `expiryUrgency`. Dismiss per lot for the period.

### 4. Optimiser

- [x] `packages/core/optimiser.ts`: set score (Σ scores + overlap bonus − repeat penalties), hard constraints
      (n items, cost ≤ x via the grocery builder's marginal cost with shared shortfall, per-cuisine and
      per-protein caps, protein toggle), greedy + local search from randomised starts, good-set threshold 80 %
      of best (config), diversity by Jaccard < 0.5, streaming results, stop on 200 fruitless attempts or time
      budget, lazy continuation. Deterministic with a seed for tests.
- [x] `apps/web/src/workers/optimiser.worker.ts` and `<OptimiserSheet>`: n, $x, meal type, protein toggle;
      Next / Back / Accept; "No more good combinations" with relax options; Accept writes plan items in a batch.

### 5. Staples cadence

- [x] `packages/core/cadence.ts`: EMA update (already called by `receiveGroceries` in M3), `isDue(cadence,
      ingredient, now)` using `defaultCadenceDays` when fewer than two purchases.
- [x] Prompt card on Grocery and Plan: "Are you out of milk?" → Yes adds to the draft list (source `cadence`)
      / Not yet snoozes (`snoozedUntil = now + interval/4`). Staples group on Supply shows the expected run-out.

### 6. PC Express module

- [x] `functions/src/pcx/`: `client.ts` (sign-in with the Secret Manager credentials, token cache in memory
      and in `pcxSession/state` doc, refresh), `stores.ts` (search), `products.ts` (search at a store),
      `prices.ts` (lookup by product code at a store). All endpoints and headers isolated in `endpoints.ts`.
      Stub server in `functions/test/pcxStub/` with canned responses and failure modes, used by emulator tests
      and e2e.
- [x] Callables `pcxSearchStores(query)` and `pcxSearchProducts(query, pcxStoreId)` (members only, rate
      limited per uid to keep calls low).
- [x] Maintenance function: add the weekly price refresh over distinct `(pcxStoreId, productCode)` pairs;
      failures leave old prices and notify the owner (`OWNER_UID` param). Alert on two consecutive failures
      (Cloud Monitoring log-based alert; document in `SETUP.md`).
- [x] Core config: look up Loblaws Greenbank Road's store ID once with the store search and commit it as the
      default `pcxStoreId`. (Resolved at runtime instead: see Deviations.)
- [x] UI: `<PcxStorePicker>` on `/settings/stores`; `<PcxProductSearch>` on `/settings/brands` (name, pack,
      image, current price → saves mapping fields and writes `prices/*`).
- [x] `resolvePrice` now prefers live prices ≤ 14 days old; the budget meter shows the source mix.

## Data & rules introduced

`prices` (function-only), `households/*/cadence` reads, `settings.scoreWeights`, `preferences`,
`proteinGoals`. Secrets `PCX_EMAIL`, `PCX_PASSWORD`. Cloud Scheduler job count stays 1.

## Tests

- Unit: every factor against hand-built fixtures; weights/presets; optimiser (constraints, threshold,
  diversity, exhaustion, determinism with seed); cadence math; price resolution order and staleness.
- Functions: PC Express module against the stub (sign-in, refresh, search, price, failure), maintenance
  refresh and notification, callables' auth.
- E2E: `suggestions`, `optimiser`, `prices`, `grocery` (cadence prompts), `settings` (preferences, weights,
  protein goals), `plan` (protein summary, expiry alerts).

## Exit criteria

- [x] With salmon expiring in two days, the Plan page says so and the top suggestion uses it.
- [x] "4 dinners under $60" returns a set that the household would actually eat; Next gives a different one.
- [ ] Brand mapping for canned tomatoes links a real PC Express product with a live price; the budget meter
      uses it; the weekly job refreshes it with no errors for two consecutive weeks.
- [ ] A month of use stays at $0 on the billing dashboard.

## Risks and notes

- PC Express endpoints are undocumented and may change or be blocked; the module is isolated and the app
  falls back to estimates. If sign-in requires interactive 2FA, the fallback is manual price entry on the
  brand mapping page (add that field only if needed).
- Scoring quality is subjective: ship defaults, then tune weights from real use. Presets are the escape hatch.

## Verification (2026-10-10, local, Emulator Suite)

| Layer | Result |
|---|---|
| Lint (`pnpm lint`) | clean, 0 warnings |
| Typecheck (`pnpm typecheck`) | clean |
| Unit (`pnpm test`) | core 319 passed (24 files; M5 adds scoring 23, optimiser 11, smarts 16, marginal cost 1), web 7 passed |
| Rules (`pnpm test:rules`) | 94 passed (7 files; `smarts.test.ts` new) |
| Functions (`pnpm test:functions`) | 53 passed (9 files; `pcx.test.ts` 14 new, against the stub) |
| Requirement tags (`pnpm e2e:coverage`) | M0–M5 all tagged; every R-ID in the PRD (and NFR5, NFR6) has a tagged test |
| E2E phone-ios | full run 118 passed, 27 failed, 6 skipped; the 27 (late specs: settings, sharing, suggestions, supply, theme, timers, review, rollover; emulator timeouts and RST_STREAM as in M4) re-run: 25 passed, 2 real failures fixed (old specs expecting "Uses expiring" disabled and a now-ambiguous PRODUCT label), then 2 passed. After the phone layout change: plan, suggestions, preferences, optimiser, cadence, prices, core-loop, responsive 32 passed, 1 skipped |
| E2E desktop-1080p | full run 121 passed, 28 failed, 2 skipped; the 28 (same late-run emulator degradation) re-run: 28 passed |
| E2E other projects | phone-android full run 122 passed, 28 failed (same late-run degradation); re-run of those files 138 passed, 4 failed (timers, visual: emulator degradation again), then timers + visual alone 7 passed. tablet 9 passed, desktop-4k 8 passed, desktop-4k-2x 8 passed, desktop-firefox 18 passed + 1 (data-transfer) passed on re-run |

## Deviations and decisions (2026-10-10)

- **PC Express is not connected.** `PCX_EMAIL` / `PCX_PASSWORD` did not exist in Secret Manager. The module is built and
  tested against a stub; the secrets are bound only when `functions/.env` says `PCX_ENABLED=true` (a deploy that names
  a missing secret fails), so the deployed functions answer "PC Express not connected" and the app prices from the
  estimates. The public web API key (`PCX_API_KEY`) and an optional sign-in URL are configuration the owner reads from
  the website. The endpoints were never called from this project (a one-off store lookup was refused by the session's
  tool policy), so they are unverified: `functions/src/pcx/endpoints.ts` is the file to fix if the first live searches
  fail.
- **Greenbank Road's store ID is not committed.** `DEFAULT_PCX_STORE_ID` stays a placeholder; the functions resolve it
  by searching for "Greenbank" once and cache the real ID in `pcxSession/state`. Prices are keyed by the store ID the
  household stores, so the placeholder works end to end.
- **A failed sign-in doesn't stop prices:** requests then go with the public API key only, and the status line says
  sign-in failed. If sign-in needs interactive 2FA, nothing else changes (manual price entry was not needed).
- **Stub as an in-process fetch** (`functions/src/pcx/stub.ts`, under the emulator and in tests) instead of a stub server
  in `functions/test/pcxStub/`: the Functions emulator runs the bundled code, and a fetch needs no extra port. Failure
  modes are set per household (`_stubPcx/{hid}`), so parallel e2e workers don't disturb each other.
- **Product search writes prices for its results** (≤ 12 writes), so a picked product is priced at once (clients can't
  write `prices/*`); prices nobody refreshed for 60 days are deleted weekly.
- **`pcxStatus` callable** added for the status line on Stores and Brands.
- **Snoozing is a command** (`snoozeCadence`): cadence is function-only. A purchase clears the snooze.
- **Expiry alert dismissals live on the period** (`periods/{id}.dismissedLots`), so they end with the period and are in
  the export (periods are exported). Alerts cover the period or the next four days, whichever is longer; three show,
  then "n more".
- **Missing tools, dislikes, and diets are hard filters** for the Suggested row and the optimiser, but a Suggested
  *sort* still lists blocked recipes (last): a sort never hides. Missing tools has no weight slider.
- **Weights page:** six squares per factor (0 = off) as a radio group, 24 px targets (the prototype's five 22 px blocks).
- **Optimiser as a Plan page card** (the prototype draws it so), not a sheet. It leaves out half of each shown set on
  later attempts so Next finds genuinely different sets, and leaves out recipes that alone exceed the budget. Relax
  options: +$10, one more per cuisine/protein ("Allow repeats"), any protein.
- **Cost factor** is marginal cost against a quarter of the budget left (the spec's "/ remaining budget" made a dinner
  round to nothing). A recipe with nothing tracked counts half missing (it would otherwise look free and top every list).
- **The ingredient seed is bundled into the scoring and optimiser workers** for categories, conversions, and pack sizes
  (no 475-document read); ingredients created in the app are known to them once loaded by the plan model.
- **On phones the Plan page shows alerts and the protein summary before the list** (the prototype's order; M2–M4 had
  them after it).

## Design-compare notes (phone 430×932, desktop 1920×1080, Latte)

Compared the Plan page (Suggested, budget optimiser, expiry alerts, protein summary) and the Settings sections with the
prototype's Plan and Settings screens. Matched: the Suggested cards (64 px thumb with the ink score badge, title, mono
"MIN · G · +$" line, 9–10 px mono chips: peach for expiry, accent for reasons, grey for the lowering one, the accent +
button), the "WEIGHTS: BALANCED" link, the optimiser card (stepper, meal type, "under", $ stepper, protein checkbox,
Find sets, the ink "SET n · $ TO BUY" bar, mono SHARES footer, Back / Next / Accept · add n), the peach "USE IT OR LOSE
IT" card with recipe rows and + buttons, the protein bars (accent at goal, peach below, "✓"/"↓"), and the yellow
STAPLES prompt.

Intentional differences:

- The meal type is a native select (the prototype cycles it on tap); steppers are 44 px (hit targets).
- Alerts have Dismiss instead of the prototype's ❄ Freeze (freezing stays on the Supply page).
- Preferences, weights, protein goals, stores, and brands are separate Settings pages (as since M2) in the same card
  language; diets are toggle chips rather than the prototype's free-text RESTRICTION entries (diets need fixed rules).
- The PC Express store picker and product search are not in the prototype; they use the app's card, input, and list row
  styles.

## Deploy (2026-10-11)

`firebase deploy --only hosting,functions,firestore,storage`: hosting, Firestore rules and indexes, Storage rules, and
every function updated; `pcxSearchStores`, `pcxSearchProducts`, `pcxStatus` created (no secrets bound: PC Express off).
The first attempt failed in non-interactive mode for want of an `OWNER_UID` value (a param default isn't used
non-interactively); it is now in `functions/.env`. https://solvingfood.web.app → 200; `healthcheck` → `{"ok":true}`.

## What's left for the owner

1. **Connect PC Express** (SETUP.md "M5 operations"): set the `PCX_EMAIL` and `PCX_PASSWORD` secrets, put
   `PCX_ENABLED=true` and the website's public `PCX_API_KEY` in `functions/.env`, commit, deploy functions. Then pick
   Loblaws Greenbank Road in Settings → Stores and link products in Settings → Brands. If the first searches fail, the
   endpoints need fixing (`functions/src/pcx/endpoints.ts`).
2. **Create the log-based alert** for `pcx refresh failed twice` (SETUP.md).
3. **Exit criteria on the live app:** the canned-tomatoes mapping with a live price, two clean weekly refreshes, and a
   month at $0 on the billing dashboard.
4. Push the commits (CI deploys).
