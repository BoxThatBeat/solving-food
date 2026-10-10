# M0 — Skeleton

Status: in progress

Remaining (everything below needs the owner; all code, tests, and the deploy are done):

- Push `master` and confirm Checks is green on GitHub and Deploy runs (CI has not run yet: nothing is pushed).
- Branch protection on `master` (GitHub settings; exact steps in `SETUP.md` → CI/CD).
- Owner sign-in on a phone at https://solvingfood.web.app: email link, display name, create "Silbrass Pvt", land on
  Recipes, install to the home screen, reload offline. (Verified end to end on the emulators and in the e2e suite;
  the live run needs the owner's inbox.)
- A non-allowlisted address reaching "not invited" on the deployed app (covered on the emulators by `auth.spec.ts`).
- Billing shows $0 after a week.

## Goal

A deployed, installable, empty app at https://solvingfood.web.app that an allowlisted person can sign into,
with every layer of the stack wired end to end: monorepo, shared core package, Firebase config, emulators,
theme, navigation shell, auth, the first household, CI, and the Playwright harness. Nothing food-related yet.
Every later milestone only adds features; it never has to add infrastructure.

## Requirements covered

R2.1, R2.3 (limit enforced in rules), R2.10, R2.11, R2.12, R11.9, R12 (pages exist as empty shells, landing
redirect), NFR1, NFR2, NFR4 (allowlist + household isolation rules), NFR6 (shell only).

## Prerequisites

- `SETUP.md` facts (project `solvingfood`, web config, `us-east1`).
- VAPID public key in `SETUP.md` (needed only in M3; not blocking).
- Firebase CLI and gcloud logged in as the owner (done).

## Deliverables

1. pnpm monorepo with `apps/web`, `functions`, `packages/core`, `e2e`, `data`.
2. `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, emulator config.
3. React 19 + Vite PWA with TanStack Router, Tailwind, shadcn/ui, Catppuccin theme, brutalist base styles,
   responsive navigation shell with placeholder pages.
4. Email-link sign-in with the allowlist gate, paste-link fallback, display-name setup, theme per user.
5. First-household creation flow (name, timezone, default servings, planned meal types).
6. GitHub Actions: checks on PR (lint, types, unit, rules, functions, Playwright) and deploy on `master`.
7. Playwright harness: emulator lifecycle, fixtures, seed module, project matrix, requirement-tag coverage script.
8. Owner's allowlist entry seeded in the live project.

## Work breakdown

### 0. Dev shell additions

- [x] Add `playwright-driver.browsers` to `flake.nix`; export `PLAYWRIGHT_BROWSERS_PATH` and
      `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true` in `shellHook`. Pin `@playwright/test` to the same
      version as `pkgs.playwright-driver` (check with `nix eval nixpkgs#playwright-driver.version`).
      Done: driver 1.63.0, `@playwright/test` pinned to 1.63.0. Also `FONTCONFIG_FILE` (DejaVu only) so screenshots
      don't depend on the host's fonts.
- Note: keep Node 24 locally (no `nodejs_22` in the shell). The functions `engines` field says 22 for the
      Cloud runtime and the emulator only warns about the mismatch. Record this in `functions/README.md`.

### 1. Monorepo

- [x] `pnpm-workspace.yaml`, root `package.json` with scripts: `dev`, `build`, `lint`, `typecheck`, `test`,
      `test:rules`, `test:functions`, `e2e`, `e2e:coverage`, `emulators`, `deploy`.
- [x] Root `tsconfig.base.json` (strict, `moduleResolution: bundler`, `verbatimModuleSyntax`), per-package
      `tsconfig.json` extending it. ESLint 9 flat config + Prettier. `.editorconfig`.
- [x] `packages/core`: `src/index.ts`, `src/types.ts` (Firestore document types from spec §4, written as zod
      schemas and inferred types), `src/taxonomy.ts` (cuisine and mainProtein lists from spec §4.3), vitest
      config. No Firebase imports allowed (enforce with an ESLint `no-restricted-imports` rule).
- [x] `apps/web`: Vite + React 19 + TypeScript, `vite-plugin-pwa`, Tailwind 4, shadcn/ui init, TanStack Router
      with file-based routes, depends on `@solving-food/core` via workspace.
      Deviation: no `shadcn init` (interactive); `components.json` and the primitives (Button, Input, Label, Card,
      Sheet) are written by hand in shadcn's structure with the prototype's brutalist variants. Vite 8, TS 6.0
      (typescript-eslint doesn't support TS 7 yet).
- [x] `functions`: Cloud Functions for Firebase 2nd gen, TypeScript, Node 22 target, region `us-east1`,
      one `healthcheck` HTTPS function to prove the deploy path, vitest + emulator test setup.
      Deviation: bundled with esbuild (`functions/build.mjs`) so `@solving-food/core` is inlined and the deployed
      `package.json` has no `workspace:` dependency (Cloud Build runs plain `npm install`).
- [x] `e2e`: Playwright package (see §7).
- [x] `data`: empty `ingredients/` and `price-estimates.json` placeholders with a README describing formats.

### 2. Firebase project wiring

- [x] `.firebaserc` → `solvingfood`. `firebase.json`: hosting (`apps/web/dist`, SPA rewrite, cache headers for
      hashed assets), functions (`functions`, codebase `default`), firestore rules + indexes, storage rules,
      emulators (auth 9099, firestore 8080, storage 9199, functions 5001, hosting 5000, ui 4000, pubsub 8085,
      eventarc 9299, tasks 9499).
- [x] `apps/web/src/firebase/app.ts`: initialise with the config from `SETUP.md` (committed; it's public).
      Connect to emulators when `import.meta.env.VITE_USE_EMULATORS === "true"`. `persistentLocalCache`
      with multi-tab manager.
- [x] `firestore.rules`: the §10 sketch, M0 subset: `allowed()`, `allowlist`, `users`, `directory`,
      `households` create/read/update, `members` create (creator) and read, collection-group `members` read.
      Everything else denied. `storage.rules`: deny all except what M1 adds.
      Additions: `allowed()` also requires `email_verified` (spec §10 note); the collection-group `members` rule
      reads the `uid` field so the query is provable; `members.uid` collection-group index in `firestore.indexes.json`.
- [x] Enable required APIs once (Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Cloud Tasks,
      Secret Manager, Cloud Scheduler): `gcloud services enable …`. Set the Artifact Registry cleanup policy
      (`firebase functions:artifacts:setpolicy`). Record in `SETUP.md`.
- [x] `scripts/seed-allowlist.ts` (firebase-admin via ADC from gcloud): writes `allowlist/buitenwerfa@gmail.com`.
      Run it once against the live project; document in `SETUP.md`.
      Deviation: no ADC on this machine (that login is interactive), so the live path uses
      `gcloud auth print-access-token` with the Firestore REST API; ADC is used when present.

### 3. Theme and shell

- [x] `apps/web/src/theme/`: Catppuccin flavours from `@catppuccin/palette` → CSS variables named as in the
      design prototype (`--base --mantle --pg --desk --ink --sub --acc --onc --line --bw --r --sh --tt`),
      mapped onto shadcn tokens. Accent selectable from the 4 prototype options plus the full Catppuccin set.
      Fonts: Archivo + Archivo Black + JetBrains Mono (self-hosted in `public/fonts`, no Google Fonts at runtime).
      Deviation (CLAUDE.md, 2026-10-09): colours come from the prototype's `FLAV`/`ACCENTS` tables, not
      `@catppuccin/palette`; the accent set is the prototype's 12 named accents, stored by name. Latte `--sub` is
      `#5c5f77` (Catppuccin Latte Subtext 1) instead of `#6c6f85`, which fails WCAG AA for small text on every Latte
      background (3.7–4.4:1). Tokens are Tailwind colours (`bg-base text-ink border-line`); `text-base` is the colour,
      Tailwind's `text-base` font size is removed.
- [x] Brutalist base: `--bw` borders, `--sh` hard shadow, radius `--r`, "Classic" look values from the prototype.
- [x] Root font size `clamp()` and the breakpoint table from spec §12 (`md lg xl 3xl`). Container-query
      plugin enabled. (Container queries are built into Tailwind 4; no plugin needed.)
- [x] `<AppShell>`: bottom tab bar (phone) → collapsible side rail (`md`) → persistent side nav (`lg`), with
      the 7 pages from PRD §12. Route placeholders for every route in spec §12, each rendering its page title.
      Per the prototype the phone tab bar has Plan, Recipes, Supply, Grocery, and More (a sheet with Meals,
      History, Settings). The md rail is the prototype's tablet nav with a collapse-to-icons toggle.
      Design compare done on phone and desktop (sign-in, household setup, Recipes, Settings); remaining
      differences are intentional: content scales with the spec's fluid root size, and pages show empty states.
- [x] Landing redirect `/` → `/plan` if the current period has items (always false in M0) else `/recipes`.
- [x] `<NotificationBanners>` shell (local client-only messages; the Firestore feed is M1).
- [x] PWA manifest (name, icons from the prototype's mark, theme colour per flavour), service worker via
      Workbox: precache app shell, runtime cache fonts. "Install" prompt hook stored for M3's timer prompt.
      Fonts are also in the precache (three latin files) so the first offline load has them. Icons are rendered
      from the wordmark by `pnpm --filter @solving-food/e2e icons`.
- [x] Theme persisted to `users/{uid}.theme` with a localStorage mirror to avoid flash.

### 4. Auth

- [x] `/sign-in`: email field → `sendSignInLinkToEmail` with `url = location.origin + "/sign-in/finish"`,
      `handleCodeInApp: true`. Store the email in localStorage for the finish step.
- [x] `/sign-in/finish`: `isSignInWithEmailLink` → `signInWithEmailLink`. If the stored email is missing, ask
      for it. **Paste sign-in link** field on `/sign-in` for the iOS PWA case.
- [x] Allowlist gate: after Firebase sign-in, `getDoc(allowlist/{email})`. Missing → `/not-invited` page
      (explains, signs out). Present → continue.
- [x] First-run: `/welcome` asks for display name → batch create `users/{uid}` + `directory/{uid}`.
- [x] Session: `useUser()` hook (auth state + user doc), route guards (`beforeLoad`) for signed-in, allowlisted,
      and has-household states.
      Implemented as `session/session.ts` (a store: auth → allowlist → user/directory/memberships) with
      `useSession()`; guards in `session/guards.ts`. Memberships count only once the server has acknowledged them
      (otherwise the shell's listeners race the creation batch), and the last known memberships are mirrored in
      localStorage for offline cold starts.
- [x] Sign out in Settings.

### 5. First household

- [x] `useMyHouseholds()`: collection-group query `members` where `uid == me`. `activeHouseholdId` on the
      user doc; falls back to the first membership.
- [x] `/welcome/household`: shown when the user has no membership. Form: name (default "Home"), timezone
      (default `America/Toronto`, detected from the browser), default servings (default 4), planned meal types
      (all three on), currency fixed to CAD, budget and period length defaults (7 days, $200; editable later in
      M2). Batch: `households/{hid}` (with `createdBy`, `pcxStoreId` default from core config), `members/{uid}`,
      `users/{uid}.householdsCreated += 1`, `activeHouseholdId`.
- [x] Rules test: counter must go up by exactly 1 and stay ≤ 3; member doc only for the creator in the same batch.

### 6. CI/CD

- [x] `.github/workflows/checks.yml` on PR and push to `master`: pnpm cache, `lint`, `typecheck`, `test`
      (core unit), `test:rules` (emulator), `test:functions` (emulator), `e2e:coverage`, then Playwright
      (see §7) with the emulator suite started via `firebase emulators:exec`. Java comes from
      `actions/setup-java`. Playwright browsers via `npx playwright install --with-deps` on the runner.
      Deviation: every job runs in the Nix dev shell (`cachix/install-nix-action`) instead of setup-java + npx
      playwright install, so CI uses exactly the local Node/pnpm/firebase-tools/JRE/browsers and the visual
      baselines match. The full project matrix runs on every PR (2 shards) while the suite is small. Validated with
      actionlint; not yet run on GitHub.
- [x] `.github/workflows/deploy.yml` on push to `master` after checks: `firebase deploy --only
      hosting,functions,firestore,storage`. Auth with a service account JSON in the repo secret
      `FIREBASE_SERVICE_ACCOUNT_SOLVINGFOOD` created by `firebase init hosting:github` (owner runs it once; it
      also creates the preview-channel workflow for PRs).
      Runs on `workflow_run` of Checks (success, push to master). The PR preview channel moved into checks.yml.
      The service account needed extra roles for functions + rules deploys; granted and listed in `SETUP.md`.
- [ ] Branch protection on `master`: checks required. (Owner sets this in GitHub; note in `SETUP.md`.)
      Blocked on the owner: steps written in `SETUP.md` → CI/CD. Set it after pushing, so the check names exist.

### 7. Playwright harness

- [x] `e2e/playwright.config.ts`: the project matrix from spec §14.1 (`phone-ios`, `phone-android`, `tablet`,
      `desktop-1080p`, `desktop-firefox`, `desktop-4k`), `webServer` = `vite preview` with
      `VITE_USE_EMULATORS=true`, `globalSetup` that waits for emulators, retries 1 in CI, trace/video on retry.
      `desktop-4k` is split into `desktop-4k` (3840×2160 @1×) and `desktop-4k-2x` (1920×1080 @2×). The e2e build also
      forces Firestore long polling: Playwright's Linux WebKit stalls the Listen stream to the emulator.
- [x] Fixtures: `signedInAs(email)` (creates the Auth emulator user, fetches the oob code from
      `GET /emulator/v1/projects/solvingfood/oobCodes`, completes sign-in, caches storage state per email),
      `household` (creates one via the UI once, reuses), `secondMember`, `seed` (loads `e2e/seed/*.json` via
      the Admin SDK against the emulator; resets between files with the emulator `DELETE` endpoint).
      Deviation: tests run in parallel against one emulator, so each test uses its own addresses and households
      instead of wiping data between files (`resetFirestore()` exists for suites run alone). No per-email
      storage-state cache: every test signs in a fresh address through the real link flow (about 2 s), so there is
      nothing to reuse. `signedInAs` seeds profile + household with the Admin SDK; the UI paths for those are
      covered by `auth.spec.ts` and `households.spec.ts`. Emulator builds expose `window.__sfTest` for
      direct-rules checks from the page.
- [x] `e2e/scripts/coverage.ts`: extracts `R\d+\.\d+` and `NFR[56]` from `PRODUCT_REQUIREMENTS.md`, reads each
      `Planning/M*.md` with `Status: done`, collects tags from `e2e/specs/**`, fails on any uncovered ID whose
      milestone is done. Prints a table of coverage for in-progress milestones.
- [x] First specs: `auth.spec.ts` (allowlisted sign-in, not-invited, paste link, display name), `pwa.spec.ts`
      (manifest, SW registers, shell loads offline), `responsive.spec.ts` (nav variant per breakpoint, no
      horizontal scroll), `a11y.spec.ts` (axe on the shell pages), `visual.spec.ts` baselines for the empty
      shell in Latte and Mocha. `households.spec.ts` M0 part: create first household, 3-limit via rules test.
      Also `theme.spec.ts` (R11.9, R2.10). Visual baselines are Chromium-only (phone-android, desktop-1080p,
      desktop-4k, desktop-4k-2x).

## Data & rules introduced

`allowlist`, `users`, `directory`, `households` (+ `members`). Rules per spec §10 for these only.

## Tests

- Unit: `taxonomy` lists non-empty and unique; zod schemas accept the spec examples.
- Rules: allowlist gate (non-allowlisted user can't read/write anything), user doc private, directory readable
  by allowlisted users only, household create limits, member create only by creator.
- Functions: `healthcheck` responds in the emulator (proves the harness).
- E2E: `auth`, `pwa`, `responsive`, `a11y`, `visual`, `households` (M0 part).

## Exit criteria

- [x] `pnpm dev` with emulators gives a working local app; `pnpm e2e` passes locally.
- [ ] CI green on a PR; merge deploys; https://solvingfood.web.app serves the shell.
      The shell is deployed (manual `pnpm run deploy`) and serves; CI and the merge-deploy wait for the push.
- [ ] Owner signs in with `buitenwerfa@gmail.com` on a phone, sets display name, creates "Silbrass Pvt",
      lands on an empty Recipes page, installs the PWA to the home screen, and the shell loads offline.
- [ ] A non-allowlisted address reaches "not invited".
- [ ] Billing dashboard shows $0 after a week of this (Hosting + a handful of function invocations).

## Risks and notes

- `firebase init hosting:github` needs an interactive terminal: the owner runs it.
- Playwright WebKit on NixOS needs the nixpkgs driver; CI uses Playwright's own install. Keep versions pinned
  equal or screenshots will drift.
- Email-link mails from Firebase's default sender may land in spam the first time; the owner should mark it
  "not spam" once. A custom sender domain is a later nicety, not M0.
