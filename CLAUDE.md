# Solving Food — working notes for Claude

## Documents are the source of truth

- `PRODUCT_REQUIREMENTS.md` (what) and `TECHNICAL_SPECS.md` (how) are the plan. Build to them. When an
  implementation decision contradicts or extends them, update the document in the same change.
- `SETUP.md` holds every non-secret Firebase fact (project ID, web config, bucket, region, owner email).
  Read it before touching Firebase. Keep it current when anything there changes.
- `THOUGHTS.md` is the original brain dump. Later lines override earlier ones. It is history, not spec.
- `Planning/` holds one plan per milestone (`M0-skeleton.md` … `M5-smarts.md`) plus `README.md` with the
  order and conventions. Before starting any implementation work, read the current milestone's plan. Tick its
  checkboxes as tasks land, and edit the plan (in the same commit) when the work deviates from it.

## Design reference: `claude-design-result/`

`claude-design-result/Solving Food.dc.html` is a **Claude Design prototype of the full app, every page, in one
file**. Open it in a browser (it loads `support.js` next to it). It is the visual and interaction reference
for implementation: layout per page, component shapes, spacing, type, colour tokens, sheet and toast
behaviour, and the phone / tablet / desktop / 4K variants (the "device" prop at the top of the script block
near line 815 switches them).

- **Match its look**, don't reinvent it. When the PRD or spec and the design disagree on *behaviour*, the
  documents win and the design gets a note; when they disagree on *appearance*, the design wins.
- **It is not a feature spec.** The prototype does not have full parity with the requirements: some screens,
  states, and controls the PRD asks for are missing from it, and a few things it shows are simplified. Build
  everything the PRD and the milestone plan require, whether or not the prototype shows it, and style the
  parts it doesn't show in the same visual language. Never drop a requirement because "the design doesn't
  have it", and never add a feature only because the prototype shows it.
- **Pixel-close, not pixel-perfect.** Design-compare is for catching wrong tokens, type, spacing, and layout,
  not for chasing every pixel. Accessibility fixes (contrast, hit targets, focus rings) take precedence over
  matching the prototype exactly; record them in the milestone plan.
- **Pages** in the prototype: plan, recipes, meals, supply, grocery, history, settings. **Sheets:** filter,
  supply item, plan item, more, household, confirm purchase, add. **Cooking phases:** mise, steps, review.
  **Grocery phases:** order, receipt (with the Costco in-store checklist and the freeze step).
- **Type:** Archivo (500–900) and Archivo Black for display, JetBrains Mono for numbers and amounts.
- **Tokens** (CSS variables in the file): `--base`, `--mantle`, `--pg`, `--desk`, `--ink`, `--sub`, `--acc`,
  `--onc` (text on accent), `--line`, `--bw` (border width), `--r` (radius), `--sh` (hard shadow), `--tt`.
  Reproduce these as the app's theme variables so the Catppuccin flavour and accent map one-to-one.
- **Colour source of truth is the prototype's `FLAV` table** in the script block (search `const FLAV=`), not
  `@catppuccin/palette` guesses. **Catppuccin Latte is the default flavour and the reference** for every
  design decision and screenshot baseline. Its values: ink `#4c4f69`, sub `#6c6f85`, base `#eff1f5`,
  mantle `#e6e9ef`, pg `#dce0e8`, s0 `#ccd0da`, onc `#4c4f69`, desk `#bcc0cc`, scrim `rgba(76,79,105,.55)`.
  (M0 exception: the app uses sub `#5c5f77`, Catppuccin Latte Subtext 1, because `#6c6f85` fails WCAG AA for
  small text on Latte backgrounds.)
  Accents come from the prototype's `ACCENTS` list (green `#a6da95` is the default). The other three flavours
  stay selectable per PRD R11.9 using the same table; build Latte first and verify it pixel-close before
  touching the others.
- **Styling is Tailwind CSS (v4) + shadcn/ui.** Theme tokens are exposed as CSS variables and mapped into
  Tailwind's theme so utilities like `bg-base text-ink border-line` exist. No other CSS framework, no
  CSS-in-JS. Hand-written CSS only for things Tailwind can't express (fluid root font size, step-mode
  typography, print).
- The prototype also has a **"look"** switch (Quiet / Classic / Loud) that scales border weight, shadow, and
  radius. Ship **Classic**; keep the token structure so the others could be added later.
- Data and state in the prototype are mock. Never copy its data model; the Firestore model in the spec is the
  truth. Treat the prototype's "Sam" user, sample recipes, and prices as placeholders.

## Visual verification (do this, don't guess)

Claude can drive a headless browser here. Two project skills cover it:

- **`playwright-cli`**: `scripts/pw open|goto|click|snapshot|screenshot|resize|close …` runs Microsoft's
  Playwright CLI on the nixpkgs Chromium from the dev shell. Read the resulting PNG with the Read tool.
- **`design-compare`**: the procedure for screenshotting a page of the running app and the same page of the
  prototype (served by `node scripts/design-serve.mjs --daemon` at `http://127.0.0.1:8787/`, with
  `/v/<device>/<flavour>/<look>.html` variants) at the same viewport, reading both, and fixing differences.

Every UI task ends with a design-compare pass on phone and desktop before its checkbox is ticked. `file:`
URLs are blocked in the CLI; serve things over HTTP. Screenshots never go into the repo.

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
