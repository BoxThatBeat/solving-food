# M8 — Ingredient matching

Status: done (owner reviews the remaining 59 in Settings → Ingredients)

## Goal

Recipes and Supply share ingredient IDs, assigned once at import. Before M8 the drop folder matched a recipe's wording
only by its normalised form and a short soft-word list; anything else became a new ingredient flagged `needsReview`,
whose recipe lines never reduced the right Supply row and whose grocery lines never merged. The live project had 62
such ingredients (near-duplicates of each other and of the catalogue), and the review page was reachable only from an
ingredient link inside a recipe. M8 makes matching much better, lets people merge a duplicate into the right
ingredient (moving Supply with it), makes the Claude skill strict about catalogue names, and makes review discoverable.

## Requirements covered

R4.27 (new: ingredient review and merge), R8.16 (new: a merge moves Supply), R4.16, R4.17 (import matching, skill).

## Items

### 1. A much better deterministic matcher (core)
- [x] `packages/core/src/ingredientMatch.ts` (re-exported from `ingredient.ts`): `matchIngredient(name, index, { exclude })`
      → `{ id, confidence: "exact" | "variant" | "soft" | null }`; `resolveIngredientName` keeps its signature and
      returns `matchIngredient().id`.
- [x] Tiers: exact (normalised name or alias) → variant (spelling and regional variants folded on both sides,
      `variantKey()` / `INGREDIENT_VARIANTS`) → soft (text after a comma or in parentheses dropped, then `PREP_WORDS`
      anywhere, then `STATE_WORDS` when the rest names an ingredient). State words are never dropped onto an
      ingredient whose name says fresh/raw ("dried mint" ≠ "fresh mint"), and "ground" never onto meat or fish.
- [x] Index: a reviewed ingredient wins a shared name over one that needs review (before M8 the first by ID won, so the
      live "frozen tater tots" duplicate could shadow tater tots' alias); `mergedInto` is followed (chains too).
- [x] New ingredients from imports: `cleanIngredientName()` drops pure preparation words ("diced green chilies" →
      "green chilies", the wording kept as an alias); the ID is the variant key (`newIngredientId()`), so "diced green
      chiles", "diced green chilies" and "mild green chiles" all create `green-chile`, and "m&m's" / "m&ms" `m-and-m`.
- [x] `suggestIngredients(name, index, max = 5, { exclude })`: the matcher's hit, then shared words (Jaccard ≥ 0.3 on
      normalised, preparation-free words; reordered words score 0.9) and prefixes.
- [x] Seed aliases for the variants where the catalogue has the ingredient (cornflour, beef/pork/lamb/turkey/chicken
      mince, capsicums, fresh coriander leaves, king prawns); the seed validator also rejects two ingredients that share
      a spelling-variant key.
- [x] `ingredient.test.ts`: 58 wordings against the catalogue (incl. no false merges: ground beef ≠ beef, dark chocolate
      ≠ chocolate chips, egg yolk ≠ egg, dried mint ≠ fresh mint, cooked rice ≠ rice), every catalogue name and alias
      resolves to itself exactly, no variant-key collisions, two properties (preparation words and qualifiers around a
      name; case and variants), all 62 live needs-review names with their expected result, suggestions, index rules.
- [x] `pnpm gen:skill` (references/ingredients.md now lists the preparation words, state words and spelling variants
      from core), `pnpm ingredients:validate`, `data/recipes/check-cooklang.mjs`: pass.

### 2. "Merge into…" with alias learning (function + UI)
- [x] Core `ingredientMerge.ts` (pure, unit + property tested): `mergeRefusal`, `mergeFactor` (g ↔ count by unit
      weight), `moveLots`, `copiedHistory` (Σ transactions == amount on both rows), `repointLines`/`repointSides`,
      `mergeGroceryItems`, `mergedTarget` (alias learning, capped at 40; fills missing conversions), `MergeReport`.
- [x] Callable `mergeIngredient({ fromId, intoId, dryRun? })` in `functions/src/ingredients.ts`: verified + allowlisted
      callers; recipes (all statuses) repointed and re-derived without a version bump; version snapshots repointed
      (collection-group index on `versions.ingredientIds`); saved meals' sides; per household one transaction moving
      lots and copying history onto the target row (source row kept: amount 0, `merge` − transactions, `mergedInto`);
      planned sides, draft/ordered grocery lines, brand mapping, sourcing rule, cadence, likes/dislikes, `settings.sides`;
      ingredient docs last (target aliases, duplicate tombstone `mergedInto`, `needsReview: false`). Idempotent.
- [x] Decision: a shipped catalogue ingredient (no `createdBy`) is never merged into one that isn't (refused); version
      snapshots are repointed in place without a new version; tombstones instead of deletes; Supply rows never deleted.
- [x] Commands treat a merged ingredient as its target (an offline `addSupply` queued before the merge).
- [x] Functions test `functions/test/ingredients.test.ts` (6 tests); rules test: clients can't set `mergedInto` or edit
      a tombstone (rules unchanged: `mergedInto` isn't in `validIngredient`).
- [x] UI: Ingredients page review cards (recipes using it, "Looks like:", Merge into…, Keep as new), `<MergeSheet>`
      (suggestion chips, picker without create, dry-run preview "Moves 1 recipe, 1 Supply row to …", confirm, success
      banner), `$id.tsx` merge panel and merged notice. Pickers skip tombstones and fold spelling variants; the Supply
      page hides merged rows.
- [x] Spec §2 quota rows (callable, needs-review listener).

### 3. A strict skill
- [x] SKILL.md step 6: mandatory token validation (strip preparation words, look up, fold variants, "means the same
      thing", else a new name listed with a one-line reason in the delivery message); wrong → right table; checklist.
- [x] conventions.md "Ingredient names" rewritten; references/ingredients.md (generated) lists preparation words,
      state words and spelling variants from core. `skill.test.ts` (examples import with no new ingredient) passes.

### 4. Review is discoverable
- [x] Settings → Ingredients ("Catalogue, aliases, N need review" + count badge), phone More sheet link (the desktop
      side nav has no secondary list, so Settings covers it there), Recipes banner (session-dismissable), Drop page
      link, import notification's second link `link2` "Review ingredients".
- [x] Ingredients page opens on the review list while anything needs review (`?view=review|all`).
- [x] PRD R4.27 (review and merge), R8.16 (a merge moves Supply), R4.16 matching sentence, §12 Settings row and the
      Ingredients note; spec §4.1/§4.2, §6 "Merging ingredients", §9 matcher/review/strict skill, §10, §12, §14.1, §15;
      CLAUDE.md; Planning/README.md.
- [x] E2E: `drop-folder.spec.ts` matcher test (@R4.16 @R4.17: "chopped chicken thighs, boneless", "butter (softened)",
      "Diced Yellow Onions", "courgettes", "chilli powder", "salt, to taste" → catalogue, no new ingredient, no review
      link); `ingredients.spec.ts` (@R4.27 @R8.16 @R4.16: new name → notification with Review ingredients → Recipes
      banner → Settings count → Merge into… repoints the recipe and moves a seeded Supply lot, Σ transactions == amount,
      alias learned, merged notice; More sheet link on phones). Skill example still imports clean (existing @R4.17).
- [x] `visual.spec.ts` hides the ingredient banner like the duplicate banner (it depends on the run's data).

### 5. Live cleanup
- [x] `scripts/review-ingredients.ts` (`pnpm review:ingredients`, dry run by default, `--merge`, `--emulator`): table of
      every needs-review ingredient with suggestion, confidence, other suggestions and recipes; `--merge` merges only
      exact/variant matches via `functions/src/ingredients.ts` (the callable's code), pairs of two new spellings into
      the one more recipes use. Tested on the emulator.
- [x] Live run after deploy (results below): 3 merged, 59 left for review.

### Fixes landed during M8

- [x] Installed copies of the app never picked up a deploy until site data was cleared: the self-registered worker
      (`injectRegister: false`) got no `skipWaiting`/`clientsClaim` from the plugin's `autoUpdate` mode, so each
      new build waited forever behind the open app. Now prompt mode with an hourly / on-foreground update check,
      an immediate self-reload (held behind a sticky Reload banner while cooking), and `no-cache` on the entry
      points in `firebase.json`. Spec §12 "Updates". Devices still running the old worker need one full close of
      the app after this deploy; every deploy after that applies on its own.

## Verification

- Lint, typecheck: clean. Core unit 575/575 (ingredient.test.ts 131 + ingredientMerge.test.ts 7 new), web unit 7/7.
- Rules 96/96 (+3 assertions: `mergedInto` can't be written by clients). Functions 10 files / 60 tests (+6 merge).
- `pnpm ingredients:validate`, `data/recipes/check-cooklang.mjs` (28/28), `pnpm gen:skill` up to date.
- Playwright, `--workers=1`, one project at a time: desktop-1080p ingredients + drop-folder 9 passed, 1 skipped (phones
  only); supply, recipe-edit, settings, notifications, recipes-browse, a11y, responsive, visual 49 passed + 1 skipped
  after hiding the new banner in the visual Recipes baseline (it failed 2/4 before: run-dependent banner).
  phone-ios ingredients + drop-folder 10/10; the same eight specs 47 passed, 5 skipped.
- `pnpm e2e:coverage`: all done milestones ok; M8 4/4 tagged (R4.16, R4.17, R4.27, R8.16).
- Design-compare (Latte; phone 390–430 and desktop 1920×1080, emulator data): the prototype has no Ingredients page;
  the review cards use its card pattern (3 px border, hard shadow, mono uppercase meta, accent primary + base secondary
  buttons) and the Recipes banner reuses the prototype's dashed duplicate-review banner (yellow count badge, →), with a
  38 px × dismiss added. Settings entry matches the other section links with the yellow count badge. No fixes needed.
- Deploy: `pnpm run deploy` (hosting, functions incl. the new `mergeIngredient`, rules, indexes):
  https://solvingfood.web.app 200, healthcheck `{"ok":true}`, an unauthenticated call to `mergeIngredient` gets
  PERMISSION_DENIED. Redeployed `mergeIngredient` alone after moving both queries before any write (the first live
  merge hit the still-building `versions.ingredientIds` index; nothing had been written).
- `pnpm ingredients:upload` (no `--force`): 12 written (the new aliases), 468 unchanged, 0 in-app-edited kept.

### Live cleanup (2026-10-12)

Dry run before: 542 ingredients, 62 need review. Auto-merged (exact / variant only, owner's ADC, same code as the
callable):

| Merged | Into | Confidence | Moved |
|---|---|---|---|
| diced green chilies | diced green chiles | variant | 1 recipe (Creamy White Chicken Chili), 1 version; alias "diced green chilies" |
| frozen tater tots | tater tots (catalogue) | exact | 1 recipe (Tater Tot Breakfast Casserole), 1 version; alias already there |
| m&m's | m&ms | variant | 1 recipe (Christmas Kitchen Sink Cookies), 1 version; alias "m&m's" |

No household had Supply, plan sides or grocery lines for them. After: 59 need review, 0 more exact/variant matches.

## Deviations and assumptions

- "cooked" is not a state word, although the brief listed it: the catalogue's "cooked chicken" and a recipe's
  "cooked rice" are bought differently from the raw form (a cup of cooked rice is a third of a cup of rice), so
  "cooked X" never silently becomes X. "uncooked" is dropped (the catalogue holds raw products).
- "mild" is a preparation word (for matching and for new names) so the three live green chile spellings converge.
- Live suggestion "similar" uses words with preparation words removed on both sides; matching itself never strips
  words from catalogue names (only from the recipe's wording), so "whole chicken" can't swallow "chicken".

## Owner checks

- Settings → Ingredients (or More → Ingredients on the phone): 59 left. Likely merges the matcher deliberately didn't
  auto-merge: mild green chiles → diced green chiles; colby jack cheese → monterey jack / marble cheese; lettuce →
  romaine / green leaf; cranberries → dried cranberries (if the pie uses dried); graham cracker → graham cracker crumbs
  (if crushed); shredded cheese → tex mex or cheddar; pasta → a specific shape. Everything else (egg yolk, dark/milk/white
  chocolate, ghee, sumac, tzatziki, pretzels, kalamata olives…) is probably genuinely new: Keep as new and fill in
  density and protein.
- Drop a recipe with "chopped chicken thighs" or "courgettes": it should import with no new ingredient.
