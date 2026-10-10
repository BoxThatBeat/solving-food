# Solving Food — working notes for Claude

## Documents are the source of truth

- `PRODUCT_REQUIREMENTS.md` (what) and `TECHNICAL_SPECS.md` (how) are the plan. Build to them. When an
  implementation decision contradicts or extends them, update the document in the same change.
- `SETUP.md` holds every non-secret Firebase fact (project ID, web config, bucket, region, owner email).
  Read it before touching Firebase. Keep it current when anything there changes.
- `THOUGHTS.md` is the original brain dump. Later lines override earlier ones. It is history, not spec.

## Git

- **Commit automatically** after each coherent unit of work, without asking. Small, descriptive commits.
- Branch is `master`. Push is not automatic; the owner pushes.
- Never commit secrets. The Firebase web config is public by design and is fine to commit.

## Machine and tooling

- This is **NixOS**. Never `nix profile install`, `npm i -g`, `pip install --user`, or anything else imperative
  on the machine. Project tools go in this repo's `flake.nix` dev shell (loaded by direnv). Machine-level
  changes go in `~/dotfiles/nixos` (home-manager, `modules/home/dev.nix`), and only if asked.
- The dev shell provides Node 24, pnpm, `firebase-tools`, `google-cloud-sdk`, and a JRE for the emulators.
  Run project commands through it: `nix develop -c <cmd>`, or rely on direnv in an interactive shell.
- Playwright browsers on NixOS come from `pkgs.playwright-driver.browsers`, not `npx playwright install`.
  Pin the Playwright npm version to the nixpkgs driver version.
- Interactive logins (`gcloud auth login`, `gh auth login`) can't run through the session's shell (no stdin).
  Ask the owner to run them in a normal terminal.

## Firebase

- One project, `solvingfood`, region `us-east1` for everything. No dev project: local work and all tests use
  the **Emulator Suite** (`firebase emulators:start`). Never run tests against the live project.
- Free tier is a hard requirement (PRD NFR2). Before adding any Firebase or GCP feature, check the §2 quota
  table in the spec and update it.
- Secrets (PC Express credentials) are set by the owner with `firebase functions:secrets:set PCX_EMAIL` /
  `PCX_PASSWORD`. Never ask for them, never write them anywhere.
- The Firebase CLI is already logged in as the owner. `firebase apps:sdkconfig web` re-fetches the web config.

## Project conventions

- TypeScript strict everywhere; pnpm workspaces (`apps/web`, `functions`, `packages/core`, `e2e`, `data`).
- All business math (units, ledger, scoring, optimiser, grocery builder) lives in `packages/core` and is
  shared by the web app and functions. Keep it free of Firebase imports.
- Supply is never written by the client. Every supply change is a command document applied by a function
  (spec §6). Don't shortcut this, even for "simple" cases.
- Say **Supply**, never "inventory", in UI text.
- `cuisine` and `mainProtein` come from `packages/core/taxonomy.ts` only. The Claude skill embeds the same lists.
- Every user-facing PRD requirement has a Playwright test tagged with its ID (`@R6.5`). Add the tag when you
  add the test; `pnpm e2e:coverage` fails on untagged requirements.
- UI: brutalist, Catppuccin, mobile-first, shadcn/ui + Tailwind. Metric and imperial are always shown together.

## People

- Owner signs in as `buitenwerfa@gmail.com`; it is the first allowlist entry. First household is **Silbrass Pvt**.
