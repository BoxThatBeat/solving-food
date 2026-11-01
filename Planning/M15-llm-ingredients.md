# M15 — Ingredient names decided by an LLM; "From PC Express" labels

Status: done (owner checks below: save the Gemini key, Check with Gemini on the waiting names; deploy is the owner's)

## Goal

Owner request (2026-11-01): "The managing ingredients is way too tedious of a task for the user. How can we make an
LLM decide if an ingredient is the same as others? […] The user should only be able to edit an ingredient in the
list." And: "I'd like to see some 'from PC Express API' whenever info is shown from it."

Owner decisions (asked 2026-11-01): **both** an automatic LLM (Gemini, free tier) and a copy-for-Claude fallback;
names already waiting are **merged automatically** when the LLM is sure; the **review/merge UI goes** (people only
open an ingredient from the Ingredients list and edit it); the label reads **"From PC Express"**.

## Design

- **Which LLM:** the Gemini API's free tier, called from functions over HTTPS with a key from Google AI Studio. Not
  Firebase AI Logic (a client SDK; the judging runs in the drop-folder function, and it bills through `solvingfood`,
  which is on Blaze). The key must come from a **separate Google project without billing**, so it can never be
  charged; at the free limit a call just fails and the name waits. Free-tier prompts may be used by Google to improve
  its products; only ingredient names and candidate names are sent. Model `gemini-3.5-flash-lite`
  (`GEMINI_MODEL` in `functions/.env` can change it), JSON output with a response schema, temperature 0.
- **The judge (core, pure):** `packages/core/src/ingredientJudge.ts` builds one request for up to 20 names, each with
  its candidates (`suggestIngredients` top 6, catalogue and household-made, never itself or a tombstone), and reads
  the answer: per name `same` + candidate ID, `new`, or `unsure`. An answer naming an ID that wasn't a candidate,
  a malformed answer, or a missing name counts as `unsure`. The same format serves the Claude fallback (prompt text
  and pasted answer).
- **On import (drop folder, household import):** names the deterministic matcher doesn't place are judged in one
  request **before** anything is created. `same` → the recipe line uses that ingredient and the wording becomes one of
  its aliases (capped at 40), so no merge and no review; `new` → the ingredient is created with `nameCheck: "new"`;
  `unsure`, no key, or a failed call → created with `nameCheck: "unsure"`.
- **Names already waiting** (household-made ingredients with `needsReview` and no `nameCheck`, or `nameCheck:
  "unsure"`): the owner's **Check names** button on the Ingredients page (callable `checkIngredientNames`, batches of
  20, owner only) judges them; `same` → the existing merge (`mergeIngredient`'s code: moves recipes, Supply, plans,
  grocery lines; learns the alias); `new` → `nameCheck: "new"`; `unsure` stays. A shipped catalogue ingredient is never
  the one merged away (existing refusal).
- **Fallback, Copy for Claude:** on the Ingredients page, while names are unsure: **Copy for Claude** puts a prompt with
  those names and their candidates on the clipboard; **Paste Claude's answer** reads its JSON, shows what it will do
  ("merge 3, keep 2 as new, 1 still unsure"), and applies it with the existing `mergeIngredient` callable and a
  `nameCheck: "new"` write.
- **Gemini key:** owner-only card on the Ingredients page, like the PC Express key (R6.28): saved by callable
  `aiSetKey` to function-only `aiSession/config`, tried with a one-name request, hint of the last four characters. The
  key card is shared (`<ApiKeyCard>`), PC Express's card uses it too.
- **Review UI removed:** the Ingredients page has no review view, chip, cards, "Looks like", Merge into… or Keep as
  new; no Recipes review banner; no counts on Settings, the More sheet, or the Drop page; the import notification has no
  "Review ingredients" link (the message names new ingredients and what the LLM did). The merged notice on a merged
  ingredient's page stays (it explains where it went). The "needs review" marks for missing data (conversions,
  protein) stay on the ingredient, recipe and editor views and link to the ingredient's page: that's editing.
- **"From PC Express":** a small mono tag wherever PC Express data shows: store search results, the current store,
  product search results, a brand's live price, and the budget meter's live count.

## Requirements covered

R4.27 (changed: names decided by an LLM, no review UI), R4.35 (new: Copy for Claude fallback), R4.36 (new: the Gemini
key), R4.16 (changed: the import's notification), R8.16 (a merge moves Supply, now via Check names), R6.29 (new:
"From PC Express" labels).

## Items (in build order)

### A. Core
- [x] `ingredientJudge.ts`: `judgeCandidates()`, `geminiRequest()`, `parseJudgement()`, `claudePrompt()`,
      `parseClaudeAnswer()`; unit tests (invalid IDs, missing names, extra prose around the JSON, unsure default).
- [x] `nameCheck?: "new" | "unsure"` on `IngredientDoc`; rules allow clients to set it (only to those values).

### B. Functions
- [x] `functions/src/ai/gemini.ts`: the HTTPS call (10 s timeout), the stub under the emulator (`_stubLlm/config`
      `{ answers: { "<name>": "<id>" | "new" | "unsure" }, mode?: "down" }`, unlisted → unsure).
- [x] `aiSession/config` key, `aiSetKey` / `aiStatus` callables (owner only, shared owner check with PC Express).
- [x] `prepareCookRecipe`: judge before creating; repoint lines for `same`, alias learned; `nameCheck` on created ones;
      warnings and notification text; no `link2`.
- [x] `checkIngredientNames` callable: waiting names in batches, merge / keep / leave; report.
- [x] Tests: drop folder with the stub (same → no new ingredient, alias learned; new; unsure; no key; Gemini down),
      check names (merge moves Supply, catalogue never merged away, owner only), key callables.

### C. Web
- [x] `<ApiKeyCard>` (PC Express and Gemini).
- [x] Ingredients page: list only (search, edit), Gemini key card (owner), "N names unsure" section with Check names
      (owner, key saved), Copy for Claude, Paste Claude's answer sheet.
- [x] Remove: review view/chip/cards, MergeSheet, `$id` merge panel, ReviewBanner, counts in Settings/More/Drop,
      notification `link2` rendering if unused.
- [x] "From PC Express" tags.
- [x] Design-compare phone and desktop: **skipped at the owner's request** (2026-11-01). The new cards reuse the
      existing card, chip, dashed-alert and mono-tag patterns of the PC Express cards.

### D. Docs and tests
- [x] PRD R4.16, R4.27, R4.35, R4.36, R6.29, R8.16, §12; spec §2 quota (Firestore trigger none; callables; Gemini is
      outside Firebase), §4 data model, §9 matcher, §8 labels; SETUP.md (Gemini key how-to); skill note.
- [x] E2E: ingredients.spec.ts rewritten (@R4.27 @R4.16 @R8.16 @R4.35 @R4.36), labels (@R6.29); visual spec tidy.

## Decisions

- Judge on import before creating anything, not in a Firestore trigger afterwards: a trigger merge would race the
  recipe write that follows the ingredient creation.
- Ingredients made by hand in the recipe editor aren't judged: the picker already shows matches, and the person chose
  to create it.

## Fixes after deploy

- [x] (2026-11-01) The owner's AI Studio key was refused as "doesn't look like a Gemini API key": newer keys contain a
      dot ("AQ.…"). Keys may now contain `.` (shared pattern, PC Express too); functions test added.
- [x] (2026-11-01) Gemini answered 404 "models/gemini-2.5-flash-lite is no longer available to new users": the default
      model is now `gemini-3.5-flash-lite` (free tier per the pricing page). `GEMINI_MODEL` still overrides it.

## Verification

- Lint, typecheck: clean. Core + web unit 706 (ingredientJudge.test.ts 6 new). Rules 98 (nameCheck values). Functions
  11 files / 68 tests (ai.test.ts 6 new: import same/new/unsure, Gemini down, a non-candidate answer ignored, Check
  names merges with Supply, Gemini down on Check, key owner-only).
- Playwright desktop-1080p + phone-ios: ingredients, prices, drop-folder, recipe-edit, settings: all pass (one
  phones-only skip). `pnpm e2e:coverage`: M15 6/6 tagged.

## What's left for the owner

1. Deploy (push; CI deploys, or `firebase deploy`).
2. Create a Gemini key in a **new Google project with no billing** (SETUP.md "M15") and paste it on the Ingredients page.
3. Press **Check with Gemini** for the names waiting from before (about 59); look at what's left under Names to decide.
