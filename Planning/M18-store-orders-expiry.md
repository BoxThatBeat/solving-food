# M18 — Each store its own order; set any use-by date; confirm sheet scrolls

Status: done (owner check: on the live app, order PC Express and Costco on different days; set a date on a Supply lot)

## Goal

Owner request (2026-11-04): "the confirm groceries modal did not let me scroll down through the items. I want the
different stores to be different orders in the groceries page since I dont go to the stores or order them on the same
day. also in the supply I want to be able to manually set the expiry date of any ingredient (should open a calendar).
I also noticed the assumed expiry dates are really short for some reason. like canned chicken, italian sausage and
ground chicken all expiring in one day? where are these default expiry dates comming from?"

## Requirements covered

R7.14 (new: each store is its own order), R8.18 (new: set a use-by date by hand), R7.8 (fix: the confirm sheet scrolls).

## Items

- [x] **Sheet scroll (R7.8):** the sheet body is a scrolling flex column; a child with `overflow-hidden` (the receive
      list) could shrink to the body's height and clip its rows, so nothing scrolled. Every direct child of the sheet
      body is now `shrink-0` (`components/ui/sheet.tsx`), which fixes every sheet. E2E with 25 lines (fails without the
      fix on phone-ios).
- [x] **Store orders (R7.14):** `orderDraft(hid, periodId, storeId, lines, uid)` moves one store's lines into an ordered
      list with `storeId` and deletes only those fields from the draft. PC Express: Copy / Mark ordered (Copy text has
      only its lines). In-store stores: **Done shopping · confirm** orders and opens the confirmation sheet. The Ordered
      section names each order's store. `storeId` on `groceryListSchema` and in the groceryLists rule (string 1–200);
      rules test. E2E: grocery copy test (two separate orders, Undo one), core loop (Costco confirmed in store, PC
      Express confirmed on arrival).
- [x] **Set date (R8.18):** Supply item → each lot → **Set date** opens a native date field (calendar via
      `showPicker()` on click), prefilled with the current use-by date, min today; Save sends `extendExpiry` with
      `until` = midnight after the day. The lot shows "date set". No new command or rule. E2E @R8.18.
- [x] **Short expiry dates (explained, partly fixed):** a lot's expiry is purchase date + the ingredient's
      `shelfLifeDays` for its location (USDA FoodKeeper values in `data/ingredients/*.json`; raw ground meat and
      sausage: 2 fridge days from purchase). Ingredients created by an import get their category's defaults from a
      name guess, and "canned chicken" matched "chicken" → meat → 2 fridge days. `guessCategory` now checks
      canned / tinned / jarred first (pantry, 365 days). Existing ingredients are fixed on their Ingredients page
      (location and shelf life are editable); existing lots with Set date.
- [x] Docs: PRD R7.14, R8.18; spec §4 (groceryLists `storeId`), §6 command table, §8 Copy button, §9 unknown
      ingredients, §15 row. Design-compare skipped (owner's standing request).

## Follow-up (2026-11-04): planned recipes never suggested

Owner: "the suggestion algorithm should never suggest recipes that are already in the plan. they can still be in the
list just at the very bottom". The Suggested row, optimiser, expiry alerts and Use it up already left them out; the
**Suggested sort** (Recipes page, Create meal, saved meals) didn't.

- [x] `ScoreResult.planned`; `rank()` tiers: suggestions → blocked → planned; `bySuggestion` puts `suggestion.planned`
      at the very bottom; `combinedSuggestion().planned` when every recipe of a saved meal is planned. Unit tests
      (scoring, collection); e2e @R6.11 (a salmon recipe that ranks first drops to last once planned; not in the
      Suggested row). PRD R6.11, spec §8.
- [x] Also fixed (2026-11-04): Supply lot actions wrap as one row under the details on a phone (they squeezed the
      details to one word a line after Set date was added).

## Verification

- Typecheck, lint clean. Core 678, web 37, rules 99 (storeId). E2E grocery, receive, supply, core-loop on
  desktop-1080p and phone-ios: 42 passed.
