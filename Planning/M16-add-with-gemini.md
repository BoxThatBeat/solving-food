# M16 — Settings → Gemini and Add with Gemini

Status: done (owner checks below: deploy, then add a recipe from a link and from a photo on the live app)

## Goal

Owner request (2026-11-01): "Move the Gemini integration into a separate settings section. Then also use this same
Gemini setup to facilitate a new feature: when user goes to add a recipe show 3 options: paste web recipe link, upload
photo of recipe, take photo of recipe. Gemini should be given a similar prompt of the skill we made for recipe
creation."

## Requirements covered

R11.15 (new: the Gemini section), R4.36 (changed: the key lives there), R4.37 (new: add a recipe with Gemini).

## Items (in build order)

### A. Core
- [x] `packages/core/src/recipeFromGemini.ts`: `renderSkillPrompt` / `renderSkillModule` (the skill as the prompt),
      `recipeInstruction` (frame: skip delivery, one ```cooklang block or NOT A RECIPE; link → `source` + image URL;
      photo → neither), `extractCook`, `notARecipe`, `dropLocalImage`, `extractRecipeJsonLd` (also in `@graph`, past a
      broken block), `htmlToText`, `pageContent`, `safeRecipeUrl` (public http(s) only). 7 unit tests.
- [x] One source of truth for the prompt: `pnpm gen:skill` renders SKILL.md + the syntax, conventions, taxonomy and
      ingredients references into `functions/src/ai/skillText.generated.ts`; `skill.test.ts` fails when it's stale.

### B. Functions
- [x] `geminiGenerate` in `functions/src/ai/gemini.ts` (free-form, inline images, 90 s) with a per-user stub
      (`_stubLlm/{uid}` or `config`: `recipe`, `pages`, `mode`); `geminiReady(uid)`.
- [x] Callable `addRecipeWithGemini` (`functions/src/ai/addRecipe.ts`; allowlisted; 240 s, 512 MiB): link → own fetch
      (15 s, ≤ 3 MB, HTML, redirect re-checked) → JSON-LD or text; photo → `recipe-photos/{uid}/…` read inline, deleted
      after (also on failure); the answer's .cook through `importCook` (exported from dropFolder.ts) under the host name
      or "your photo"; one repair round on a `CooklangError`; `aiRate/{uid}` 10 an hour (`rateLimit` takes a collection,
      limit and message now).
- [x] `storage.rules`: `recipe-photos/{uid}/{file}` create only (owner, allowlisted, image types, ≤ 10 MB, random file
      name); storage rules test.
- [x] Functions tests (`addRecipe.test.ts`, 5): link with JSON-LD (prompt has the skill and the URL; notification
      "from recipes.example.com"), refused / failing / empty pages (no Gemini call), repair round and NOT A RECIPE,
      photo inline + no image + deleted + someone else's path refused, not set up and the hourly limit.

### C. Web
- [x] Settings → Gemini (`settings/gemini.tsx`, a SECTIONS entry): what Gemini does, status for everyone, the owner's
      `<ApiKeyCard>` with the no-billing / free-tier warning (now also mentions recipe pages and photos).
- [x] Ingredients page: the key card removed; "Gemini isn't set up … Settings → Gemini" when it's off.
- [x] `<AddWithGemini>` at the top of the Add recipe sheet: link field + Add, Upload a photo (`accept="image/*"`),
      Take a photo (`capture="environment"`), a status line while it works, the error, then the recipe opens. Manual
      entry stays; "Let AI add for me" is now "Drop a .cook file".
- [x] `data/ai.ts`: `addRecipeFromLink`, `addRecipeFromPhoto` (upload, then the callable; 240 s client timeout).
- [x] Design-compare: **skipped at the owner's request** (2026-11-01). The new pieces reuse the sheet's option cards,
      the key card, dashed alerts and mono status lines.

### D. Docs and tests
- [x] PRD R4.36, R4.37, R11.15, §12 Settings row; spec §2 quota row, §4 (`aiRate`), §9 "Add with Gemini", storage
      rules, components, §15 M16 row; SETUP.md "M16"; Planning/README.
- [x] E2E `gemini.spec.ts` (@R11.15 @R4.36: section, status, owner key; @R4.37: the three options, a link becomes a
      recipe, a photo becomes a recipe without its image, not set up); `ingredients.spec.ts` updated (the key is no
      longer there).

## Decisions

- **The photo is never the recipe's image.** It's a page of a book or a card, usually badly lit; the recipe gets a
  picture later by editing. `dropLocalImage` also strips a relative `image:` Gemini might write.
- **Synchronous import.** The callable imports the file itself (`importCook`) instead of writing it to the drop folder,
  so it can open the new recipe; the import's usual notification still arrives.
- **Any allowlisted person can use it** with the owner's key; 10 per person per hour keeps the free tier safe.
- **One repair round:** a file that fails the importer's checks goes back to Gemini once with the reason.
- **Link fetching in the function**, not by Gemini (the API's URL tools aren't on every free model); JSON-LD first
  because most recipe sites publish it and it's compact.

## Verification

- Typecheck and lint (whole repo): clean. `pnpm gen:skill -- --check`: up to date.
- Core + web unit: 675 + 37 (recipeFromGemini.test.ts 7 new; skill.test.ts checks the generated prompt).
- Functions: 12 files / 73 tests (addRecipe.test.ts 5 new). Rules: 99 (recipe photos).
- Playwright desktop-1080p + phone-ios: gemini, ingredients, settings, recipes-browse, drop-folder: 63 passed,
  1 skipped (phones only). `pnpm e2e:coverage`: M16 3/3 tagged.
- Not tested against the real Gemini API or real recipe sites (stubs only).

## Fixes after deploy

- [x] (2026-11-03) thekitchn.com answered the function's fetch with **403** (it serves the page to a home connection but
      refuses Google Cloud's addresses). The app won't disguise itself to get past bot protection. Instead:
      - A chosen, taken or **pasted** photo now waits in the sheet with an optional **Recipe text** box and an Add
        button (owner: "dont explain this behavior in the UI just make the controls"), so the dish picture and the
        recipe's text copied from the page go together. Gemini says whether the photo is the dish (`PHOTO: dish`),
        and then it becomes the recipe's picture; a photo of the recipe itself still never does.
      - A 401/403/429/451 reads "That site doesn't let apps read its recipes (HTTP 403). Add a photo instead, with the
        recipe's text copied from the page."
      - Failures are logged (`add with Gemini failed`, no content) so they can be read from the function logs.
      Tests: core 2, functions 1 (dish photo kept, recipe photo not, text cleaned, bad text refused) + 404 vs 403
      messages, e2e 1 (@R4.37: 403 message, photo + text, remove photo, dish picture kept).

## Multiple photos (2026-11-11)

Owner request: "Add ability to add or take multiple photos when adding a recipe (instead of always just one). Often
there are multiple pages the recipe is on and I want a photo of the actual finished recipe too. The LLM can determine
what is what when uploaded."

- [x] Core: `MAX_RECIPE_PHOTOS` (6); the photo frame numbers the photos, says pages continue in order (or join them by
      what they say), and always asks for `DISH: <n>` / `DISH: none` (a printed picture on a page isn't the dish);
      `dishPhotoIndex` replaces `photoIsDish` (still reads `PHOTO: dish`); `notARecipe` skips a DISH line. Without text a
      dish photo now counts too (before, a lone photo without text was never kept). Tests updated (8).
- [x] Function: `{ source: "photo", paths, text? }` (1–6 distinct, all the caller's; the old `path` still accepted),
      read in parallel, ≤ 14 MB together (Gemini's 20 MB request after base64), each after a "Photo n:" label, one
      rate-limit hit per recipe, every upload deleted in `finally`. Tests: several photos (order, labels, dish 3 kept,
      all deleted), out-of-range dish, someone else's path (own one still deleted), 7 / repeated / none refused.
- [x] Web: `shrinkPhoto` (≤ 2048 px JPEG, shared with the receipt's `photoForGemini`) before upload, so six photos fit
      one Gemini request; `addRecipeFromPhotos`. The sheet: **Upload photos** (`multiple`) / **Take photos**; chosen
      photos as numbered thumbnails with a remove × (a 28 px box in a 44 px hit area), **Add a photo** / **Take a photo**
      until 6, "Up to 6 photos for one recipe" past that, pasting several pictures works. Blob URLs made and revoked in
      one effect (StrictMode had revoked the old preview's URL in dev).
- [x] E2E (@R4.37): labels updated; a new test adds two pages, then a dish, hits the 6 limit, removes three, and the
      named dish becomes the picture. PRD R4.37, spec §2 row, §9, components, storage.rules comment updated.
- [x] Screenshot check: phone 430×932 and desktop 1920×1080, the sheet empty and with three photos.

## What's left for the owner

1. Deploy (hosting, functions, storage rules).
2. Recipes → + Add recipe: paste a recipe link, and try a photo of a cookbook page from the phone. If Gemini's file
   keeps failing the checks, send the message: the frame in `recipeInstruction` is the place to tune.
