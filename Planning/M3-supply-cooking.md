# M3 — Supply & Cooking

Status: in progress

All work-breakdown tasks are built, tested, and deployed (2026-10-10); every M3 requirement ID has a tagged Playwright
test (40/40). The exit criteria need the owner's real kitchen, phone, and tablet (see "What's left for the owner");
then set `Status: done` and `pnpm e2e:coverage` enforces the M3 IDs.

## Verification (2026-10-10)

| Layer | Result |
|---|---|
| Lint, typecheck | clean |
| Unit (`pnpm test`) | core 251 passed (21 files; new: ledger incl. fast-check properties Σ transactions == Σ lots / no negative lot / unique lots and the FEFO order invariant, expiry incl. DST, cooking + review net effect property, projected supply and coverage, cadence, pending reviews, timers, history stats, commands, projection, free-use list), web 7 passed |
| Rules (`pnpm test:rules`) | 74 passed (8 new in `tests/rules/supply.test.ts`) |
| Functions on the emulators | 33 passed (12 new: every command handler, idempotent repeats, failed validation with banner, finishCooking + submitReview net effect, out-of-order offline review, timer schedule / cancel / reschedule / fire with the stub queue and push payload) |
| Playwright desktop-1080p | 125 passed, 2 skipped, 1 failed → fixed (a M2 meals spec clicked "Edit", which gave way to "Cook"); a final full re-run was stopped by the session (machine low on memory, 7 GB) and not repeated |
| Playwright phone-ios | 119 passed, 6 skipped, 3 failed → all fixed and re-run green (a11y contrast on small red/peach/blue badges, a unit picker that missed a late-loading ingredient, iPhone install prompt covering the timer controls in a spec) |
| Playwright phone-android | 128 passed, 1 skipped, 0 failed |
| Playwright tablet, desktop-firefox, 4K | not run for M3 (the stopped run above was the last step); cooking.spec.ts covers the tablet layouts by resizing in the other projects |
| `pnpm e2e:coverage` | M3 40/40 requirement IDs tagged |
| Live | `pnpm run deploy` (hosting, functions incl. new `commands`, `scheduleTimer`, `cancelTimer`, `timers`, Firestore rules + indexes, Storage rules); site 200, healthcheck ok, `/sw.js` imports `/push-sw.js`, Cloud Tasks queue `timers` RUNNING in us-east1 |

## What's left for the owner

1. The exit criteria below, on real devices: receive a PC Express order (with a Costco chicken freeze split) and check
   Supply against the fridge; cook a two-recipe meal from the tablet with a timer that alerts the locked phone (install
   the PWA on the iPhone first: Share → Add to Home Screen; allow notifications on the first timer); review from the
   phone; check an expired lot's prompt; finish a meal in airplane mode and reconnect.
2. Sign-off on feel (Supply, cooking, review, History, confirm groceries).
3. Run the remaining Playwright projects once (`pnpm e2e --project=tablet --project=desktop-firefox
   --project=desktop-4k --project=desktop-4k-2x`, and a final `--project=desktop-1080p`), one at a time on this
   machine, or let CI do it after pushing.
4. Push `master` (still open from M0–M2), plus the M1 skill import test and M2's phone checks.

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

- [x] `packages/core/commands.ts`: zod schemas for every command in spec §6 (`addSupply`, `receiveGroceries`,
      `finishCooking`, `submitReview`, `correctSupply`, `discard`, `extendExpiry`, `freeze`, `thaw`,
      `markEaten`, `importHousehold` placeholder). Shared by rules (`validCommand` mirrors the shape checks),
      client, and functions.
- [x] `packages/core/ledger.ts`: pure functions over a supply document: `applyPurchase`, `consumeFEFO`
      (skip expired unless nothing else, never below zero per lot), `applyCorrection`, `discardLot`,
      `freezeLot`/`thawLot`, `extendExpiry`, `recomputeAmount`, `nextExpiry`, `activeExpiry(lot)`,
      `isExpired(lot, now, tz)`, `unexpiredAmount`. Property tests: Σ transactions == amount; FEFO invariants.
- [x] `packages/core/expiry.ts`: `estimateExpiry(ingredient, location, acquiredAt)`, leftover shelf lives
      (4 d fridge / 90 d frozen) from config.
- [x] `functions/src/commands/`: `onDocumentCreated(households/{hid}/commands/{id})` dispatcher → handler per
      type inside a Firestore transaction; writes transactions, updates supply doc, marks command
      `applied`/`failed` with error. Idempotency: handlers check target state (plan item already cooked, list
      already received). Admin helper `supplyRef(hid, ingredientId | leftover_<eventId>)`.
- [x] Client command layer: `useCommand()` writes the command doc (queues offline), tracks pending commands,
      and `useProjectedSupply()` overlays pending command effects optimistically. "Syncing" indicator from
      `hasPendingWrites`.
- [x] `/supply`: list grouped by location with filters (location, category, expiring soon, low stock),
      each row `current (projected)` in metric + imperial, expiry flag (fresh / use soon / expired), Staples
      group for free-use ingredients (last bought, expected run-out), `<ExpiredLotPrompt>` rows. Prototype
      "Supply" page.
- [x] `/supply/:id`: lots with expiry and location, `<SupplyAdjust>` (typed amount, ±5/±25 or ±1, Apply →
      `correctSupply`), discard, freeze/thaw with amount, `<LedgerList>` infinite scroll (25 per page).
      Prototype sheet "sup".
- [x] Add supply: ingredient picker → allowed measurements → amount → location → `addSupply`.
- [x] Receive groceries (`/grocery` phase "receipt"): list of the ordered list's items pre-ticked as bought,
      quantity edits, substitution (pick another ingredient/product), "didn't arrive"; freeze step when an item
      is from a `bulk` store and `freezable` (prototype "confirm.step === freeze"); submit one
      `receiveGroceries`. Updates cadence (`lastPurchasedAt`, EMA) in the handler.
- [x] Projected supply on the client: `canonical unexpired − planned uncooked requirements`. Feeds the Supply
      page brackets, `<SupplyBadge>` on recipe ingredients (free-use → "staple"), "can make" marking, the
      "Use what's left" filter, and the grocery builder's `supply` input (replacing M2's empty supply).
- [x] `<ExpiredLotPrompt>` on Supply and Plan: Still good (`extendExpiry`, +3 d default or date) / Threw it
      out (`discard`).
- [x] Expiry badge on planned items (`<ExpiryBadge>`, R6.7): earliest-expiring lot the item would use.

### Phase B — Cooking

- [x] `/meals/:id/cook` and `/recipes/:id/cook` → `<MealCookView>`: recipes with total times, drag or tap to
      order, check off each when done, "Done cooking" early exit. Single recipes skip the ordering step.
- [x] `<MiseEnPlace>`: prep tasks checklist (from `prepTasks`), then "Start cooking".
- [x] `<StepMode>`: full screen, one step, inline amounts, that step's ingredients, timers, swipe/tap-edge/
      arrow navigation, Screen Wake Lock, layouts per spec §12 table (phone portrait/landscape, tablet
      portrait, tablet/desktop landscape three panes) chosen by orientation + container size. Text size
      `clamp(1.5rem, 3vw, 4rem)`. Prototype phases "mise" and "steps" in phone, tablet, desktop modes.
- [x] Timers: `packages/core/timers.ts` (wall-clock end times, pause/resume math). Foreground alarm sound
      (bundled short WAV) + vibration. `functions/src/timers.ts`: callable `scheduleTimer({ endsAt, label,
      recipeId, stepIndex })` → Cloud Tasks task → task handler → FCM web push to `users/{uid}/devices`;
      `cancelTimer`, reschedule on adjust. Service worker: `push` handler shows the notification with an
      "Open" action deep-linking to the step. Device registration on first timer: request notification
      permission, get FCM token with the VAPID key, write `users/{uid}/devices/{token}`. iOS: if not
      installed, show the install prompt before the first timer. Offline: timer runs, banner warns no push.
- [x] Done cooking: `finishCooking` command (planItemId, recipeIds, servings) → handler consumes FEFO with
      recipe defaults at planned servings, creates leftover lot `leftover_<eventId>` with
      `defaultLeftoverPortions`, creates leftover plan items with coverage, marks plan item `cooked`, creates
      `cookEvents/{id}` with `reviewStatus: pending`. Double-finish guard.
- [x] `<ReviewSheet>` (prototype phase "review": "Rate it", "What did you use?", "Leftovers"): per-user 1–10
      for the meal and each recipe; used-amounts list pre-filled from the cook event's `used` with edit/
      remove/add; leftovers ▲/▼ from the event's count. Submit → `submitReview` → handler writes ratings,
      updates `stats`, posts `correction` deltas vs. `used`, resizes the leftover lot and its plan items,
      marks review `done` when the reviewer confirmed amounts. Other members' later ratings only add ratings.
- [x] Pending reviews card on `/plan` listing cook events with `reviewStatus: pending` or where I haven't rated.
- [x] Mark eaten: on leftover and snack plan items → `markEaten` (leftover lot −1, plan item `eaten`).
      Cooked meals can be marked eaten too (status only).
- [x] Coverage strip now shows solid cells for cooked/eaten; leftovers appear as plan items (R6.10).
      Leftover plan items roll over unless expired (rollover transaction checks the lot's expiry).

### Phase C — History and stats

- [x] `/history`: `<CollectionView>` over `cookEvents` joined with ratings: date, meal/recipes (deleted titles
      marked), who cooked, ratings, deviations (used vs. recipe), notes link. Prototype "History" page with
      the "Cooked" list and stat tiles.
- [x] Stats: most-cooked, average rating by cuisine, spend per period (Σ `estPriceCents` of received lists in
      each period). Computed on the client; `stats/{type_id}` from the functions drives recipe cards
      ("You've made this 14 times", last cooked, household average).
- [x] `<CollectionView>` "cooked before" filter and rating sort now use `stats`.

### Offline (cross-phase)

- [x] Workbox runtime caching of images for planned recipes; command queue works offline; e2e `offline.spec.ts`.

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

## Deviations and decisions (2026-10-10)

- **Lots never go negative.** Consumption beyond what the lots hold takes what there is, notes "short by n" on the
  transaction, and flags the supply doc (`shortAt`, "Check amount" on the row). A stored deficit would either be paid
  off by the next purchase or linger forever (spec §6 updated).
- **Cook events carry `defaults`, `deducted`, and per-lot `takes`.** The review pre-fills the defaults; corrections are
  against what was actually deducted; "used less" goes back into the lots it came from (core `refund`). `finishCooking`
  takes a client-chosen `cookEventId` so the review opens at once, even offline.
- **"Made n times" counts at Done cooking**, not at review (stats `timesCooked` / `lastCookedAt` in `finishCooking`);
  ratings go to `stats` in `submitReview`, one rating per person and target (re-rating replaces).
- **Leftover plan items have no recipes** (`recipes: []`, `name` = the meal): their food is cooked, so they add nothing
  to the grocery list or budget. They go into the current period, ID `<eventId>_lo<n>`; the cooked meal's own
  coverage drops to its one slot. Rollover carries a leftover only while its batch hasn't expired.
- **markEaten:** leftover → one portion; cooked meal → status only; planned snack → its recipe amounts come out of
  supply; a planned dinner is refused ("cook it first"). On the Supply page, "Ate one" uses a planned leftover item if
  there is one, else a correction.
- **Thawing** gives a fresh use-by of 2 days from thawing (the prototype's "use within 2 days"); the original fresh
  date has usually passed. Freezing or thawing part of a lot splits it (`<lotId>-f<n>` / `-t<n>`).
- **Receiving:** lines not touched arrived as listed (R7.8); quantities are in packs (or multiples of the raw amount);
  a substitution is "Got something else instead" with the ingredient picker; the list stores `receivedCents` (pro rata
  for changed quantities), which is the period's spend on History. A received list can't be edited or deleted.
- **Cadence:** `purchaseCount` added, `avgIntervalDays` stays null until the second purchase (the client uses the seed
  default until then). The "Are you out of X?" prompt itself is M5's staples task.
- **Routes added:** `/plan/:itemId/cook` (cooking a planned meal; `/meals/:id/cook` is a saved meal from the Meals list,
  `/recipes/:id/cook` a single recipe) and `/review/:eventId`. The review is a full-screen phase like the
  prototype's, not a sheet.
- **Timers:** alarm synthesised with Web Audio instead of a bundled WAV (nothing extra to cache offline). Cloud Tasks
  and FCM are behind adapters with emulator stubs (`_stubTasks`, `_stubPushes`); the callables run against the
  Functions emulator in e2e. Real web push can only be verified on a device (owner).
- **Expiry dates** are local midnights: a lot bought on the 10th with a 7-day life is good through the 16th.
  "Use soon" = 3 days or less. "Still good" extends by 3 days or to a picked date.
- **"Can make" on the Recipes page** uses a bundled list of the seed's free-use ingredients (`data/free-use.json`,
  `pnpm free-use:write`, unit test) instead of reading all 475 ingredients; ALMOST / "Use what's left" = at least 85 %
  of the tracked grams. "Uses expiring" and the "Expiring first" sort stay for M5 (suggestions).
- **Expiry badge (R6.7)** shows when the soonest-expiring unexpired lot a planned meal uses expires within the period or
  within 3 days.
- **Accessibility over parity:** small badges and panels use lightened red, peach, and blue (`bg-red-soft`,
  `bg-peach-soft`, `bg-blue-soft`) because ink on the prototype's colours is 3.2–4.1:1. Recorded with the a11y scan
  of every M3 page and sheet in Latte and Mocha.
- **Review progress** follows the cook event when it reaches the server (no remount), so a review started offline or
  right after Done cooking keeps the person's changes.
- **Offline:** the cook view preloads the review route's code (Done cooking works with no signal before the service
  worker has cached the app); the Plan page warms the photo cache for planned recipes.
- **Functions emulator note:** `commands` runs in the Functions emulator during e2e; tests wait on command status
  (`commandsSettled(hid, n)` waits for n commands to exist and settle).

## Design-compare notes (phone 430×932, desktop 1920×1080, Latte)

Compared with the prototype's Supply page (and its inline item detail), Plan (pending reviews, leftover and cooked
items, Cook buttons, expiry badges), cook phases (order, mise, steps), review (rate, used, leftovers), grocery
confirm and freeze step, and History. Matched: header kicker + Archivo Black title, location segmented control, filter
chips, the purple LEFTOVERS card with "Ate one", supply rows with mono location/expiry badges and right-aligned mono
amounts, the dashed expansion with PURCHASES / CORRECT IT / HISTORY, the cook top bar (✕, mono phase kicker, AWAKE,
ink Done cooking), mise checklist, step card with STEP n OF N badge and green inline amount chips, progress segments,
timer box, Back / Next step, review tabs and rating grids, ± used rows, leftovers ▲/▼, the confirm list with steppers
and GOT IT, the blue BULK BUY freeze panel, History stat tiles and cooked rows with the teal score square.

Intentional differences:

- **Amounts show metric and imperial** everywhere (R8.13), so the projected figure sits under the current one instead
  of beside it, and reads "(n after plan)" / "(need n more)".
- **Expired lots** get their own prompt card (Still good · +3 days / Pick a date / Threw it out, R8.15) above the list;
  the prototype only has "Threw it out" inside the row.
- **Step mode layouts:** the prototype has one layout scaled up; the app adds phone landscape (step | ingredients and
  timers), tablet portrait (next step + full ingredient checklist), and a three-pane wide layout (spec §12, R4.24).
- **Timer box** has Pause / ±1 min / Cancel and shows other running timers; the prototype only has Start.
- **Review ratings start empty** (the prototype preselects 8); the meal is only rated when it's saved, with "Save this
  meal?" for unsaved multi-recipe meals; an optional note field sits on the leftovers step.
- **Confirm groceries** adds "Got something else instead" (substitutions, R7.8) under each line.
- **Soft red / peach / blue** on small text (see Deviations).
- Not built (later milestones): "Use it or lose it" alerts, suggestion scoring, protein goals (M5).
