# M4 — Households

Status: not started

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
