# Solving Food — Project Setup

> Everything here is **non-secret** (the Firebase web config is shipped to browsers by design).
> Secrets (PC Express credentials) live only in Secret Manager; see "Secrets" below.
> Last verified: 2026-10-10 (M5)

## Decision: one project, no dev

The app is used by family only, so there is a **single Firebase project** used as prod.
Local development and all tests run on the **Emulator Suite**, never against the live project.
The technical spec's `solving-food-dev` project does not exist.

## Firebase project

| Item | Value |
|---|---|
| Project ID | `solvingfood` |
| Project number | `28493041173` |
| Display name | SolvingFood |
| Plan | Blaze (billing enabled, account `014DAF-5C0D90-390F0E`) |
| Hosting site | `solvingfood` → https://solvingfood.web.app |
| Firestore | `(default)`, Native mode, edition Standard, location **`us-east1`**, delete protection on (recreated 2026-10-09; the original was `nam5`) |
| Cloud Storage | default bucket `solvingfood.firebasestorage.app`, region **`us-east1`** |
| Auth | Email/Password provider enabled, email-link (passwordless) enabled |
| Authorized domains | `localhost`, `solvingfood.firebaseapp.com`, `solvingfood.web.app` |

## Web app (Firebase SDK config)

Created with `firebase apps:create web "Solving Food"`. Re-fetch any time with
`firebase apps:sdkconfig web --project solvingfood`.

```json
{
  "projectId": "solvingfood",
  "appId": "1:28493041173:web:e0cc9aa85b861f4eb2481c",
  "storageBucket": "solvingfood.firebasestorage.app",
  "apiKey": "AIzaSyC90WnDVuO6zvN1wfW9WC1tPWZAr1OXDpI",
  "authDomain": "solvingfood.firebaseapp.com",
  "messagingSenderId": "28493041173",
  "measurementId": "G-KNNS6VLVNB"
}
```

| Item | Value |
|---|---|
| FCM web push VAPID public key | `BDJ6cML5GULVZZ0X3Zd2B2m02s_aGTbRRkbKPrV38lLZr6YE9SrkbwL4_aOGAQp72B5eDVeoQ-iui05v0vn1Rgk` (public; the private half stays in the Firebase console) |
| Project owner sign-in email (first allowlist entry, `OWNER_UID` source) | `buitenwerfa@gmail.com` |
| Custom domain | none; the app lives at `https://solvingfood.web.app` |
| GitHub repo | https://github.com/BoxThatBeat/solving-food (**public**; Actions minutes are unlimited, so CI runs the Playwright suite too) |
| First household name | **Silbrass Pvt** |
| Owner's Firebase uid | `HBebN9sYntQG1Kbdx5Ggw611xyy1` (from `users/*` where `email == buitenwerfa@gmail.com`; used for the drop folder path) |
| PC Express account email | `buitenwerfa@gmail.com` (password only in Secret Manager, never here) |

## Cloud setup done in M0 (2026-10-09)

- **APIs enabled** (`gcloud services enable`): Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Cloud Tasks,
  Secret Manager, Cloud Scheduler, Cloud Run, Pub/Sub, Firebase Rules, Firebase Storage. The first `firebase deploy`
  also enabled `firebaseextensions.googleapis.com` (free, used only for the CLI's extensions check).
- **Artifact Registry cleanup policy**: `firebase functions:artifacts:setpolicy --location us-east1 --days 1`
  on `gcf-artifacts` (keeps function images under the free 0.5 GB).
- **Owner allowlist entry**: `allowlist/buitenwerfa@gmail.com` created with `pnpm seed:allowlist` (uses
  `gcloud auth print-access-token` against the Firestore REST API when there are no ADC credentials). Re-running is a
  no-op. Add more people with `pnpm seed:allowlist -- --email someone@example.com` (or, from M4, invite in the app).
- **Deploy service account** `github-action-1409507284@solvingfood.iam.gserviceaccount.com` (the key in the
  `FIREBASE_SERVICE_ACCOUNT_SOLVINGFOOD` repo secret). `firebase init hosting:github` gave it Hosting admin,
  Cloud Functions developer, Auth admin, Run viewer, API keys viewer, and Service Usage consumer. M0 added what
  `firebase deploy --only hosting,functions,firestore,storage` needs: `roles/cloudfunctions.admin` (public invoker),
  `roles/run.admin`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`, `roles/artifactregistry.reader`,
  `roles/firebaseextensions.viewer`, and `roles/iam.serviceAccountUser` on the default compute service account
  `28493041173-compute@developer.gserviceaccount.com` (the 2nd gen functions runtime identity).
- **Deployed**: Hosting (`apps/web/dist`), Firestore rules + indexes, Storage rules (deny all), and the `healthcheck`
  function at https://us-east1-solvingfood.cloudfunctions.net/healthcheck.

## M1 operations (2026-10-10)

- **Deployed:** Hosting, Firestore rules and indexes, Storage rules, and the functions `dropFolder` (Storage
  `object.finalized`, 512 MiB, 120 s, `sharp`), `recipeIndex`, `recipeCleanup`, `ingredientRecipes` (Firestore
  triggers), `maintenance` (Cloud Scheduler, Mondays 04:00 America/Toronto; the one scheduler job of the three free
  ones), and `healthcheck`. All in `us-east1`, `maxInstances: 2`.
- **First event-trigger deploy:** the Firebase CLI enabled Pub/Sub and Storage APIs and generated the Pub/Sub and
  Eventarc service identities. The first `firebase deploy` then failed for the four event-triggered functions
  ("Permission denied while using the Eventarc Service Agent"; for `dropFolder`, `storage.buckets.get` on the
  bucket) because the agents' roles hadn't propagated; `firebase deploy --only functions` a few minutes later
  succeeded. No IAM was granted by hand. If the GitHub deploy service account ever fails to create Eventarc
  triggers, grant it `roles/eventarc.admin` (not needed so far: the M0 deploy roles covered it from the CLI).
- **Ingredient seed:** `pnpm ingredients:upload` (owner's gcloud login, Firestore REST; no ADC on this machine) wrote
  the 475 ingredients; re-running reports "475 unchanged". Ingredients edited in the app (they carry `updatedBy`) are
  never overwritten without `--force`.
- **Household recipes:** `pnpm drop:recipes -- --email buitenwerfa@gmail.com` looked up the owner's uid and copied
  each photo and `.cook` from `data/recipes/` to `gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/` with
  `gcloud storage cp`, two recipes at a time, waiting for each import (and re-sending any the trigger misses).
  Result: 28 active recipes created by the owner, 19 with photos (the other 9 have none in the vault), 28 success
  notifications for the owner (they show on first open: three at a time, then "+25 more · Dismiss all").
- **Drop folder from a terminal (the Claude skill's path):**
  `gcloud storage cp photo.jpg recipe.cook gs://solvingfood.firebasestorage.app/recipe-drop/HBebN9sYntQG1Kbdx5Ggw611xyy1/`
  (photo first; the Drop page shows the same command with the signed-in user's uid). The skill lives in
  `.claude/skills/cooklang-recipe/`; regenerate its lists with `pnpm gen:skill` after changing the taxonomy or the
  ingredient seed.
- **Local demo data:** `pnpm dev`, then `pnpm dev:seed` (emulator only) creates `dev@example.com` with "Silbrass Pvt",
  uploads the ingredients, and drops the 28 recipes (~40 s).

## M2 operations (2026-10-10)

- **No new functions or scheduler jobs.** Planning, rollover, and the grocery list run in the client. The weekly
  `maintenance` job gained one step: it rewrites recipe-index summaries that lack the M2 fields (`tools`, `lines`,
  used by the "Have the tools" and cost-per-serving filters). Until it first runs (Monday 04:00 Toronto, or run it now
  with `gcloud scheduler jobs run firebase-schedule-maintenance-us-east1 --location us-east1`), existing recipes pass
  the tools filter and have no cost per serving.
- **Existing households:** the first time a member opens the app after the M2 deploy, the client bootstrap creates the
  household's first plan period (starting that day) and the default stores (`pc-express`, `costco`) and sets
  `defaultStoreId`. Nothing is written to the owner's household by a script.
- **Price estimates** live in `data/price-estimates.json` and ship inside the web app; there is nothing to upload.
  After adding seed ingredients run `pnpm prices:check` (and `-- --write` to refresh `centsPerUnit`).
- **Firestore emulator heap:** a single local run of phone-ios + desktop-1080p together (~190 tests on one emulator)
  ran the Firestore emulator out of Java heap once specs created a fresh recipe per test. The specs now reuse their
  recipes per worker; locally, run big project sets one at a time (CI runs one browser project per job, each with its own Emulator Suite). Raising the heap with
  `JAVA_TOOL_OPTIONS` is not an option: the Storage rules runtime treats the JVM's "Picked up …" line as an error.

## M3 operations (2026-10-10)

- **New functions:** `commands` (Firestore `onDocumentCreated` on `households/{hid}/commands/{id}`, `retry: false`):
  applies every supply change, cook event, review, and rating; `scheduleTimer` and `cancelTimer` (callables); `timers`
  (`onTaskDispatched`). All in `us-east1`, `maxInstances: 2`, 256 MiB.
- **Cloud Tasks queue `timers`** (us-east1) is created by the first deploy of the `timers` function (the Cloud Tasks API
  was enabled in M0). Check it with `gcloud tasks queues describe timers --location us-east1`. Retries: 3 attempts,
  10 s minimum backoff; at most 6 concurrent dispatches. The callables enqueue with
  `getFunctions().taskQueue("locations/us-east1/functions/timers")` as the default compute service account
  `28493041173-compute@developer.gserviceaccount.com`, which has `roles/editor` (covers `cloudtasks.tasks.create`).
  Verified after the M3 deploy: `gcloud tasks queues describe timers --location us-east1` → RUNNING.
- **Web push:** FCM with the VAPID key above. The private half lives in the Firebase console (Project settings → Cloud
  Messaging → Web Push certificates); nothing to do unless it is rotated, in which case update `VAPID_KEY` in
  `apps/web/src/pwa/push.ts` and this file. Devices register on their first timer (`users/{uid}/devices/{token}`).
  iPhone: the app must be installed to the home screen (iOS 16.4+) for lock-screen timer alerts.
- **Emulators:** Cloud Tasks and FCM are stubbed under the Functions emulator: scheduled timers appear in
  `_stubTasks/{taskName}` (state `scheduled` or `deleted`), pushes in `_stubPushes`. Nothing is ever pushed locally.
- **Demo supply:** `pnpm dev:seed -- --supply` adds fresh, use-soon, expired, frozen, multi-purchase lots, a leftover
  batch, and an olive-oil cadence to the dev household (emulator only).
- **Free-use list:** `data/free-use.json` (the seed's free-use ingredient IDs, used by the Recipes page's "can make") is
  regenerated with `pnpm free-use:write` after changing the ingredient seed; a unit test fails while it is stale.
- **Existing data:** nothing to migrate. Households start with empty supply (R8.2); the first command creates docs.

## M4 operations (2026-10-10)

- **New function:** `householdCleanup` (Firestore `onDocumentDeleted` on `households/{hid}/members/{uid}`, 300 s):
  when the last member leaves, deletes the household and every subcollection, empties `imports/{hid}/` in Storage, and
  decrements the creator's `householdsCreated` (floor 0). It never touches a household that still has a member. Do not
  test it on the live project: it deletes data by design.
- **`commands` function** now runs with 512 MiB and a 300 s timeout (the `importHousehold` command unzips an export and
  rewrites the household outside a single transaction). Import logs: `importHousehold` with `writes` / `deletes`.
- **Indexes:** collection-group single-field overrides on `invites.inviteeUid` and `invites.inviteeEmailLower` (for the
  "my invites" queries), deployed with `firestore.indexes.json`.
- **Storage:** `imports/{hid}/{uuid}.zip` (members upload, ≤ 20 MB, nobody reads it but the function, which deletes it
  after the import).
- **Inviting the spouse:** Settings → Members → Invite by email. That adds the address to the allowlist (no more
  `pnpm seed:allowlist` needed) and creates the invite; they sign in at https://solvingfood.web.app with that address,
  pick a display name, and see "Join Silbrass Pvt".
- **Backups:** Settings → Data → Download household data (one Firestore read per document; the page shows an estimate).
  There are still no automatic backups.

## M5 operations (2026-10-10)

- **New functions:** callables `pcxSearchStores`, `pcxSearchProducts`, `pcxStatus` (members only, 30 searches per
  member per hour in `pcxRate/{uid}`). The weekly `maintenance` job gained the PC Express price refresh (still the one
  Cloud Scheduler job). New command type `snoozeCadence` ("Not yet" on an "Are you out of …?" prompt).
- **Firestore:** `prices/{pcxStoreId}_{productCode}` (read by allowlisted users, written by functions), `pcxSession/state`
  and `pcxRate/{uid}` (function-only: token cache, health, rate limits). Periods may carry `dismissedLots`; households may
  carry `pcxStoreName`. No new indexes.
- **PC Express is off until the owner switches it on** (the secrets did not exist when M5 was deployed; checked with
  `firebase functions:secrets:get PCX_EMAIL`, which answered 404). Until then the store and product searches say
  "PC Express not connected", the weekly refresh is skipped, and every price is the bundled estimate. To connect:
  1. `firebase functions:secrets:set PCX_EMAIL --project solvingfood` and `… PCX_PASSWORD` (the PC Express account
     `buitenwerfa@gmail.com`).
  2. In `functions/.env` set `PCX_ENABLED=true` and `PCX_API_KEY=<the x-apikey header the PC Express website sends>`
     (public, not a secret: open https://www.loblaws.ca, search for anything, and copy the `x-apikey` request header of a
     `pcx-bff` call from the browser dev tools). Optionally `PCX_SIGNIN_URL` for a token endpoint; without it requests
     go with the API key only. Commit and deploy (`firebase deploy --only functions`). The deploy binds the two secrets
     to `maintenance` and the three callables and grants their service account access.
  3. Settings → Stores → PC Express store: search "Greenbank" and pick Loblaws Greenbank Road (the default is resolved by
     name at runtime and cached in `pcxSession/state.defaultStoreId`), then link products in Settings → Brands.
  The endpoints in `functions/src/pcx/endpoints.ts` follow the website as publicly documented and were never called from
  this project (tests use the stub); if the first searches fail, that file is the one to fix.
- **Price refresh alert (owner, Cloud console):** Logging → Log-based metrics → create a counter on
  `resource.type="cloud_run_revision" AND jsonPayload.message="pcx refresh failed twice"` (or `textPayload:"pcx refresh
  failed twice"`), then Monitoring → Alerting → a policy on that metric > 0 that emails the owner. Each failed refresh
  also posts an error banner to the owner (`OWNER_UID` param, default the owner's uid above).
- **Emulators:** the PC Express functions always use the stub under the emulator. Switch its failure modes with a doc
  `_stubPcx/config` (or `_stubPcx/{hid}` for one household): `{ mode: "ok" | "notConfigured" | "signInFails" | "down" |
  "priceFails" }`; `{ prices: { "<code>": dollars } }` overrides a price.
- **Scoring data:** the scoring and optimiser workers bundle the ingredient seed (`data/ingredients/*.json`) for
  categories, conversions, and pack sizes; ingredients created in the app are known to them once a planned recipe or
  supply loads them.

## CI/CD (GitHub Actions)

- `.github/workflows/checks.yml`: on PRs and pushes to `master`: lint, typecheck, unit tests, build, requirement-tag
  coverage, rules + functions tests on the emulators, the Playwright suite (one job per browser project, each with its own Emulator Suite), and a Hosting preview channel
  for PRs from this repo. Every step runs in the Nix dev shell, so CI has the same toolchain and browsers as local.
- `.github/workflows/deploy.yml`: after Checks succeed on a push to `master` (or by manual dispatch), builds and runs
  `firebase deploy --only hosting,functions,firestore,storage`, then smoke-checks the site and `healthcheck`.
- **Deploy service account roles (owner, once):** `firebase init hosting:github` created
  `github-action-1409507284@solvingfood.iam.gserviceaccount.com` with Hosting rights only; M0 added Cloud Functions
  Admin, Cloud Run Admin, Firebase Rules Admin and Datastore Index Admin. The first CI deploy (2026-10-11) still
  failed with "Missing permissions required for functions deploy … iam.serviceAccounts.ActAs". The account also needs
  `roles/iam.serviceAccountUser` (run functions as the App Engine / compute accounts), `roles/eventarc.admin` (Storage
  and Firestore triggers), `roles/cloudscheduler.admin` (weekly maintenance), `roles/cloudtasks.queueAdmin` (the
  `timers` queue) and, once PC Express is enabled, `roles/secretmanager.admin` (binding `PCX_EMAIL` / `PCX_PASSWORD`):
  ```
  SA=serviceAccount:github-action-1409507284@solvingfood.iam.gserviceaccount.com
  for r in roles/iam.serviceAccountUser roles/eventarc.admin roles/cloudscheduler.admin roles/cloudtasks.queueAdmin roles/secretmanager.admin; do
    gcloud projects add-iam-policy-binding solvingfood --member=$SA --role=$r --condition=None
  done
  ```
  Then re-run Deploy (`gh workflow run deploy.yml --ref master`).
- **Branch protection (owner, in GitHub):** Settings → Branches → Add branch ruleset (or classic rule) for `master`:
  require a pull request, require status checks to pass: `Lint, types, unit, coverage`,
  `Rules and functions (emulator)`, `Playwright (phone-ios)`, `Playwright (phone-android)`, `Playwright (desktop-1080p)`,
  `Playwright (layouts)`. Do this after the M0
  commits are pushed and Checks has run once, so the check names are offered in the picker.

## Local toolchain

This repo has a Nix dev shell (`flake.nix`) with Node 24, pnpm, `firebase-tools`,
`google-cloud-sdk`, and a JRE for the emulators. direnv loads it on `cd` (`.envrc`).
Nothing is installed into the user profile or the NixOS config.

```sh
cd ~/git/solving-food        # direnv activates the shell
firebase projects:list       # CLI is logged in as the project owner
gcloud config list           # CLOUDSDK_CORE_PROJECT=solvingfood is set by the shell
```

Logins live outside the repo and persist: Firebase CLI in `~/.config/configstore/firebase-tools.json`,
gcloud in `~/.config/gcloud/`, GitHub CLI via `gh auth status`.

## Secrets

Set directly in Secret Manager by the owner, never pasted into chat, files, or the repo:

```sh
firebase functions:secrets:set PCX_EMAIL    --project solvingfood
firebase functions:secrets:set PCX_PASSWORD --project solvingfood
```

The functions code references them with `defineSecret("PCX_EMAIL")` etc. (TECHNICAL_SPECS §8).

## Public repo note

The repo is public, so the web config above is visible to anyone. That is normal for Firebase (the browser
has it anyway); the real gate is Firestore/Storage rules plus the allowlist. Two cheap hardenings to do
before launch: restrict the API key to HTTP referrers `solvingfood.web.app`, `solvingfood.firebaseapp.com`,
`localhost` in Google Cloud console → APIs & Services → Credentials, and enable App Check (reCAPTCHA v3,
free) for Firestore and Storage.

## Open items

- ~~$1/month budget alert~~ confirmed by the owner 2026-10-09 (not verifiable from the CLI; Budget API disabled on the billing project).
- ~~VAPID key~~ recorded above, 2026-10-09.
- ~~**GitHub deploy**~~: the generated workflows were replaced by `checks.yml` and `deploy.yml` in M0 (see CI/CD above).
- **Branch protection** on `master`: owner to set up (see CI/CD above).
- ~~gcloud login~~ done 2026-10-09: `gcloud auth list` shows `buitenwerfa@gmail.com` active, project `solvingfood`.
  (Interactive logins must run in a normal terminal, not through the Claude session, which has no stdin.)
