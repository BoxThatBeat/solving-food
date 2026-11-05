# M25 — Receipt and order-confirmation import

Status: in progress

## Goal

The last manual step in the loop is the confirm-purchase sheet after an order arrives: the person adjusts pack counts,
substitutions and items that didn't come by hand, and the period's spend stays an estimate. Let Gemini (already set up
for Add with Gemini, M16) read a till receipt photo or a PC Express order confirmation (a screenshot, or the email's text
pasted) and prefill the sheet, every prefilled field marked and editable, nothing written until Confirm; record what was
paid per line so History shows real spend (and M27 can build price history on it).

## Requirements covered

New: **R7.15** (From a receipt: photo, camera or pasted text; never stored; not set up), **R7.16** (matching and the
prefilled, marked, editable sheet; didn't come; not on the list), **R7.17** (paid prices stored; History's spend actual /
estimated). Changed: R10.3 (spend at paid prices, labelled), R11.15 (the Gemini section lists receipts). Removed the
non-goal "Reconciling the order confirmation or a receipt against the list automatically" (written before Gemini was in
the app). PRD v0.11. Spec §2 (quota row), §4 (`receiptRate`, list and mapping fields), §6 (command table, as built), §7
(Budget: actual spend), §8 ("From a receipt"), §10 (callables), §12 (`<ReceiveSheet>`), §14.1 (`receipt.spec.ts`), §15.

## Items

- [ ] **0. M24 CI.** The Checks run for dbfaf07 failed on phone-ios (`a11y.spec.ts`): the Plan alerts' folded summary
      (`bg-peach`, 14 px bold ink) is 4.13:1, and the Suggested tabs' "All" was 43 px wide. Summary on `bg-peach-soft`,
      tabs `min-w-11`. Own commit, noted under M24's Deviations.
- [ ] **1. Core (`packages/core/src/receipt.ts`).** `receiptInstruction(ordered)` (rules + the ordered lines as L1…Ln),
      `receiptGenerationConfig()` (JSON response schema), `readReceipt()` (normalise: dollars → cents, totals from unit
      price × quantity, a bare discount line folded into the line above, ≤ 150 lines), `matchReceipt()` (product name →
      `matchIngredient` → Gemini's `listLine`; substitutions by what they replaced; `missing`), `receiptArrival()` (packs,
      an exact weight, Σ paid), `packSizeToCanonical()`, `extraAmount()`, `RECEIPTS_PER_HOUR`. `listSpend()` and
      `spendPerPeriod()` with a basis in `history.ts`. Command schema: `paidCents`, `extra`, `name` per line,
      `receipt.totalCents`. Types: list and line paid fields, mapping `lastPaidCents`/`lastPaidAt`. Unit tests
      (`receipt.test.ts`, `history.test.ts`).
- [ ] **2. Callable `readReceipt`** (`functions/src/ai/receipt.ts`): allowlisted (`requireAllowed`), a member of the
      household, a list still ordered, Gemini set up, 10 per person per hour (`receiptRate/{uid}`), 512 MiB / 120 s;
      a photo inline (JPEG/PNG/WebP/HEIC, ≤ 4 MB) or text (≥ 10, ≤ 30k chars); `geminiJson` (structured output) with a stub
      answering `_stubLlm/{uid|config}.receipt`; the ingredient index cached with the drop-folder importer
      (`ingredientData`, now exported); logs counts only. Functions test `receipt.test.ts` (photo inline with the ordered
      lines, normalised and matched, nothing written or stored; text; outsiders, received list, bad input, empty answer,
      not set up, hourly limit).
- [ ] **3. `receiveGroceries` with paid prices** (`handlers.ts`): line `paidCents`; list `paidCents`, `spendCents`,
      `paidComplete`, `receiptTotalCents`, `receiptExtras`; extras into Supply; the brand mapping's `lastPaidCents`
      (mappings read before any write). Rules: `receipt` payload key (rules test). Functions test in `commands.test.ts`.
- [ ] **4. Confirm sheet** (`ReceiveSheet.tsx`): **From a receipt** button → a step with Upload / Take a photo / paste the
      email (`photoForGemini` in `lib/images.ts`, `readReceipt` in `data/ai.ts`); not set up → Settings → Gemini; Back.
      Prefill when the receipt's ingredients have loaded (state adjusted while rendering): packs, exact amount,
      substitution, didn't come, Paid $; a peach "From receipt: …" chip and dashed outline on each field it set, cleared
      by an edit; **Not on the list** with Add to Supply / Ignore and an ingredient picker; Confirm sends the paid prices,
      extras and the receipt total.
- [ ] **5. History** spend: `listSpend` per list; each period's bar says actual / estimated / part actual.
- [ ] **6. Settings → Gemini** lists reading receipts; the free-tier note mentions receipts.
- [ ] **7. E2E** `receipt.spec.ts` (@R7.15 @R7.16 @R7.17): the canned receipt covers a matched line, a substitution, a
      didn't-come line and a not-on-the-list line; text and photo paths; nothing written before Confirm; History "actual";
      Back; not set up.
- [ ] **8. Docs**: PRD, spec, README row, this plan.
- [ ] **9. Design-compare** the confirm sheet (list with marks, receipt step) and History on phone and desktop.

## Deviations

## Verification
