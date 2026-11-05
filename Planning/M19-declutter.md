# M19 — Declutter Supply, Grocery, Settings

Status: done (owner check: Supply on the live app reads in the unit you add things in)

## Goal

Owner request (2026-11-04): "Lets simplify the UI, it is getting too cluttered." Supply: no count or description at
the top, filters in a menu like Recipes (same icon, options deduped), the bracket only when the plan uses the item
(just a number, no text), amounts in the unit they were added in. Grocery: no text above or below the title, titled
"Grocery List". Settings: no description above the headers.

## Requirements covered

R8.4 (bracket only when planned meals use some), R8.12 (Filter sheet, deduped options), R8.13 (Supply in the unit it
was added in).

## Items

- [x] **Supply header:** the kicker count and the "Now (after planned meals) · bought − cooked …" line are gone; the
      count stays as a screen-reader status (`supply-count`, also the e2e loading signal).
- [x] **Filter sheet (R8.12):** search box + the Recipes filter button (`FilterIcon`, exported from
      `CollectionView`) opening a "Filter" sheet with Location / Show (Expiring soon, Low stock) / Category groups,
      applied immediately; applied filters show as removable chips with Clear. Categories are keyed by their label
      (singular, case-insensitive) and `pantry` / `frozen` are left out because the Pantry / Freezer locations already
      cover them. E2E rewritten.
- [x] **Bracket (R8.4):** `(400 g)` only when uncooked planned meals use the item; `(−200 g)` when they need more than
      there is; nothing otherwise. E2E updated.
- [x] **Unit it was added in (R8.13):** `addSupply` takes `unit`; the function stores it as `displayUnit` on the
      supply doc (`receiveGroceries` deletes it). The client reads amounts with core `formatInUnit()` in
      `displayUnit`, else the ingredient's `defaultPackMeasure` (g, ml, count); falls back to metric when it can't
      convert. The correction box starts in the same unit. Rules allow `unit` on addSupply. Unit + rules + e2e tests.
- [x] **Grocery:** "For the … plan" kicker and the "Plan needs − supply − ordered …" line removed; title "Grocery List".
- [x] **Settings:** no kicker above the title on Settings or any sub-page.
- [x] Design-compare phone + desktop (Supply, Grocery, Settings).

## Deviations

- The Filter sheet applies each tap at once (the Recipes sheet keeps a draft until "Show N"); Supply's filters are
  few and cheap, and its "Show N items" button just closes the sheet.
