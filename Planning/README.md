# Planning

One file per milestone, in build order. Each plan turns the milestone row in `TECHNICAL_SPECS.md` §15 into
ordered, checkable tasks with the files they touch, the tests that prove them, and the exit criteria.

| File | Milestone | Depends on | Delivers |
|---|---|---|---|
| [M0-skeleton.md](M0-skeleton.md) | Skeleton | — | Monorepo, Firebase wiring, emulators, PWA shell, theme, sign-in with allowlist, first household, CI, Playwright harness |
| [M1-recipes.md](M1-recipes.md) | Recipes | M0 | Ingredient seed data, recipe editor, versioning, Trash, search, drop folder + Claude skill, dedupe, share links, notifications |
| [M2-plan-grocery.md](M2-plan-grocery.md) | Plan + Grocery | M1 | Periods, household settings, meals, Plan page, budget meter, brand mappings, stores, grocery builder, copy button |
| [M3-supply-cooking.md](M3-supply-cooking.md) | Supply & Cooking | M2 | Commands + ledger, Supply page, receive groceries, cooking views, timers, review flow, leftovers, expiry, History |
| [M4-households.md](M4-households.md) | Households | M3 | Directory, invites, multiple households, member management, data download & import |
| [M5-smarts.md](M5-smarts.md) | Smarts | M3 (M4 optional) | Suggestions, weights, protein goals, optimiser, expiry alerts, staples cadence, PC Express module |
| [M6-sides.md](M6-sides.md) | Sides | M5 | Sides on meals with per-person portions, seed sides, Settings → Sides, sides on the grocery list, in the budget, deducted from Supply at Done cooking |
| [M7-review-fixes.md](M7-review-fixes.md) | Review fixes | M6 | Owner review: units v3, version history, recipe page actions, Recipes skeletons, restart period, kitchen tool names, Plan page layout |
| [M8-ingredient-matching.md](M8-ingredient-matching.md) | Ingredient matching | M7 | Matcher (variants, preparation words, suggestions), Merge into… (moves Supply, learns aliases), strict skill, discoverable review, live cleanup |
| [M9-owner-review-2.md](M9-owner-review-2.md) | Owner review 2 | M8 | Latte only, side recipes, meal type first, Supply search, cooking back/scroll, review marks eaten, eating out, expiring meals first, use it up before ordering, fibre, nutrition switch |
| [M10-owner-review-3.md](M10-owner-review-3.md) | Owner review 3 | M9 | Skill splits long steps, more-text arrow in step mode, recipe thumbnails everywhere, staples on the grocery list, Nutrition Facts panel (Canadian Nutrient File) |
| [M11-hands-free.md](M11-hands-free.md) | Hands-free mode | M10 | A voice assistant in the cooking views: read-aloud ingredients and steps, spoken commands (next, back, ingredients, steps, stop, mute), Whisper tiny.en on the device in a Web Worker, nothing recorded while off |
| [M12-hands-free-fixes.md](M12-hands-free-fixes.md) | Hands-free fixes | M11 | Owner bug report: reading aloud actually heard (speaker browser rules, Safari unlock), a can't-read-aloud state that keeps listening, no start without a tap, crash-loop guard, CPU model on Safari/iOS, service-worker cache for the WASM |
| [M13-hands-free-ios-latency.md](M13-hands-free-ios-latency.md) | Hands-free on iOS and latency | M12 | Owner report: listening recovers after reading on iPhone (context resume, track watch, mic re-acquire, iOS pauses listening while speaking), bounded echo filter, 0.7 s silence wait, Moonshine base instead of Whisper (benchmarked), heard look, hidden `?voicedebug=1` diagnostics |
| [M14-pcx-key.md](M14-pcx-key.md) | PC Express key | M5 | Owner question: no PC Express account (sign-in and secrets removed), the public API key as an owner setting in Settings → Stores, tried on save, no redeploy when Loblaw rotates it |
| [M15-llm-ingredients.md](M15-llm-ingredients.md) | LLM ingredients | M14 | Owner request: Gemini (free tier) decides imported names before anything is created, Check with Gemini merges waiting names, Copy for Claude fallback, review/merge UI removed, "From PC Express" labels |
| [M16-add-with-gemini.md](M16-add-with-gemini.md) | Add with Gemini | M15 | Owner request: Settings → Gemini section; Add recipe from a web link, an uploaded photo or the camera, Gemini following the Claude skill, imported by the drop-folder importer |
| [M17-grocery-remove.md](M17-grocery-remove.md) | Grocery remove | M10 | Owner request: an × on every grocery line to take off an ingredient the household doesn't want; it stays off (and out of the budget) until Regenerate puts every removed line back |
| [M18-store-orders-expiry.md](M18-store-orders-expiry.md) | Store orders, expiry dates | M17 | Owner request: each store ordered on its own day, Set date on any Supply lot, the confirm sheet scrolls, canned names guessed as pantry |
| [M19-declutter.md](M19-declutter.md) | Declutter | M18 | Owner request: Supply without count/explainer, filters in a sheet like Recipes (deduped), the bracket only when planned, amounts in the unit they were added in; Grocery List title alone; Settings without kickers |
| [M20-settings-groups.md](M20-settings-groups.md) | Settings groups | M19 | Owner request: Settings sections under five headings with a search box, Account and Nutrition goals as their own pages, invites only when open, Instructions for ChatGPT in Settings → Stores too |
| [M21-core-fixes.md](M21-core-fixes.md) | Core fixes | M20 | Verified bugs in `packages/core` (freeze after Still good, package units, Cooklang timers and amounts, negative °C, protein × multiplier, tiny expiring spare, DST at midnight, un-removed grocery lines), a faster optimiser cost path, `grocery/` split, shared math and ingredient types, tree-shakeable core |
| [M22-backend-hardening.md](M22-backend-hardening.md) | Backend hardening | M21 | Allowlisted callables and an owner-only merge, timer rate limit, stuck commands failed, long grocery lists in chunks, path-safe command IDs, write-then-delete import, `safeFetch` against SSRF, tighter rules, retention and orphan sweeps, maintenance alert, backups and alerts for the owner, safer deploy order |
| [M23-web-data-layer.md](M23-web-data-layer.md) | Web data layer and bundle | M22 | Fewer listeners (one navigation per width, diffed per-ID listeners, one shared plan model), listener errors as banners, writes that never wait for the server, connectivity from Firestore, `useNow`, grocery order transactions, bounded History reads, instant landing, per-device success banners, one 180 kB plan worker, hidden source maps, dead code removed |
| [M24-ux-polish.md](M24-ux-polish.md) | UX polish | M23 | Plan alerts fold to one line once seen on phones, Suggested by meal type (tabs, opens on the emptiest strip row), stub recipes never suggested ("needs ingredients"), Supply's filter sheet a draft like Recipes, 44 px touch targets checked in e2e, step mode arrow a button with one live region, History stats that load before saying "Nothing yet", use-it-up copy, phone OFFLINE badge |
| [M25-receipt-import.md](M25-receipt-import.md) | Receipt import | M24 (M16, M18) | From a receipt on the confirm sheet: a receipt photo or the order email's text read by Gemini, matched to the order, the sheet prefilled and marked (packs, substitutions, didn't come, paid prices, lines not on the list), paid prices stored, History spend actual or estimated |
| [M26-next-period.md](M26-next-period.md) | Next period | M25 (M2, M7, M17, M18) | This period · Next period on the Plan and Grocery pages: plan and order the next period before it starts (its own strip, list, budget, suggestions and optimiser on the Supply projected at its start, its own draft and orders); the rollover adopts it with no copies; a restart moves it |
| [M27-deals.md](M27-deals.md) | Deal awareness | M26 (M5, M14, M25) | A price history per brand mapping (the weekly PC Express price and receipts), usual price and on sale (15 % below, 4 prices); Deal chips on brands, grocery lines, suggestion and plan cards; the On sale suggestion factor and weight; on-sale staples pulled forward within the budget; History → Prices |

## How to use these plans

- **Read the current plan before coding.** Tasks are ordered; later tasks assume earlier ones exist.
- **Tick checkboxes as tasks land** and commit the plan with the code. A task is done when its tests pass, not
  when the code compiles.
- **Deviations go in the plan**, in the same commit, with a one-line reason. The spec is updated too if the
  deviation changes a documented decision.
- **Screenshot check:** every UI task ends with a screenshot of the changed screen on phone and desktop,
  checked against the styling of the rest of the app (see `CLAUDE.md`, "Visual verification").
- **Requirement tags:** every user-facing requirement ID listed under a milestone's "Requirements covered"
  must have a Playwright test tagged with it by the end of that milestone. `pnpm e2e:coverage` enforces this
  for the IDs whose milestone is complete (it reads the `Status` line at the top of each plan).
- **Definition of done** for a milestone: all checkboxes ticked, the listed spec files pass in CI across the
  project matrix, the exit-criteria checklist is verified on the deployed app, and `Status:` is set to `done`.

## Cross-cutting rules (apply to every milestone)

- Business logic goes in `packages/core` with unit tests; the web app and functions only call it.
- Clients never write function-only collections (supply, stats, cookEvents, ratings, cadence). Merging ingredients
  (M8) is the `mergeIngredient` function for the same reason: it moves Supply.
- Free tier: before adding any Firebase/GCP feature, update the §2 quota table in the spec.
- Units (R8.13 v3, changed in M7): recipe pages show one unit system per amount (`formatRecipeAmount()`: imperial
  weights to metric only, cups/spoons as written) and Fahrenheit only (`fahrenheitOnly()`); everything else metric
  only (`formatAmount()` / `formatCanonical()` from core). Older milestone plans describe the rule of their day.
- Mobile-first, then tablet, 1080p, 4K. Every page must look intentional at 360 px and 3840 px.
- The word is **Supply**, never inventory.
