# M26 — Plan the next period

Status: done (owner checks: plan and order a real next week, then open the app after the rollover; restart with next-period meals planned)

## Goal

Orders go in before the new period starts (Monday), but plan items only belonged to the current period and the grocery
draft was built from the current plan, so the household either planned next week into this one (polluting coverage and
the budget) or waited for the rollover and ordered late. Let the household plan and order the next period while the
current one runs, and have the rollover make that plan the current one with nothing copied.

## Requirements covered

New: **R3.2** (This period · Next period on the Plan page; next-period meals in their own strip, list and budget, not
this period's), **R3.3** (the rollover adopts the next period's meals and list with no copies; restart moves them),
**R3.4** (suggestions, optimiser and "can make" on the Supply projected at its start; the projected-at-start note),
**R7.18** (the next period's grocery list: its own draft and orders). Changed: R3.1 (restart moves the next period), R6.1
(the next period's list), R6.6 (rolls over beside meals already planned). PRD v0.12. Spec §4.2 (`planItems.periodId`,
`groceryLists/draft-next`), §7 ("The next period"; restart), §8 ("A draft per period"), §12 (routes, `<PeriodSwitch>`),
§14.1 (plan, rollover, grocery, optimiser specs), §15.

## What rollover did before (verified)

`bootstrapHousehold` (`data/plan.ts`), on open, focus, reconnect and at the period's end: when the current period has
ended, one client transaction creates `nextPeriod(prevEnd, …)` (the period containing now, aligned to the old
boundaries) with a budget snapshot, copies every still-`planned` item (`carriesOver`: not eating out; leftovers only
while the batch is good) to `<newId>_<fromId>` with `carriedFromId`, and advances `currentPeriodId`. `restartPeriod`
shares `plannedCandidates` / `readCarry` / `writeCarry`. The draft was one household document (`groceryLists/draft`)
that followed `currentPeriodId` (a new periodId restores removed lines).

## Items

- [x] **0. CI for M25.** The Checks run for e465b09 passed (two flaky layout tests retried green); nothing to fix.
- [x] **1. Core** (`packages/core/src/upcoming.ts`): `upcomingPeriod`, `rolloverTarget` (adopts or skipped),
      `restartUpcoming`, `supplyAtStart` (FEFO use by this period's meals, then this period's incoming, expiry at the
      start, next-period orders added), `atStartSummary`, `listsForView`; `NEXT_DRAFT_ID` and `adoptDraft`
      (`grocery/draft.ts`). Unit tests `upcoming.test.ts` (15: IDs incl. DST and a cut-short period, adoption and skip,
      restart re-key for new/move/noop, projection, the note, a draft per period, adoption, lists per view).
- [x] **2. Rollover and restart** (`data/plan.ts`): the rollover adopts (no item writes), carries a skipped next
      period's planned items, and turns `draft-next` into `draft` in its transaction; restart re-keys the next period's
      items, orders and draft. Every draft function takes the view's draft ID.
- [x] **3. Model** (`data/planModel.ts`): one `usePeriodModel` for both views; `useNextPlanModel()` computed in
      `<PlanModelProvider>` only while wanted (one plan-items query and one draft document more); ordered lists split by
      view; current incoming excludes next-period orders.
- [x] **4. Plan page**: `<PeriodSwitch>` (`?period=next`), kicker "… · STARTS IN n DAYS · 7 DAYS", its strip, list,
      budget, Create meal (`CreateMealRequest.period`), Suggested (`useSuggestions("next")`), optimiser; next-period
      items show *Next period* with no Cook / Ate it; the projected-at-start note instead of the alerts.
- [x] **5. Grocery page**: the same switch; the next draft, its staples (due at its start, not on this period's list),
      its orders under *Ordered for the next period*; a line of explanation.
- [x] **6. Suggestions and optimiser**: a second engine on the same worker for the next period; the snapshot carries
      `period: { view, fromMs }`; this period's planned and cooked recipes count as recent.
- [x] **7. Rules**: unchanged (periodId is a string, no period document needed); rules test "the next period".
- [x] **8. E2E**: plan.spec (@R3.2 create a next-period meal, absent from this period's strip and budget; @R3.4 the
      note), grocery.spec (@R7.18 next draft from projected Supply, its order in the next view only), rollover.spec
      (@R3.3 adoption with no copies and the draft; restart moves it), optimiser.spec (@R3.4 accept into the next period).
- [x] **9. Docs**: PRD, spec, README row, this plan.
- [x] **10. Screenshot check** of Plan and Grocery in the next-period view on phone (430×932) and desktop (1920×1080), dev
      emulator with seeded next-period meals, a lot expiring in it and a next-period order. Fixed: the desktop budget card
      said "Budget · this period" in the next view (now "Budget · next period", "for the next period"); the note could
      break "900 g" between number and unit (non-breaking); the Ordered blurb in the next view says the orders count for
      the next period's list only.

## Deviations

- **Next-period orders are incoming for the next period only**, not "for both views" as the brief said: counted in this
  period's list too, this period's list would leave out what the next order buys for next week, and the next list
  (which subtracts this period's needs) would then add the same thing back after it was ordered. Received orders are
  Supply for both, so the receive flow is unchanged.
- **The period ID is computed, not created lazily**: the rollover already creates the period with its budget snapshot;
  a document written early would need a budget, dismissals and a clean-up when a restart moves it. The next view uses
  the household's budget.
- **Restart keeps the next period the next period**: its items, draft and orders are re-keyed to the period after the
  restarted one (also for a `move` of a period that hasn't started), rather than folded into the restarted period, which
  would put two weeks of meals in one period and pollute its coverage and budget.
- **Next-period meals can't be cooked** from the Plan page until their period starts (`finishCooking` records leftovers
  and the cook event in the current period).
- **Staples**: the next list asks which staples are due at its start and leaves out any already on this period's list
  or ordered, so one isn't bought twice.
- **No prototype screen**: `<PeriodSwitch>` reuses the Create meal sheet's segmented tabs (accent on the chosen one).
- **CI after the last commit (21fc3f1)** failed on the @R3.4 note test on every project: item 10 made "400 g" non-breaking,
  and the test's regex had a plain space. The test now accepts either (fixed during M27, own commit).
- **Screenshot check, not design-compare**: the owner retired design-compare during this milestone (4c3e19a); item 10
  is the new screenshot check.

## Verification

- Typecheck and lint (whole repo): clean. `pnpm e2e:coverage`: green, M26 7/7 tagged.
- Unit: core 717 → 732 (`upcoming.test.ts` 15), web 48. Rules: 103 → 104 (the next period).
- E2E, new tests (`--workers=1`, phone-android and desktop-1080p): plan @R3.2 @R3.4, grocery @R7.18, rollover @R3.3 ×2:
  10/10 passed (one fix: the R3.2 test read the item before the write reached the emulator; now polls).
- E2E regression (phone-android + desktop-1080p, `--workers=1`, run by the coordinator after a low-memory kill of the
  first run): plan + rollover 57 passed / 1 skipped; grocery + receive 24 passed; suggestions + optimiser + a11y 39 passed
  / 1 skipped (the new @R3.4 optimiser test included); receipt + history + supply 32 passed.
- Functions: `pnpm test:functions` 93/93 (no function code changed).
- Screenshot check: item 10.
