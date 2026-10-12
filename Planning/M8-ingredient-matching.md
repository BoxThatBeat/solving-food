# M8 — Ingredient matching

Status: in progress

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
- [ ] Callable `mergeIngredient({ fromId, intoId, dryRun? })` in `functions/src/ingredients.ts`.
- [ ] UI on the Ingredients page and `$id.tsx`.

### 3. A strict skill
- [ ] SKILL.md validation step, conventions.md, wrong → right table.

### 4. Review is discoverable
- [ ] Settings entry with a live count, More sheet, Recipes banner, Drop page link, notification's second link.
- [ ] PRD, spec, tagged e2e tests.

### 5. Live cleanup
- [ ] `scripts/review-ingredients.ts` dry run; auto-merge only exact / variant pairs.

## Verification

## Deviations and assumptions

- "cooked" is not a state word, although the brief listed it: the catalogue's "cooked chicken" and a recipe's
  "cooked rice" are bought differently from the raw form (a cup of cooked rice is a third of a cup of rice), so
  "cooked X" never silently becomes X. "uncooked" is dropped (the catalogue holds raw products).
- "mild" is a preparation word (for matching and for new names) so the three live green chile spellings converge.
- Live suggestion "similar" uses words with preparation words removed on both sides; matching itself never strips
  words from catalogue names (only from the recipe's wording), so "whole chicken" can't swallow "chicken".

## Owner checks
