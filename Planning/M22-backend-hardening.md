# M22 — Backend hardening

Status: done

## Goal

A pass over the functions, rules and deploy path (review of 2026-11-05): close permission gaps on the callables, make
the command pipeline recover from stuck or oversized commands, make household import safe to fail, guard every outbound
fetch against SSRF, stop Storage and Firestore from growing without bound, alert the owner when maintenance keeps
failing, and write down the backups, alerts and keyless deploy the owner has to switch on.

## Requirements covered

No new requirement IDs. Behaviour changes under existing ones: R4.35 (merging from Claude's answer is the owner's only;
anyone else sees why, `ingredients.spec.ts` @R4.35), R8.16 (wording), R4.15 (a new recipe's photo uploads after the save,
new test in `recipe-edit.spec.ts`), NFR2 (the weekly Firestore backup is the one accepted paid item). PRD v0.8. Spec §2,
§6, §10, §12, §13, §15 updated; SETUP.md "M22 backend hardening", "Backups and alerts", "Deploy without a long-lived key".

## Items

### Callable permissions

- [x] **1. Allowlisted callers everywhere.** `index.ts` `allowedCall()` runs `requireAllowed` (verified **and**
      allowlisted) for `scheduleTimer`, `cancelTimer`, `pcxSearchStores`, `pcxSearchProducts`, `pcxStatus`, `pcxSetKey`,
      `aiStatus`, `aiSetKey`, `checkIngredientNames` and `mergeIngredient`; `memberUid` / `timerUid` removed.
      `scheduleTimer` is limited to 60 calls per person per hour (`timerRateLimit`, `timerRate/{uid}`, the PC Express
      helper). `timers.test.ts`; spec §10 "Callables", §12 timers.
- [x] **2. `mergeIngredient` is the owner's.** `ownerMergeIngredient` checks `isOwner(uid, hid, OWNER_UID)` and throws
      "Only the app's owner can merge ingredients"; the web app passes `hid`, the Ingredients page says so under
      Claude's answer for non-owners, and Apply reports each refused merge. `checkIngredientNames` keeps its own check.
      `ingredients.test.ts`, `ingredients.spec.ts` (@R4.35); PRD R4.35 / R8.16, spec §6 "Merging ingredients".
- [x] **3. Stub owner only under the real emulator.** `owner.ts` honours `_stubPcx/{hid}.ownerUid` only when
      `FUNCTIONS_EMULATOR === "true"`, never for `PCX_STUB`. `pcx.test.ts`.

### Commands pipeline

- [x] **4. Stuck commands recover.** `failStuckCommands` fails `pending` / `running` commands created more than 2 h ago
      (re-checked in a transaction) with "it didn't finish on the server; check Supply, then try again" and the usual
      error banner (the client's pending projection then drops them; the banner is the existing notification path).
      Fast path: after each command the dispatcher looks at ≤ 20 of the household's open commands; slow path: the weekly
      maintenance, every household. `commands.test.ts`, `maintenance.test.ts`; spec §6.
- [x] **5. Long grocery lists.** `receiveChunks` (core) splits a receive into ≤ 100-line chunks (≤ 402 writes each),
      one ingredient's lines together; the dispatcher runs one transaction per chunk with `receivedParts` progress on the
      command; the last marks the list received and the command applied; cadence once per ingredient. Schema max stays
      400 (the list's own limit). `commands.test.ts` (core), functions `commands.test.ts` (400 lines × freeze, 40
      ingredients); spec §6.
- [x] **6. Path-safe IDs.** `COMMAND_ID_PATTERN` (no `/`, not `.` / `..` / `__…__`, ≤ 200) on every payload ID;
      `firestore.rules` `validCommandIds` on the top-level ones. Core `commands.test.ts`, rules `supply.test.ts`.

### Import / export

- [x] **7. Write-then-delete import.** `writeExport` writes over the household (a write still failing after retries
      stops before anything is deleted), then `pruneHousehold` deletes what the import didn't write, at any depth. The
      upload is deleted only on success; a failure keeps it and names its path in the banner. `households.test.ts`;
      spec §13.

### SSRF / fetch guards

- [x] **8. `safeFetch`.** `functions/src/safeFetch.ts`: http(s) only, internal names refused, DNS resolved by the helper
      (all addresses; private, loopback, link-local/metadata, CGNAT, multicast, reserved, IPv6 ULA/link-local, IPv4-mapped,
      NAT64, 6to4 refused), the connection pinned to the checked addresses (custom `lookup`), redirects by hand (≤ 5, each
      re-checked), size and time caps, gzip/br. Used by the Add with Gemini page fetch and `downloadImage`.
      `safeFetch.test.ts` (ranges, URLs, a local server for redirects, size, timeout), `dropFolder.test.ts`; spec §10.

### Storage and Firestore hygiene

- [x] **9. Storage orphans.** `storage.rules`: `recipes/{id}/**` writes need `firestore.exists(recipes/{id})`. The editor
      keeps a new recipe's photos in memory (shown from the file) and uploads them under their planned base right after
      `createRecipe`. Maintenance sweeps `recipe-photos/`, `imports/` and `recipes/{id}/` folders without a recipe after
      3 days. `storage.test.ts`, `maintenance.test.ts`, `recipe-edit.spec.ts`.
- [x] **10. Retention.** Maintenance deletes applied / failed commands older than 30 days and notifications dismissed
      more than 30 days ago; cook events, ratings, stats, transactions, periods and received lists are never pruned.
      `maintenance.test.ts`; spec §13 "Retention", §2 row.
- [x] **11. Rules gaps.** Plan item `addedBy` == me (or the carried original's adder) and immutable; grocery list
      `createdAt` is the server time or unchanged; version snapshots are a subset of the recipe as written plus
      `editedBy` / `editedAt`. `plan.test.ts`, `recipes.test.ts`; spec §10.

### Alerting and backups

- [x] **12. Maintenance alert.** `runScheduledMaintenance` keeps `system/maintenance` (last run, status, error,
      consecutive failures); the second failure in a row logs `maintenance failed twice` and banners the owner.
      `maintenance.test.ts`; spec §13 "Monitoring".
- [x] **13. Backups and alerts for the owner.** SETUP.md "Backups and alerts": the weekly backup schedule (14 days),
      an email channel, two log-based metrics and policies; the plaintext key docs explained. Spec §2 rows; PRD NFR2.
- [x] **14. deploy.yml.** `bash -euo pipefail`; rules → functions → hosting as three steps; `--force` dropped (kept
      `--non-interactive`). Workload Identity Federation steps for the owner in SETUP.md. YAML parsed.

### Housekeeping

- [x] PRD v0.8; spec §15 row; Planning/README row.

## Deviations

- **`--day-of-week=MON`, not `MONDAY`:** `gcloud firestore backups schedules create --help` accepts SUN…SAT only.
- **Stuck after 2 hours, swept on every command and weekly.** No index needed: the fast path is an equality query on
  `status` with a limit, the age is checked in code.
- **Long lists are chunked in the function, not the client.** One command keeps the client, the projection and the
  idempotency unchanged; the 400-line schema limit stays because the list itself holds ≤ 400 lines. A failure in a later
  chunk leaves earlier chunks applied (the banner tells the person to check Supply); with one transaction per 100 lines
  that is no worse than the old single transaction failing outright.
- **Stuck message says "check Supply"** rather than "nothing changed", because a long receive or an import can be
  partly applied.
- **Other commands are still deleted by an import** (as before): commands aren't exported.
- **New-recipe photo that fails to upload** after the save is removed from the recipe with a second save (version 2),
  so the recipe never points at a missing image.
- **`safeFetch` uses `node:http(s)`, not global `fetch`**, so the connection can be pinned to the checked addresses
  (undici's dispatcher isn't importable without a new dependency). PC Express and Gemini keep `fetch` (fixed hosts).
- **Owner-only merge for Claude's answer** keeps the button for everyone: a non-owner's Apply still marks the "new"
  names and reports the refused merges, with a line explaining that only the owner can merge.
- **Alert policies by file** (`gcloud alpha monitoring policies create`) with the console as the alternative; the
  functions-error alert fires at 5 errors an hour, since single refused commands log errors.
- **Key docs are `aiSession/config` and `pcxSession/config`** (the brief's `_pcx` / `_ai`); they stay in Firestore.
- **No design-compare:** the only UI change is one sentence in an existing card and a preview image in an existing slot.
- **Verification:** unit 693 → 698 (core) + 37 web; rules 99 → 103; functions 74 → 89. e2e on phone-android and
  desktop-1080p: ingredients, recipe-edit, data-transfer, receive, timers, notifications, plan, rollover, grocery,
  gemini, drop-folder, prices, settings. In one 15-minute run the last 21 desktop tests failed in the sign-in fixture
  (the emulator degraded late in the run); the same specs passed 41/41 when rerun on desktop.
