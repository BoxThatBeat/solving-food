# M5 — Smarts

Status: not started

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

- [ ] `packages/core/scoring/factors.ts`: one pure function per factor in spec §7 table, each returning
      [0, 1], with the inputs they need (projected supply with lot expiries, plan, stats, ratings, favourites,
      preferences, tools, protein goals, prices). `recentlyCooked` and `variety` share a history lookup.
- [ ] `packages/core/scoring/index.ts`: `score(recipe, ctx, weights)`; default weights; presets "Use it up",
      "Cheap week", "Adventurous", "Balanced". Dislikes/diets as hard filters; missing tools hard filter.
- [ ] `apps/web/src/workers/scoring.worker.ts`: receives a snapshot of ctx, returns ordered IDs; debounced
      300 ms on data changes. `useSuggestions(filterIds?)`.
- [ ] `<CollectionView>`: Suggested sort uses the worker on the current filtered set (Recipes, Meals, Plan add
      sheet). Plan page "Suggested" section with the prototype's card row and "why" chips (top two factors).

### 2. Preferences, weights, protein

- [ ] `/settings/preferences`: likes, dislikes, dietary restrictions (chips with ingredient/cuisine picker).
      Prototype "prefKind".
- [ ] `/settings/weights`: slider per factor + preset buttons (prototype `SET.preset`); stored in
      `settings.scoreWeights`.
- [ ] Protein goals per planned meal type with on/off; `<ProteinSummary>` on Plan (average per meal type vs.
      goal) and the "meets protein goal" factor and optimiser toggle.

### 3. Expiry alerts

- [ ] Plan page alert card: supply lots expiring within the period that no planned item uses, with the
      quantity and a "Recipes that use it" row sorted by `expiryUrgency`. Dismiss per lot for the period.

### 4. Optimiser

- [ ] `packages/core/optimiser.ts`: set score (Σ scores + overlap bonus − repeat penalties), hard constraints
      (n items, cost ≤ x via the grocery builder's marginal cost with shared shortfall, per-cuisine and
      per-protein caps, protein toggle), greedy + local search from randomised starts, good-set threshold 80 %
      of best (config), diversity by Jaccard < 0.5, streaming results, stop on 200 fruitless attempts or time
      budget, lazy continuation. Deterministic with a seed for tests.
- [ ] `apps/web/src/workers/optimiser.worker.ts` and `<OptimiserSheet>`: n, $x, meal type, protein toggle;
      Next / Back / Accept; "No more good combinations" with relax options; Accept writes plan items in a batch.

### 5. Staples cadence

- [ ] `packages/core/cadence.ts`: EMA update (already called by `receiveGroceries` in M3), `isDue(cadence,
      ingredient, now)` using `defaultCadenceDays` when fewer than two purchases.
- [ ] Prompt card on Grocery and Plan: "Are you out of milk?" → Yes adds to the draft list (source `cadence`)
      / Not yet snoozes (`snoozedUntil = now + interval/4`). Staples group on Supply shows the expected run-out.

### 6. PC Express module

- [ ] `functions/src/pcx/`: `client.ts` (sign-in with the Secret Manager credentials, token cache in memory
      and in `pcxSession/state` doc, refresh), `stores.ts` (search), `products.ts` (search at a store),
      `prices.ts` (lookup by product code at a store). All endpoints and headers isolated in `endpoints.ts`.
      Stub server in `functions/test/pcxStub/` with canned responses and failure modes, used by emulator tests
      and e2e.
- [ ] Callables `pcxSearchStores(query)` and `pcxSearchProducts(query, pcxStoreId)` (members only, rate
      limited per uid to keep calls low).
- [ ] Maintenance function: add the weekly price refresh over distinct `(pcxStoreId, productCode)` pairs;
      failures leave old prices and notify the owner (`OWNER_UID` param). Alert on two consecutive failures
      (Cloud Monitoring log-based alert; document in `SETUP.md`).
- [ ] Core config: look up Loblaws Greenbank Road's store ID once with the store search and commit it as the
      default `pcxStoreId`.
- [ ] UI: `<PcxStorePicker>` on `/settings/stores`; `<PcxProductSearch>` on `/settings/brands` (name, pack,
      image, current price → saves mapping fields and writes `prices/*`).
- [ ] `resolvePrice` now prefers live prices ≤ 14 days old; the budget meter shows the source mix.

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

- [ ] With salmon expiring in two days, the Plan page says so and the top suggestion uses it.
- [ ] "4 dinners under $60" returns a set that the household would actually eat; Next gives a different one.
- [ ] Brand mapping for canned tomatoes links a real PC Express product with a live price; the budget meter
      uses it; the weekly job refreshes it with no errors for two consecutive weeks.
- [ ] A month of use stays at $0 on the billing dashboard.

## Risks and notes

- PC Express endpoints are undocumented and may change or be blocked; the module is isolated and the app
  falls back to estimates. If sign-in requires interactive 2FA, the fallback is manual price entry on the
  brand mapping page (add that field only if needed).
- Scoring quality is subjective: ship defaults, then tune weights from real use. Presets are the escape hatch.
