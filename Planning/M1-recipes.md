# M1 — Recipes

Status: not started

## Goal

A usable global recipe library: ingredients with real units, a structured recipe editor, search and
filtering, versioning with Trash, the Cooklang drop folder with its Claude skill so recipes arrive from an
LLM, deduplication, share links, and the notification system that reports background results. After M1 the
household can build its library; nothing is planned or cooked yet.

## Requirements covered

R2.9, R4.1, R4.2 (all filters except the supply-based ones, which are M3), R4.5 (favourite count only; cook
stats are M3), R4.6, R4.7 (component; used by Recipes and Meals now, Plan/History later), R4.8 (without
supply badges), R4.11, R4.13, R4.14 (tools flag; tools setting is M2 → stub as "no tools configured"),
R4.15–R4.22, R4.25, R4.26, R6.15 (protein per serving shown), R8.3 (allowed measurements on ingredients),
R8.13 (formatting), R12.1.

## Prerequisites

M0 done. Nothing from Firebase beyond M0.

## Deliverables

1. `data/ingredients/` seed set (~500) with units, densities, unit weights, protein, shelf lives, free-use
   flags, default pack sizes, default cadence; a validator; an upload script.
2. `packages/core/units`: conversions, canonicalisation, `formatAmount()` (metric + imperial).
3. Recipe CRUD with versioning, Trash and restore, purge + cleanup function, search index function,
   MiniSearch client search, `<CollectionView>` filters and sorts.
4. Recipe detail (ingredients with inline amounts in steps, scaling, tools flag, protein), images in three sizes.
5. Drop folder: Storage trigger → Cooklang parser → recipe; `.claude/skills/cooklang-recipe/SKILL.md`; in-app
   drop area and `gcloud storage cp` path; `.cook` export.
6. Deduplication on manual save and on import, with the review list.
7. Share links readable without an account.
8. Notification system backed by `users/{uid}/notifications`.
9. Weekly maintenance scheduled function (trash purge only; M5 adds prices).

## Work breakdown

### 1. Units and ingredients (core + data)

- [ ] `packages/core/units.ts`: weight/volume static tables, `toCanonical(amount, measure, ingredient)`,
      `fromCanonical`, `formatAmount(canonical, ingredient, { original? })` producing "1 cup flour (125 g · 4.4 oz)".
      Rounding rules per unit. Property tests: round trips within tolerance; never negative.
- [ ] `packages/core/ingredient.ts`: zod schema (spec §4.1), `needsReview` derivation (missing density when
      volume allowed, missing unit weight when count allowed, missing protein).
- [ ] `data/ingredients/<category>.json`: curated by hand in batches (produce, meat, fish, dairy, grains,
      pantry, spices, condiments, bakery, frozen). Sources: USDA FoodData Central for density/unit weight/
      protein, USDA FoodKeeper for shelf lives. Target 500; ship M1 with ≥ 250 and grow.
      Mark free-use (oils, salt, pepper, butter, sugar, condiments) per PRD R8.14; spices tracked.
      `defaultPackAmount`/`defaultPackMeasure` for common grocery packs; `defaultCadenceDays` for staples.
- [ ] `data/scripts/validate.ts` (schema + uniqueness of names/aliases), `data/scripts/upload.ts`
      (Admin SDK upsert into `ingredients`, idempotent, works against emulator and live).
- [ ] `<IngredientPicker>`: typeahead over name + aliases from a cached `ingredients` listener; "create new"
      path asks category, allowed measurements, conversions. Ingredient editor page at `/ingredients/:id`
      (edit conversions, flags). Rules: `ingredients` readable publicly (get), writable by allowlisted users.

### 2. Recipe model, editor, versioning

- [ ] `packages/core/recipe.ts`: zod schema per spec §4.1, `proteinPerServing(recipe, ingredients)`,
      `fingerprint(recipe)`, `canonicalUrl(url)`, `scale(recipe, servings)`.
- [ ] Step text format: plain text with `{{ing:<lineId>}}` placeholders; `renderStep()` replaces with the name
      and inline amount (R4.11). `prepTasks` same format (R4.12 data; the screen is M3).
- [ ] `/recipes/new` and `/recipes/:id/edit`: react-hook-form + zod; sections: basics (title, servings,
      times, cuisine, main protein from taxonomy, tags, tools as free text chips for now), images (browser
      resize to 480/960/1920 WebP via canvas, upload to `recipes/{id}/{size}.webp`), ingredients
      (picker + amount + measure limited to allowed), steps (textarea with an "insert ingredient" chip that
      writes the placeholder, timer seconds), prep tasks, leftover portions + meal type, source URL.
- [ ] Save = batch: recipe doc with `version + 1`, `versions/{n}` snapshot. Concurrent-edit check: compare
      `version` on open vs. before save → "edited elsewhere" dialog. Offline: save disabled, draft in IndexedDB
      (`idb-keyval`), "will save when online".
- [ ] Version history drawer with restore (saves snapshot as new version).
- [ ] Delete → Trash (`status: trashed`), `/recipes/trash` with Restore; purge in the maintenance function;
      `onDocumentDeleted(recipes/*)` cleanup (versions, images, index, meals, household refs) per spec §4.4.
      Meals don't exist until M2; write the cleanup to handle them anyway.

### 3. Search, browse, detail

- [ ] `functions/src/recipeIndex.ts`: `onDocumentWritten(recipes/{id})` → upsert/remove summary in
      `recipeIndex/{chunk}`; chunk assignment on create. Transaction per write.
- [ ] `apps/web/src/search/`: load chunks via live query, build MiniSearch (title, tags, ingredient names,
      household notes), Web Worker when > 1,000 recipes.
- [ ] `<CollectionView>`: search box, filter sheet (cuisine, main protein, protein ≥, total/active time ≤,
      rating ≥, cooked before, cost ≤, tags, favourites; supply-based ones greyed "available in M3"), sort
      (name, time, protein, rating, newest, Suggested = placeholder "newest" until M5). Filter state in URL.
      Matches the prototype's filter sheet.
- [ ] `<RecipeCard>` (image, title, time, protein, favourite toggle, "made n times" placeholder) with
      container queries; auto-fill grid.
- [ ] `/recipes/:id`: hero image with `srcset`, meta row, ingredients list (amounts metric + imperial,
      `<SupplyBadge>` slot rendering "—" until M3), steps with inline amounts, tools (flag missing when
      household tools configured; M2), source link, household notes editor (`notes/{recipeId}`), favourite,
      Edit, Export `.cook`, Copy link, Delete.
- [ ] Servings scaler on the detail page (R4.13).
- [ ] Favourites: `favourites/{recipe_id}` docs; filter and badge.

### 4. Notifications

- [ ] `<NotificationBanners>` fed by `users/{uid}/notifications` where `dismissedAt == null`, plus local
      messages. Auto-dismiss success/info after 6 s (writes `dismissedAt`), errors persist. Link support.
- [ ] `functions/src/notify.ts` helper used by every function that reports to a user.

### 5. Drop folder and Claude skill

- [ ] `packages/core/cooklang/`: parser (evaluate `@cooklang/cooklang-ts`; wrap or replace), front-matter
      schema (zod: title, servings, cuisine, main_protein, prep_time, cook_time, tags; optional source, image,
      leftover_portions, prep), `cooklangToRecipe()` (ingredient resolution by name/alias → unknown →
      create with `needsReview`), `recipeToCooklang()` for export. Round-trip tests.
- [ ] `functions/src/dropFolder.ts`: `onObjectFinalized` → ignore non `recipe-drop/` paths → download → parse
      → validate → resolve → image download + `sharp` resize to three sizes → dedupe check → create recipe
      (`active` or `pendingDuplicateReview`) → delete file → notification. Error path → notification + delete.
- [ ] `/drop` page: drag-and-drop + file picker, multi-file, uploads to `recipe-drop/{uid}/`, shows results via
      notifications. Storage rules: own folder only, `.cook`, ≤ 1 MB.
- [ ] `.claude/skills/cooklang-recipe/SKILL.md` + `reference.md` (syntax), `taxonomy.md` generated from
      `packages/core/taxonomy.ts` by a script (`pnpm gen:skill`), worked examples (web page, photo), delivery
      via `gcloud storage cp` to `gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/` or local save.
- [ ] Export: Download `.cook` from the detail page (client-side).

### 6. Deduplication

- [ ] `packages/core/dedupe.ts`: `findDuplicates(candidate, index)` using canonical URL, title trigram +
      ingredient Jaccard, fingerprint. Unit tests with near-miss cases.
- [ ] Editor: run before save; dialog keep existing / keep new / keep both.
- [ ] Recipes page: "Needs review" section listing `pendingDuplicateReview` recipes with side-by-side compare
      and the three actions (keep new = copy onto existing ID as new version, then hard-delete the import).

### 7. Share links

- [ ] `/recipes/:id` renders for signed-out visitors: public `get` rule on `recipes` and `ingredients`,
      public read on `recipes/**` images in Storage. Hide notes, favourites, supply badges, edit controls.
      "Copy link" button with the toast from the prototype.

### 8. Maintenance function

- [ ] `functions/src/maintenance.ts`: `onSchedule("every monday 04:00", { region: "us-east1" })` → purge
      recipes with `trashedAt < now − 30 d`. M5 adds the price refresh to this same function.

## Data & rules introduced

`ingredients`, `recipes` (+ `versions`), `recipeIndex`, `households/*/favourites`, `households/*/notes`,
`users/*/notifications`. Storage: `recipes/{id}/**` (public read, allowlisted write ≤ 2 MB),
`recipe-drop/{uid}/**`.

## Tests

- Unit: units and formatting, protein per serving, fingerprint/canonical URL, cooklang round trip, dedupe,
  step rendering, scaling. Property: unit conversions round-trip; `recipeToCooklang ∘ cooklangToRecipe` stable.
- Rules: recipes public get / allowlisted list; version bump enforced; versions create matches; hard delete only
  for `pendingDuplicateReview`; ingredients rules; notes/favourites per household; notifications private.
- Functions: index add/update/remove and chunk assignment; drop pipeline (good, bad, duplicate, image fail,
  non-drop path ignored); purge + cleanup; notification helper.
- E2E: `recipes-browse`, `recipe-detail` (M1 parts), `recipe-edit`, `drop-folder`, `notifications`, `sharing`.

## Exit criteria

- [ ] Owner imports 20 real family recipes via the Claude skill and the drop folder; all arrive with images.
- [ ] Search, filters, favourites, edit, version restore, Trash and restore all work on a phone.
- [ ] A share link opens in a private window with no account.
- [ ] Protein per serving shows on cards for recipes whose ingredients all have protein data; others show "~".

## Risks and notes

- Ingredient curation is the long pole. Start it on day one of M1 in parallel with code; the first 100 are the
  ones in the family recipes.
- `sharp` in functions needs the Linux x64 binary; `pnpm` with `--config.platform` handled by the Functions
  build (Cloud Build installs). Test the deploy early.
- Cooklang parsers vary in front-matter support; the zod schema is the contract, not the parser.
