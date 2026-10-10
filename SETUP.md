# Solving Food — Project Setup

> Everything here is **non-secret** (the Firebase web config is shipped to browsers by design).
> Secrets (PC Express credentials) live only in Secret Manager; see "Secrets" below.
> Last verified: 2026-10-09 (M0)

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

## CI/CD (GitHub Actions)

- `.github/workflows/checks.yml`: on PRs and pushes to `master`: lint, typecheck, unit tests, build, requirement-tag
  coverage, rules + functions tests on the emulators, the Playwright suite (2 shards), and a Hosting preview channel
  for PRs from this repo. Every step runs in the Nix dev shell, so CI has the same toolchain and browsers as local.
- `.github/workflows/deploy.yml`: after Checks succeed on a push to `master` (or by manual dispatch), builds and runs
  `firebase deploy --only hosting,functions,firestore,storage`, then smoke-checks the site and `healthcheck`.
- **Branch protection (owner, in GitHub):** Settings → Branches → Add branch ruleset (or classic rule) for `master`:
  require a pull request, require status checks to pass: `Lint, types, unit, coverage`,
  `Rules and functions (emulator)`, `Playwright (shard 1/2)`, `Playwright (shard 2/2)`. Do this after the M0
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
