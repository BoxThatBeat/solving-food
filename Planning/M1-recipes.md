# M1 — Recipes

Status: in progress

All 30 work-breakdown tasks are built and verified (2026-10-10). The 28 household recipes and the 475-ingredient
seed are live, the app is deployed, and every M1 requirement ID has a passing, tagged Playwright test.

**Remaining** (needs the owner, so the milestone isn't marked done yet):

1. Exit criterion 1: import real recipes **via the Claude skill** end to end (give Claude a recipe link or photo with
   the `cooklang-recipe` skill, deliver with `gcloud storage cp` or the Drop page). The 28 vault recipes were loaded
   through the real drop folder, but from the hand-converted `.cook` files, not by the skill.
2. Owner sign-off on feel on a real phone (search, filters, favourites, edit, version restore, Trash), as for M0.
3. First GitHub Actions run of the full matrix after the owner pushes (every project passed locally; see Verification).

When 1–3 are done, set `Status: done`; `pnpm e2e:coverage` then enforces the 24 M1 IDs (all tagged today).

## Verification (2026-10-10)

| Layer | Result |
|---|---|
| Lint, typecheck | clean (`pnpm lint`, `pnpm typecheck`) |
| Unit (`pnpm test`) | core 169 passed (11 files, incl. fast-check unit round trips and the skill check), web 7 passed |
| Rules (`pnpm test:rules`) | 56 passed |
| Functions on the emulators (`pnpm test:functions`) | 20 passed, incl. all 28 household recipes through the real `dropFolder` trigger (photos with spaces, summed tokens, no new ingredients, three image sizes) |
| Playwright, phone-ios + desktop-1080p (final run, fresh emulators) | 117 passed, 7 skipped (Chromium-only checks on WebKit), 0 failed; `recipe-edit.spec.ts` also 48/48 over `--repeat-each=3` |
| Playwright, phone-android + desktop-firefox (smoke) + tablet + desktop-4k + desktop-4k-2x | 85 passed, 7 skipped, 0 failed (run before the last two editor/banner fixes, which the two main projects re-verified) |
| `pnpm e2e:coverage` | M1 24/24 requirement IDs tagged |
| Live | `pnpm ingredients:upload` wrote 475 then reported 475 unchanged on a re-run; `pnpm drop:recipes -- --email buitenwerfa@gmail.com` imported 28/28 as the owner (28 active, 19 with photos, 28 index summaries, 28 success notifications, 0 errors, 0 ingredients needing review); all 28 share pages render signed out at https://solvingfood.web.app with their photos; healthcheck ok |


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

**Test data already exists:** `data/recipes/` holds the owner's 28 real recipes as Obsidian notes, their
images, and hand-converted `.cook` files following the conventions in `data/recipes/README.md`. Use them as
the e2e seed set (replacing the "~30 recipes" placeholder), as drop-folder fixtures (they must all import
cleanly; any parser gap they expose is a bug in the parser, not the data), and as the first entries in the
ingredient seed list (every ingredient they mention must exist in `data/ingredients/`). The Claude skill's
conventions must match that README.

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

- [x] `packages/core/units.ts`: weight/volume static tables, `toCanonical(amount, measure, ingredient)`,
      `fromCanonical`, `formatAmount(canonical, ingredient, { original? })` producing "1 cup flour (125 g · 4.4 oz)".
      Rounding rules per unit. Property tests: round trips within tolerance; never negative.
- [x] `packages/core/ingredient.ts`: zod schema (spec §4.1), `needsReview` derivation (missing density when
      volume allowed, missing unit weight when count allowed, missing protein).
- [x] `data/ingredients/<category>.json`: curated by hand in batches (produce, meat, fish, dairy, grains,
      pantry, spices, condiments, bakery, frozen). Sources: USDA FoodData Central for density/unit weight/
      protein, USDA FoodKeeper for shelf lives. Target 500; ship M1 with ≥ 250 and grow.
      Mark free-use (oils, salt, pepper, butter, sugar, condiments) per PRD R8.14; spices tracked.
      `defaultPackAmount`/`defaultPackMeasure` for common grocery packs; `defaultCadenceDays` for staples.
- [x] `data/scripts/validate.ts` (schema + uniqueness of names/aliases), `data/scripts/upload.ts`
      (Admin SDK upsert into `ingredients`, idempotent, works against emulator and live).
- [x] `<IngredientPicker>`: typeahead over name + aliases from a cached `ingredients` listener; "create new"
      path asks category, allowed measurements, conversions. Ingredient editor page at `/ingredients/:id`
      (edit conversions, flags). Rules: `ingredients` readable publicly (get), writable by allowlisted users.

### 2. Recipe model, editor, versioning

- [x] `packages/core/recipe.ts`: zod schema per spec §4.1, `proteinPerServing(recipe, ingredients)`,
      `fingerprint(recipe)`, `canonicalUrl(url)`, `scale(recipe, servings)`.
- [x] Step text format: plain text with `{{ing:<lineId>}}` placeholders; `renderStep()` replaces with the name
      and inline amount (R4.11). `prepTasks` same format (R4.12 data; the screen is M3).
- [x] `/recipes/new` and `/recipes/:id/edit`: react-hook-form + zod; sections: basics (title, servings,
      times, cuisine, main protein from taxonomy, tags, tools as free text chips for now), images (browser
      resize to 480/960/1920 WebP via canvas, upload to `recipes/{id}/{size}.webp`), ingredients
      (picker + amount + measure limited to allowed), steps (textarea with an "insert ingredient" chip that
      writes the placeholder, timer seconds), prep tasks, leftover portions + meal type, source URL.
- [x] Save = batch: recipe doc with `version + 1`, `versions/{n}` snapshot. Concurrent-edit check: compare
      `version` on open vs. before save → "edited elsewhere" dialog. Offline: save disabled, draft in IndexedDB
      (`idb-keyval`), "will save when online".
- [x] Version history drawer with restore (saves snapshot as new version).
- [x] Delete → Trash (`status: trashed`), `/recipes/trash` with Restore; purge in the maintenance function;
      `onDocumentDeleted(recipes/*)` cleanup (versions, images, index, meals, household refs) per spec §4.4.
      Meals don't exist until M2; write the cleanup to handle them anyway.

### 3. Search, browse, detail

- [x] `functions/src/recipeIndex.ts`: `onDocumentWritten(recipes/{id})` → upsert/remove summary in
      `recipeIndex/{chunk}`; chunk assignment on create. Transaction per write.
- [x] `apps/web/src/search/`: load chunks via live query, build MiniSearch (title, tags, ingredient names,
      household notes), Web Worker when > 1,000 recipes.
- [x] `<CollectionView>`: search box, filter sheet (cuisine, main protein, protein ≥, total/active time ≤,
      rating ≥, cooked before, cost ≤, tags, favourites; supply-based ones greyed "available in M3"), sort
      (name, time, protein, rating, newest, Suggested = placeholder "newest" until M5). Filter state in URL.
      Matches the prototype's filter sheet.
- [x] `<RecipeCard>` (image, title, time, protein, favourite toggle, "made n times" placeholder) with
      container queries; auto-fill grid.
- [x] `/recipes/:id`: hero image with `srcset`, meta row, ingredients list (amounts metric + imperial,
      `<SupplyBadge>` slot rendering "—" until M3), steps with inline amounts, tools (flag missing when
      household tools configured; M2), source link, household notes editor (`notes/{recipeId}`), favourite,
      Edit, Export `.cook`, Copy link, Delete.
- [x] Servings scaler on the detail page (R4.13).
- [x] Favourites: `favourites/{recipe_id}` docs; filter and badge.

### 4. Notifications

- [x] `<NotificationBanners>` fed by `users/{uid}/notifications` where `dismissedAt == null`, plus local
      messages. Auto-dismiss success/info after 6 s (writes `dismissedAt`), errors persist. Link support.
- [x] `functions/src/notify.ts` helper used by every function that reports to a user.

### 5. Drop folder and Claude skill

- [x] `packages/core/cooklang/`: parser (evaluate `@cooklang/cooklang-ts`; wrap or replace), front-matter
      schema (zod: title, servings, cuisine, main_protein, prep_time, cook_time, tags; optional source, image,
      leftover_portions, prep), `cooklangToRecipe()` (ingredient resolution by name/alias → unknown →
      create with `needsReview`), `recipeToCooklang()` for export. Round-trip tests.
- [x] `functions/src/dropFolder.ts`: `onObjectFinalized` → ignore non `recipe-drop/` paths → download → parse
      → validate → resolve → image download + `sharp` resize to three sizes → dedupe check → create recipe
      (`active` or `pendingDuplicateReview`) → delete file → notification. Error path → notification + delete.
- [x] `/drop` page: drag-and-drop + file picker, multi-file, uploads to `recipe-drop/{uid}/`, shows results via
      notifications. Storage rules: own folder only, `.cook`, ≤ 1 MB.
- [x] `.claude/skills/cooklang-recipe/SKILL.md` + `reference.md` (syntax), `taxonomy.md` generated from
      `packages/core/taxonomy.ts` by a script (`pnpm gen:skill`), worked examples (web page, photo), delivery
      via `gcloud storage cp` to `gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/` or local save.
- [x] Export: Download `.cook` from the detail page (client-side).

### 6. Deduplication

- [x] `packages/core/dedupe.ts`: `findDuplicates(candidate, index)` using canonical URL, title trigram +
      ingredient Jaccard, fingerprint. Unit tests with near-miss cases.
- [x] Editor: run before save; dialog keep existing / keep new / keep both.
- [x] Recipes page: "Needs review" section listing `pendingDuplicateReview` recipes with side-by-side compare
      and the three actions (keep new = copy onto existing ID as new version, then hard-delete the import).

### 7. Share links

- [x] `/recipes/:id` renders for signed-out visitors: public `get` rule on `recipes` and `ingredients`,
      public read on `recipes/**` images in Storage. Hide notes, favourites, supply badges, edit controls.
      "Copy link" button with the toast from the prototype.

### 8. Maintenance function

- [x] `functions/src/maintenance.ts`: `onSchedule("every monday 04:00", { region: "us-east1" })` → purge
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
      (28 vault recipes loaded live through the drop folder from the hand-converted files: all imported, and all 19
      that have a photo in the vault arrived with it; the other 9 have no photo in the vault. The skill step is the
      owner's: see Remaining.)
- [x] Search, filters, favourites, edit, version restore, Trash and restore all work on a phone.
      (Playwright on phone-ios and phone-android against the emulators; the owner's real-phone sign-off is in Remaining.)
- [x] A share link opens in a private window with no account. (Live: all 28 recipe pages in a fresh browser context.)
- [x] Protein per serving shows on cards for recipes whose ingredients all have protein data; others show "~".
      (recipes-browse.spec.ts; live, all 28 have full protein data.)

## Risks and notes

- Ingredient curation is the long pole. Start it on day one of M1 in parallel with code; the first 100 are the
  ones in the family recipes.
- `sharp` in functions needs the Linux x64 binary; `pnpm` with `--config.platform` handled by the Functions
  build (Cloud Build installs). Test the deploy early.
- Cooklang parsers vary in front-matter support; the zod schema is the contract, not the parser.

## Deviations and decisions (2026-10-10)

- **Cooklang parser:** written in `packages/core/src/cooklang/` instead of wrapping `@cooklang/cooklang-ts`, which
  predates YAML front matter, sections, and notes and is unmaintained. Round trips are tested over all 28 real files
  (example-based) rather than generated recipes.
- **Skill layout:** `SKILL.md` plus `references/syntax.md` (the plan's `reference.md`), `references/conventions.md`,
  `references/delivery.md`, and two generated files, `references/taxonomy.md` and `references/ingredients.md` (the
  seed's 475 names and aliases, so an LLM picks names that resolve). `examples/web-page.md`, `examples/photo.md`.
  `packages/core/src/skill.test.ts` fails when the generated files are stale and imports every example.
- **House conventions follow `data/recipes/README.md`**, not spec §9's "metric weights": recipes keep their own units
  and the app converts. §9 updated.
- **Drop loader** (`scripts/lib/drop.ts`, used by `pnpm drop:recipes`, the e2e seed, and the functions test): a few
  recipes in flight, photo before its `.cook`, and a `.cook` still there after 60–120 s is re-uploaded as a new
  generation. Reason: a busy Functions emulator drops Storage events, and live triggers are capped at 2 instances.
- **Emulator ingredient uploads are paced** (4 per batch, 120 ms apart): each write fires `ingredientRecipes`, and a
  burst made the Functions emulator start ~60 worker processes (~5 GB) and drop drop-folder events.
- **Deploy before loading:** the live recipes were loaded after the deploy (the drop folder needs `dropFolder`).
  The first deploy of event-triggered functions failed until the Eventarc service agent's permissions propagated;
  a redeploy a few minutes later succeeded (SETUP.md).
- **E2E seed:** global setup loads the 475 ingredients and the 28 recipes through the real drop folder (~40 s) as
  `e2e-seed`. Specs only read those; any spec that edits, trashes, or dedupes makes its own recipe with a unique title
  (and, for drops, an extra randomly sized ingredient, because the fingerprint rounds per-serving amounts to 5 g and
  identical copies from parallel projects would otherwise be flagged as duplicates of each other).
- **The 30-day purge** is covered by the functions emulator tests, not Playwright (a scheduled function can't be
  triggered from the browser).
- **Maintenance also sweeps drop-folder leftovers older than a day** (stray photos with no recipe).
- **Images:** recipes without a photo in the vault (9 of 28) show the prototype's cuisine stripes; nothing invented.
- **Notification stack:** at most 3 banners, then a "+N more · Dismiss all" row; a bulk drop reports one per file
  (the owner will see 28 import notifications on first open). The banner region is always mounted as a live region
  and sits above sheets (z-60), so banners are announced and visible while a sheet is open.
- **Filter URLs** use comma lists (`?cuisine=greek,thai`), not the router's default JSON arrays.
- **Ingredient picker:** a blur-then-refocus no longer closes the suggestion list (found by the specs).
- **Editor insert-ingredient chips** track the caret on every selection change and restore it synchronously (a
  deferred restore landed after further typing on WebKit).
- **Formatting:** tiny imperial amounts read "<0.1 oz" instead of "0 oz".

## Design-compare notes (phone 430×932, desktop 1920×1080, Latte)

Matched to the prototype: recipe list and cards, filter sheet, recipe detail (pane and full page), review sheet,
banners. Fixed during the pass: card photos broke the 4:5 image box and rows had uneven heights; detail meta values
and the servings number rendered in the base colour (`text-base` is a colour token here); recipe count added to the
side nav; editor save bar left a strip of page showing above the phone tab bar; dates now day-first ("LAST 21 SEP").

Intentional differences:

- Accessibility over exact colours: main-protein badge and FAMILY badge are lightened (prototype 3.6:1 and 3.7:1 with
  ink text), filter-chip counts are full opacity, the drop page's gcloud command wraps instead of scrolling.
- Banners are full-width with a link and a dismiss button (R12.1); the prototype's toast is a small pill.
- Not in the prototype, built in its language: Trash link and page, recipe editor, Drop page, ingredient editor,
  version history sheet. The prototype's "Add recipe" sheet with an inline drop list became the Add sheet plus `/drop`.
- Not yet shown (later milestones): $/serving and cost filters (M2), supply badges and "can make" (M3), "Use it or
  lose it" (M5).

