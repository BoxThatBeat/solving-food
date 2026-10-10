# Solving Food — Project Setup

> Everything here is **non-secret** (the Firebase web config is shipped to browsers by design).
> Secrets (PC Express credentials) live only in Secret Manager; see "Secrets" below.
> Last verified: 2026-10-09

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
| FCM web push VAPID public key | _pending_ |
| Project owner sign-in email (first allowlist entry, `OWNER_UID` source) | `buitenwerfa@gmail.com` |
| Custom domain | none; the app lives at `https://solvingfood.web.app` |
| GitHub repo | https://github.com/BoxThatBeat/solving-food (**public**; Actions minutes are unlimited, so CI runs the Playwright suite too) |
| First household name | **Silbrass Pvt** |
| PC Express account email | `buitenwerfa@gmail.com` (password only in Secret Manager, never here) |

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

- **$1/month budget alert**: not verifiable from the CLI (Budget API disabled on the billing project). Confirm in
  Google Cloud console → Billing → Budgets & alerts.
- **VAPID key**: Firebase console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair,
  then fill in the table above.
- ~~gcloud login~~ done 2026-10-09: `gcloud auth list` shows `buitenwerfa@gmail.com` active, project `solvingfood`.
  (Interactive logins must run in a normal terminal, not through the Claude session, which has no stdin.)
