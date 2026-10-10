# M3 — Supply & Cooking

Status: not started

## Goal

Close the loop. Groceries confirmed as received become supply; cooking from the step view and finishing a
meal subtracts from supply and records leftovers; reviews correct the numbers and rate the meal; expiry is
tracked per lot and expired lots are prompted about; the History page shows what was cooked. This is the
largest milestone and is split into three phases that each ship something usable.

## Requirements covered

R4.3, R4.4, R4.5 (cook stats), R4.9, R4.10, R4.12, R4.23, R4.24, R5.3, R5.6, R6.7, R6.8–R6.10, R7.8, R7.9,
R8.1–R8.15, R9.1–R9.5, R10.1–R10.3, R3 steps 4–6, NFR5 (supply and plan live), spec §12 Offline.

## Prerequisites

M2 done. VAPID public key in `SETUP.md`. Cloud Tasks queue `timers` created in `us-east1` (by the deploy of
the functions; document in `SETUP.md`).

## Deliverables

- **Phase A — Ledger:** command infrastructure, supply ledger math, Supply page, manual add/correct/discard/
  freeze/thaw, transaction history, receive groceries with the freeze prompt, projected supply, supply-based
  recipe filters and badges, expiry flags and the expired-lot prompt.
- **Phase B — Cooking:** meal cook view, mise en place, step mode with layouts and wake lock, timers
  (foreground + Cloud Tasks + FCM push), Done cooking → `finishCooking`, review sheet → `submitReview`,
  leftovers as supply and plan items, mark eaten, pending reviews.
- **Phase C — History:** History page with filters, stats, spend per period; cook stats on recipe cards.

## Work breakdown

### Phase A — Ledger

- [ ] `packages/core/commands.ts`: zod schemas for every command in spec §6 (`addSupply`, `receiveGroceries`,
      `finishCooking`, `submitReview`, `correctSupply`, `discard`, `extendExpiry`, `freeze`, `thaw`,
      `markEaten`, `importHousehold` placeholder). Shared by rules (`validCommand` mirrors the shape checks),
      client, and functions.
- [ ] `packages/core/ledger.ts`: pure functions over a supply document: `applyPurchase`, `consumeFEFO`
      (skip expired unless nothing else, never below zero per lot), `applyCorrection`, `discardLot`,
      `freezeLot`/`thawLot`, `extendExpiry`, `recomputeAmount`, `nextExpiry`, `activeExpiry(lot)`,
      `isExpired(lot, now, tz)`, `unexpiredAmount`. Property tests: Σ transactions == amount; FEFO invariants.
- [ ] `packages/core/expiry.ts`: `estimateExpiry(ingredient, location, acquiredAt)`, leftover shelf lives
      (4 d fridge / 90 d frozen) from config.
- [ ] `functions/src/commands/`: `onDocumentCreated(households/{hid}/commands/{id})` dispatcher → handler per
      type inside a Firestore transaction; writes transactions, updates supply doc, marks command
      `applied`/`failed` with error. Idempotency: handlers check target state (plan item already cooked, list
      already received). Admin helper `supplyRef(hid, ingredientId | leftover_<eventId>)`.
- [ ] Client command layer: `useCommand()` writes the command doc (queues offline), tracks pending commands,
      and `useProjectedSupply()` overlays pending command effects optimistically. "Syncing" indicator from
      `hasPendingWrites`.
- [ ] `/supply`: list grouped by location with filters (location, category, expiring soon, low stock),
      each row `current (projected)` in metric + imperial, expiry flag (fresh / use soon / expired), Staples
      group for free-use ingredients (last bought, expected run-out), `<ExpiredLotPrompt>` rows. Prototype
      "Supply" page.
- [ ] `/supply/:id`: lots with expiry and location, `<SupplyAdjust>` (typed amount, ±5/±25 or ±1, Apply →
      `correctSupply`), discard, freeze/thaw with amount, `<LedgerList>` infinite scroll (25 per page).
      Prototype sheet "sup".
- [ ] Add supply: ingredient picker → allowed measurements → amount → location → `addSupply`.
- [ ] Receive groceries (`/grocery` phase "receipt"): list of the ordered list's items pre-ticked as bought,
      quantity edits, substitution (pick another ingredient/product), "didn't arrive"; freeze step when an item
      is from a `bulk` store and `freezable` (prototype "confirm.step === freeze"); submit one
      `receiveGroceries`. Updates cadence (`lastPurchasedAt`, EMA) in the handler.
- [ ] Projected supply on the client: `canonical unexpired − planned uncooked requirements`. Feeds the Supply
      page brackets, `<SupplyBadge>` on recipe ingredients (free-use → "staple"), "can make" marking, the
      "Use what's left" filter, and the grocery builder's `supply` input (replacing M2's empty supply).
- [ ] `<ExpiredLotPrompt>` on Supply and Plan: Still good (`extendExpiry`, +3 d default or date) / Threw it
      out (`discard`).
- [ ] Expiry badge on planned items (`<ExpiryBadge>`, R6.7): earliest-expiring lot the item would use.

### Phase B — Cooking

- [ ] `/meals/:id/cook` and `/recipes/:id/cook` → `<MealCookView>`: recipes with total times, drag or tap to
      order, check off each when done, "Done cooking" early exit. Single recipes skip the ordering step.
- [ ] `<MiseEnPlace>`: prep tasks checklist (from `prepTasks`), then "Start cooking".
- [ ] `<StepMode>`: full screen, one step, inline amounts, that step's ingredients, timers, swipe/tap-edge/
      arrow navigation, Screen Wake Lock, layouts per spec §12 table (phone portrait/landscape, tablet
      portrait, tablet/desktop landscape three panes) chosen by orientation + container size. Text size
      `clamp(1.5rem, 3vw, 4rem)`. Prototype phases "mise" and "steps" in phone, tablet, desktop modes.
- [ ] Timers: `packages/core/timers.ts` (wall-clock end times, pause/resume math). Foreground alarm sound
      (bundled short WAV) + vibration. `functions/src/timers.ts`: callable `scheduleTimer({ endsAt, label,
      recipeId, stepIndex })` → Cloud Tasks task → task handler → FCM web push to `users/{uid}/devices`;
      `cancelTimer`, reschedule on adjust. Service worker: `push` handler shows the notification with an
      "Open" action deep-linking to the step. Device registration on first timer: request notification
      permission, get FCM token with the VAPID key, write `users/{uid}/devices/{token}`. iOS: if not
      installed, show the install prompt before the first timer. Offline: timer runs, banner warns no push.
- [ ] Done cooking: `finishCooking` command (planItemId, recipeIds, servings) → handler consumes FEFO with
      recipe defaults at planned servings, creates leftover lot `leftover_<eventId>` with
      `defaultLeftoverPortions`, creates leftover plan items with coverage, marks plan item `cooked`, creates
      `cookEvents/{id}` with `reviewStatus: pending`. Double-finish guard.
- [ ] `<ReviewSheet>` (prototype phase "review": "Rate it", "What did you use?", "Leftovers"): per-user 1–10
      for the meal and each recipe; used-amounts list pre-filled from the cook event's `used` with edit/
      remove/add; leftovers ▲/▼ from the event's count. Submit → `submitReview` → handler writes ratings,
      updates `stats`, posts `correction` deltas vs. `used`, resizes the leftover lot and its plan items,
      marks review `done` when the reviewer confirmed amounts. Other members' later ratings only add ratings.
- [ ] Pending reviews card on `/plan` listing cook events with `reviewStatus: pending` or where I haven't rated.
- [ ] Mark eaten: on leftover and snack plan items → `markEaten` (leftover lot −1, plan item `eaten`).
      Cooked meals can be marked eaten too (status only).
- [ ] Coverage strip now shows solid cells for cooked/eaten; leftovers appear as plan items (R6.10).
      Leftover plan items roll over unless expired (rollover transaction checks the lot's expiry).

### Phase C — History and stats

- [ ] `/history`: `<CollectionView>` over `cookEvents` joined with ratings: date, meal/recipes (deleted titles
      marked), who cooked, ratings, deviations (used vs. recipe), notes link. Prototype "History" page with
      the "Cooked" list and stat tiles.
- [ ] Stats: most-cooked, average rating by cuisine, spend per period (Σ `estPriceCents` of received lists in
      each period). Computed on the client; `stats/{type_id}` from the functions drives recipe cards
      ("You've made this 14 times", last cooked, household average).
- [ ] `<CollectionView>` "cooked before" filter and rating sort now use `stats`.

### Offline (cross-phase)

- [ ] Workbox runtime caching of images for planned recipes; command queue works offline; e2e `offline.spec.ts`.

## Data & rules introduced

`households/*/supply/**`, `commands`, `cookEvents`, `ratings`, `stats`, `cadence` (function-only except
`commands` create). `users/*/devices`. Storage nothing new.

## Tests

- Unit: ledger (FEFO, expired skipping, corrections, freeze/thaw, extend), expiry estimates, timers math,
  projected supply, review deltas, coverage with leftovers, history stats. Property: ledger invariants.
- Rules: function-only collections rejected for clients; commands create requires `uid == me` and valid shape.
- Functions: every handler (happy path, idempotent repeat, failed validation → `failed` with error),
  `finishCooking` + `submitReview` net effect equals confirmed amounts, timer schedule/cancel with the task
  stub and the push payload.
- E2E: `supply`, `receive`, `recipe-detail` (badges, can-make), `recipes-browse` (supply filters), `cooking`,
  `timers`, `review`, `leftovers`, `history`, `plan` (expiry badges, pending reviews, solid cells),
  `live-sync`, `offline`, `core-loop` (`@smoke`).

## Exit criteria

- [ ] Owner receives a real PC Express order through the confirmation screen, including a Costco chicken
      freeze split; Supply matches the fridge.
- [ ] Cooks a two-recipe meal from a propped-up tablet with a timer that alerts the locked phone.
- [ ] Reviews later that evening from the phone; Supply, History, and "made n times" all update.
- [ ] An expired lot shows the prompt; "Still good" makes it count again.
- [ ] Finishing a meal in airplane mode applies after reconnecting.

## Risks and notes

- iOS web push needs the PWA installed and iOS 16.4+; test on the real phone early in Phase B.
- Cloud Tasks in the emulator is limited; the stub queue must be faithful about schedule/cancel semantics.
- FEFO with mixed frozen/fresh lots: freezing a part of a lot splits it; keep lot splitting in core with tests.
