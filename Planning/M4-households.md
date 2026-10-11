# M4 — Households

Status: in progress

## Verification (2026-10-10)

| Layer | Result |
|---|---|
| Lint, typecheck | clean |
| Unit (`pnpm test`) | core 268 passed (21 files; new: export format round trip, zip, remap by fingerprint, ledger reconcile, invite inbox helpers), web 7 passed |
| Rules (`pnpm test:rules`) | 89 passed (new: invites by uid and email, accept via invite, member create needs `uid`, remove and leave, collection-group invite reads scoped to the invitee, `imports/` upload) |
| Functions on the emulators | 39 passed (new in `functions/test/households.test.ts`: last-member cleanup, concurrent leaves, counter floor, Storage prefix emptied; `importHousehold` replace, recipe match by ID and fingerprint, missing recipes recreated, members untouched, bad file fails) |
| Playwright M4 specs (`households`, `isolation`, `data-transfer`, M4 a11y, `@R2.7` review) | 17/17 passed on desktop-1080p and on phone-ios |
| Playwright desktop-1080p (full) | 128 passed, 10 failed; all 10 passed on a `--last-failed` re-run (9 were 45 s load timeouts late in the run, 1 a real race in the cancelled-invite test, fixed in `fa3a944`) |
| Playwright phone-ios (full, 2 workers) | 118 passed, 6 skipped, 16 failed (none in an M4 spec: plan, recipe-edit, review, settings, supply, sharing, theme, timers; mostly 45 s timeouts late in a 24-minute run on this 7 GB machine). Re-run of the 16 with one worker: **16 passed** (`--last-failed --workers=1`, 3.1 min: plan 3, recipe-edit 2, review 1, settings 1, sharing 1, supply 4, theme 1, timers 3). No real failures |
| Playwright phone-android, tablet, desktop-firefox, 4K | not run for M4 on this machine (memory); CI runs the matrix after the push |
| `pnpm e2e:coverage` | M4 11/11 requirement IDs tagged |
| Live | `pnpm run deploy` (hosting, functions incl. new `householdCleanup` and `commands` at 512 MiB / 300 s, confirmed with `gcloud functions describe`; Firestore rules + the two `invites` collection-group index overrides; Storage rules with `imports/`): site 200, `/settings/members` 200, healthcheck `{"ok":true}`. The rules compiler's one warning (`validTrashState(…, null)`, line 233) dates from M1 and is harmless. `householdCleanup` and `importHousehold` were not exercised live |

## What's left for the owner

1. Push `master` (still open from M0–M3). CI then runs the full Playwright matrix (phone-android, tablet,
   desktop-firefox, 4K included) that wasn't run locally for M4.
2. The exit criteria below, on real devices:
   - Invite the spouse by email from **Settings → Members → Invite by email**; they sign in on their phone at
     https://solvingfood.web.app with that address, pick a display name, accept "Join Silbrass Pvt", and see the plan.
   - Create a second household from the household sheet ("+ New household"), plan it, and check that neither
     household sees the other's supply.
   - **Settings → Data**: download one household's data and import it into a fresh household; compare plan, supply,
     and history.
   - Last-member leave in a **throwaway household only** (it deletes that household and everything in it); check the
     "n of 3 created" count drops. Never on Silbrass Pvt.
3. Sign-off on feel (Members page, invite banner, household sheet, Data page).
4. Open items from M1–M3: the M1 skill import test, M2's phone checks, the M3 real-device exit criteria (PC Express
   receive with a freeze split, tablet cooking with a locked-phone timer alert, phone review, expired-lot prompt,
   airplane-mode finish), and the Playwright projects not run locally since M2.

## Goal

Multiple people and multiple households. The owner's spouse joins "Silbrass Pvt"; a second household (a
parent's home, the cottage) can exist with the same recipe library and its own supply, plans, and history.
Households are invisible to each other. Leaving as the last member deletes the household. A household's data
can be downloaded and imported.

## Requirements covered

R2.2–R2.8, R2.11, R2.13, R11.8, R11.10, NFR4 (isolation proven end to end).

## Prerequisites

M3 done (so an export has real data to round-trip). M0 already created `users`, `directory`, `allowlist`,
`households`, `members`.

## Deliverables

1. Members page: list, invite by email (allowlist + invite), invite by name (directory), remove, leave.
2. Invites inbox and accept/decline; household switcher; 3-household limit UX.
3. Last-member warning; empty-household cleanup function.
4. Download household data (zip) and import (`importHousehold` command) with the replace warning.
5. Isolation proven by `isolation.spec.ts`.

## Work breakdown

### 1. Members and invites

- [x] `/settings/members`: member list with display names and joined dates; Remove (any member, R2.5);
      Leave (self) with `<LeaveHouseholdDialog>`; last-member variant with the R2.13 warning. Prototype
      Settings "Household" card (the "house" sheet is the switcher).
- [x] Invite by email: email field → batch `allowlist/{emailLower}` (if missing) + `invites/{emailLower}`.
      Shows "invited, waiting for sign-up" state.
- [x] Invite by name: directory search (load all; filter client-side) → `invites/{uid}`.
- [x] Invites inbox (banner on any page + list in Settings): two collection-group queries (by uid, by email);
      Accept = batch create `members/{uid}` (with `uid`, `displayName`) + delete invite; Decline = delete.
- [x] Household switcher in the shell (header on phone, side nav on desktop): memberships from the
      collection-group query; sets `activeHouseholdId`. "Create household" entry with the 3-limit message
      from rules errors.
- [x] Removal takes effect live: `useMyHouseholds()` drops the household; if it was active, switch or show
      the "no household" screen.

### 2. Empty-household cleanup

- [x] `functions/src/households.ts`: `onDocumentDeleted(households/{hid}/members/{uid})` → if no members
      remain, `recursiveDelete(households/{hid})` and decrement `users/{createdBy}.householdsCreated`
      (floor 0). Idempotent; guards against the household already being gone.
- [x] Storage: delete `imports/{hid}/**` in the same cleanup.

### 3. Data download

- [x] `packages/core/export.ts`: `household.json` schema (versioned, zod), `.cook` per recipe,
      `meals.json`. `buildExport()` from in-memory documents; `gatherExport()` does the reads behind a reader the
      web app (Firestore SDK) and the functions tests (Admin SDK) both implement.
- [x] `<DataTransfer>` Download: reads every household collection (paginated), recipes and meals referenced
      by plans, favourites, notes, history and stats; zips in the browser (`fflate`); file name
      `solving-food-<household>-<date>.zip`. Progress indicator; Firestore read estimate shown ("~1,200 reads").

### 4. Data import

- [x] Import: file picker → unzip → zod validate → summary (counts, export date, schema version) → confirm
      dialog "replaces this household's data" → upload to `imports/{hid}/{uuid}.zip` → `importHousehold`
      command with the path. (Import reads the zip in the browser for the summary; the function validates again.)
- [x] `functions/src/commands/importHousehold.ts`: download, validate, delete household data except
      `members` and `invites`, write documents in batches (supply + transactions written by the function so
      ledger rules hold), match recipes by ID then fingerprint, create missing recipes from `.cook` via the
      M1 pipeline (no dedupe prompt), delete the upload, notify. (`functions/src/importHousehold.ts`, dispatched
      outside the command transaction; `needsReview` for fingerprint matches dropped, see Deviations.)
      Writes per import logged; stay under the 20K/day quota for realistic sizes (note in spec §2 if not).

## Data & rules introduced

`invites` by email key; `imports/{hid}/**` Storage rule (member write, zip ≤ 20 MB, no client read).
No new collections.

## Tests

- Unit: export/import schema round trip; fingerprint matching.
- Rules: invite by email accept path; member create requires `uid` field; collection-group `invites` scoped;
  isolation (user in A cannot read any doc under B, including via collection-group queries).
- Functions: empty-household cleanup (last leave, concurrent leaves, counter floor); `importHousehold`
  (replace, recipe match by ID/fingerprint, missing recipes created, members untouched, bad file → failed).
- E2E: `households` (full), `isolation`, `data-transfer`, `settings` (members).

## Exit criteria

- [ ] Spouse is invited by email, signs up on their phone, lands in "Silbrass Pvt", and sees the plan.
- [ ] A second household is created, planned independently, and neither sees the other's supply.
- [ ] Export from one household, import into a fresh one, and plan/supply/history match.
- [ ] Last member leaving deletes the household and the counter drops.

## Risks and notes

- Directory search exposes every user's display name to every allowlisted user. Accepted (friends and family).
- Export reads can be large for an old household; run it rarely. There are no automatic backups by decision.

## Deviations and decisions (2026-10-10)

- **Household sheet rows** show "n members · timezone · serves n" instead of the prototype's "n MEMBERS · n PLANNED":
  the planned count would need a plan-items query per household on every open of the sheet (other households'
  current periods aren't loaded), while timezone and servings are on the household doc already listed.
- **Members get their own page** (`/settings/members`: list, invite by name, invite by email, pending invites, remove,
  leave) linked from Settings, instead of the prototype's inline invite search inside the Settings household card.
  Settings itself shows the signed-in person's **Invites** card; a banner shows new invites on any page.
- **Invite by email when the address is already allowlisted:** the client tries allowlist entry + invite in one batch
  and, if the rules refuse it (the entry exists), writes the invite alone (spec §10 as built).
- **Leaving your last household is allowed** (PRD R2.13: any member can leave; the PRD wins over the prototype). With
  no household left the app goes to `/welcome/household`, which lists invites above the create form.
- **Import keeps the importing household's name, creator, and creation date**; members, invites, commands, devices,
  and timers are never exported (spec §13).
- **Fingerprint-matched recipes are not flagged `needsReview`**: recipes have no review flag, and a fingerprint match is
  the same recipe by definition. Recipes recreated from their `.cook` have no image.
- **`importHousehold` runs outside the command transaction** (an import writes far more than 500 documents); the
  `commands` function now has 512 MiB and 300 s (spec §2 quota table updated).
- **Destructive confirm buttons use `bg-red-soft`** (ink on the prototype's red is below AA for button text). This also
  changes M1's Trash dialog.

## Design-compare notes (phone 430×932, desktop 1920×1080, Latte)

Compared (by the agent that built M4, commit `699b8e2`) with the prototype's Settings household card, the household ("house") sheet, and the shell's household chip.
Matched: the HOUSEHOLD chip with name ▾ and the mono members line, sheet rows with the → mark and hard shadow on inactive households and accent fill on
the active one (a check icon instead of the prototype's ●), mono kickers, Archivo Black titles, the bordered cards with hard shadows, the Invite buttons in
accent, small Remove buttons, and mono uppercase sub-lines (joined date, who invited you). Open invites are a
"Pending invites" card with Cancel buttons rather than the prototype's single mono PENDING line.

Intentional differences:

- Members and Data are separate Settings pages (the prototype has no Data page and keeps invites inline); they use the
  same card, kicker, and button language.
- The invite banner (not in the prototype) spans the page width above the page title, styled as the app's other
  notice cards.
- Household sheet rows show timezone and servings instead of the planned count (see Deviations).
- The last-member leave dialog and the import replace warning are not in the prototype; they use the shared dialog
  with the soft red destructive button.
