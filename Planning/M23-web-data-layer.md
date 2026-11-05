# M23 — Web data layer and bundle

Status: done

## Goal

A pass over the web app's data layer and bundle (review of 2026-11-05): open fewer Firestore listeners and reopen none
needlessly, stop treating failed listeners as missing data, stop waiting on the server (or on `navigator.onLine`) for
writes Firestore already shows, fix the clocks that froze, the grocery order race, the editor's re-renders, unbounded
reads, the slow landing redirect, notifications that cleared on every device and the leave order; remove dead code and
duplicates; ship one small plan worker and no source maps to Hosting.

## Requirements covered

No new requirement IDs. Behaviour changes under existing ones: R12.1 (success and info banners clear on the showing
device only; listener failures as a banner; `notifications.spec.ts` @R12.1 rewritten), R10.1 (History loads 100 meals,
Show more; new test in `history.spec.ts` @R10.1), NFR5 (writes never wait for the server; a dead network counts as
offline; one order for two presses), NFR6 (only the current width's navigation is mounted; `responsive.spec.ts`
@NFR6 now checks the others aren't in the page). PRD v0.9. Spec §4.2 "Bounded reads", §7 (plan worker), §11 (live
sync table), §12 (landing, `<NotificationBanners>`, notifications spec row), §13 (source maps), §15 row.

## Measurements

**Listeners** (`window.__sfListeners.active()`, dev seed: 28 recipes, a few Supply items, empty plan; 8 s after
navigating). Before = hook listeners only (the session's and invites' 6 weren't counted yet), after = all.

| Page | Before (phone = desktop) | After, phone | After, desktop |
|---|---|---|---|
| Plan | 108 (+6) | 56 | 60 |
| Recipes | 107 (+6) | 53 | 57 |
| Supply | 71 (+6) | 44 | 48 |
| History | — | 48 | 52 |

Opened since load on the Plan page: 159 → 88 (phone).

**Bundle** (`pnpm --filter @solving-food/web build`):

| | Before | After |
|---|---|---|
| Main entry `index-*.js` | 295.45 kB (94.67 kB gzip) | 296.62 kB (95.01 kB gzip) |
| Shared vendor chunk (`notifications-context-*.js`: Firebase, React, core) | 669.39 kB (200.61 kB gzip) | 671.31 kB (201.30 kB gzip) |
| Plan workers | `scoring.worker` 493.9 kB + `optimiser.worker` 499.8 kB | one `plan.worker` 179.5 kB (28 kB gzip) |
| Service worker precache | 120 entries, 3408.92 KiB | 119 entries, 2616.69 KiB |
| Source maps | 14 MB, referenced from every bundle, uploaded to Hosting | 12 MB built, unreferenced (`hidden`), ignored by Hosting |

The main entry grew ~1 kB (listener accounting, connectivity probe, the shared model provider); the worker work is
where the bytes were.

## Items

### Listeners and subscriptions

- [x] **1. One navigation per width.** `ReadyShell` mounts the phone header and tab bar, the md rail, or the lg side
      nav from `useMediaQuery` (SSR-safe `useSyncExternalStore`), never all three. Badges read the shared plan model
      (planned count, Supply "SOON") and `usePendingReviews`, which is now two small queries. Measured with
      `tracked()` (`firebase/listen.ts`, `window.__sfListeners` in dev and emulator builds); numbers above.
      `responsive.spec.ts` (@NFR6).
- [x] **2. Diffed per-ID listeners.** `KeyedSubscriptions` (`data/keyedSubscriptions.ts`) and `useLiveDocs(path, ids,
      toValue)` in `live.ts`; `useIngredientsById` and `useRecipeDocs` use it. Unit test with a mocked onSnapshot counting
      subscribes and unsubscribes (`keyedSubscriptions.test.ts`, 6 tests).
- [x] **3. Metadata snapshots opt-in.** `useLiveDoc` / `useLiveQuery` take `{ metadata: true }`; only the version history
      and the connectivity probe ask (the session keeps its own listeners with metadata).
- [x] **4. Listener errors.** `reportListenerError` (`data/listenErrors.ts`) from every listener (live hooks, invites,
      session); dev logs; `<ListenerErrorBanner>` shows permission-denied (error) / unavailable (info), once each, not for
      a household just left. `LiveDoc.error` keeps the last data; the recipe page says "Couldn't load" for a failure
      that isn't permission-denied. `listenErrors.test.ts`.
- [x] **5. No `navigator.onLine` oracle.** `hooks/useOnline.ts`: `navigator.onLine` and the household doc's `fromCache`
      for 5 s (`<ConnectivityProbe>`); `isOnline()` for data functions. Create meal, eating out, plan item save/remove/save
      as meal, optimiser sets, grocery manual lines, household notes, household settings, sides, brand mappings and meal
      delete close on the local write and report failures only. Rollover, restart, draft sync and recipe saves use
      `isOnline()`. `offline.spec.ts`.
- [x] **6. `useNow`.** `hooks/useNow.ts` (every minute, on `visibilitychange` and focus) on the Plan page, pending
      reviews, the recipe page, Trash, Supply and brand mappings.
- [x] **7. Grocery race.** `orderDraft` and `undoOrder` are transactions; core `orderableLines` (3 tests in
      `grocery.test.ts`) keeps only lines still on the draft; Undo of a received or undone list says so. `grocery.spec.ts`.
- [x] **8. Recipe editor.** `useWatch` on ingredients, tags, tools, photos, cuisine and steps only; the device draft is
      written from `form.subscribe` (no re-render per keystroke); the reconnect auto-save stays in the editor (a new
      recipe's editor becomes its edit page). `recipe-edit.spec.ts`.
- [x] **9. `useMealFavourites`** memoised on the snapshot.
- [x] **10. One plan model.** `<PlanModelProvider>` in the shell computes `useComputePlanModel()` once; `usePlanModel()`
      reads it (Plan, Grocery, Supply, Recipes, suggestions engine, badges). Create meal loads its picked recipes and
      sides itself. The model and `useSupply` return memoised objects.
- [x] **11. Bounded reads.** History: 100 cook events + Show more, 500 newest ratings, 60 received lists, 12 periods;
      review and pending reviews: `cookEventId in` their events; directory ≤ 500. Spec §4.2. `history.spec.ts` (@R10.1).
- [x] **12. Landing.** `/` redirects from `rememberLanding` (written by the plan model whenever plan items load); a
      first visit on the device asks Firestore for at most 1.5 s.
- [x] **13. Per-device success banners.** `onAutoDismiss` (local, `notificationsSeen.ts`) vs `onDismiss` (writes
      `dismissedAt`); a success/info notification over a day old is cleared by whoever sees it. `notificationsSeen.test.ts`,
      `notifications.spec.ts` (@R12.1).
- [x] **14. Leave.** `leaveHousehold` deletes the member doc, then sets `activeHouseholdId`. `households.spec.ts`.

### Dead code and duplicates

- [x] **15.** `Placeholder.tsx`, `useCommand`, `diagEnabled`, `SIGNAL` removed; 22 exports used only in their own file
      unexported (no knip in the dev shell: a script listed every export no other file names). One `millis()`
      (`lib/millis.ts`), one `hh()` (`data/paths.ts`), one `useCallableStatus` for `useAiStatus` / `usePcxStatus`, one
      `<MealTypePicker>` (Create meal, eating out, plan item), `<Stepper>` (with `compact`) on the recipe page and first run.

### Bundle

- [x] **16. One plan worker.** `workers/plan.worker.ts` (`kind: "score" | "optimise"`); core subpath exports
      (`./scoring`, `./optimiser`, `./grocery`, `./cooking`, `./collection`); zod out of the worker (schemas moved to
      `collectionSchema.ts` / `pricingSchema.ts`, `isPlannable` to `taxonomy.ts`, the worker reads the price file
      unvalidated); `virtual:sf-seed-ingredients` keeps 12 seed fields. 994 kB → 179.5 kB.
- [x] **17. Source maps** `hidden`; `firebase.json` hosting ignores `**/*.map`.
- [x] **18. Sizes** reported above.

### Housekeeping

- [x] PRD v0.9; spec §4.2, §7, §11, §12, §13, §15; Planning/README row.

## Deviations

- **Listener "before" numbers miss the session's 6.** The accounting wrapper went in with this milestone; the first
  measurement wrapped only the hooks. The comparison above adds them back.
- **Badges still listen on tablets and desktops** (they show there): from the shared model (no extra listeners) plus
  the saved-meals collection and two small pending-review queries, not a dedicated aggregate document; an aggregate
  would need a function-maintained counter for little gain at this size.
- **The plan model is always on in the signed-in shell**, not only while a page asks for it: the four main pages, the
  suggestions engine and the desktop badges all use it, and keeping its listeners open between pages costs fewer reads
  than reopening them on each navigation.
- **Create meal loads its own picked recipes** instead of registering "extras" on the shared model, so picking a
  recipe doesn't rescore suggestions or flip the Plan page's `ready` behind the sheet.
- **Connectivity from the household doc's metadata** with a 5 s grace (a cold start answers from cache first); no
  extra ping request. Firestore notices a dead connection when its stream fails, which can take tens of seconds on a
  silently dead network; writes no longer wait in the meantime, so only the offline banner is late.
- **Writes that must reach the server still wait:** recipe saves (the version rule, spec §11), invites and accepting
  them, creating, leaving and removing members, restoring from Trash or a version, merging ingredients. They fail
  instead of hanging once Firestore knows it's offline.
- **Stale notification cut-off is a day:** a success or info banner nobody dismissed is marked dismissed by the next
  device that sees it after 24 h, so undismissed docs don't pile up (the M22 retention only prunes dismissed ones).
- **History starts at 100, not 300**, so "Most cooked" counts the loaded meals; Show more widens it.
- **Received lists by `orderBy receivedAt`** instead of `status == received`, avoiding a composite index (only received
  lists have `receivedAt`).
- **The worker skips the price file's zod validation**; the main bundle and `pnpm prices:check` still validate it.
- **Main bundle not split further.** The brief asked to report its size; the vendor chunk is Firebase and React.
- **`/` remembers per device**, so a plan another member just filled lands on Recipes once on a device that last saw
  it empty (the model updates the memory as soon as it loads).
- **Design-compare:** Plan (phone and desktop: same shell, tab bar and side nav with badges) and the recipe page's
  servings stepper (now `<Stepper compact>`: Lucide minus/plus instead of text glyphs, same size) against the prototype;
  no other layout changed. History's Show more uses the standard secondary button.
- **Verification:** typecheck and lint clean; unit 698 → 701 (core) and 37 → 48 (web); `pnpm e2e:coverage` green. The
  full e2e run on phone-android and desktop-1080p was stopped by Claude Code after 32 tests (all passed: a11y, auth,
  cadence, cooking, core-loop, data-transfer, drop-folder) because the machine ran low on memory. It still has to be run
  (`pnpm e2e --project=phone-android --project=desktop-1080p`), especially notifications, grocery, offline, households,
  history, responsive, recipe-edit and plan, before this is pushed.
