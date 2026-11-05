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

## Visual language

The app itself is the visual reference. `claude-design-result/` holds the original Claude Design prototype;
it is history (like `THOUGHTS.md`), not a reference to match, and nothing compares against it any more.

- **Styling is Tailwind CSS (v4) + shadcn/ui.** Theme tokens are CSS variables (`--base`, `--mantle`, `--pg`,
  `--desk`, `--ink`, `--sub`, `--acc`, `--onc`, `--line`, `--bw`, `--r`, `--sh`, `--tt`) mapped into Tailwind's
  theme, so utilities like `bg-base text-ink border-line` exist. No other CSS framework, no CSS-in-JS.
  Hand-written CSS only for things Tailwind can't express (fluid root font size, step-mode typography, print).
- **Look:** brutalist, Catppuccin Latte only (PRD R11.9; the accent is the one choice in Settings, green
  `#a6da95` by default), "Classic" weights for borders, hard shadows and radius. Latte values: ink `#4c4f69`,
  sub `#5c5f77` (Subtext 1, for WCAG AA), base `#eff1f5`, mantle `#e6e9ef`, pg `#dce0e8`, s0 `#ccd0da`,
  onc `#4c4f69`, desk `#bcc0cc`, scrim `rgba(76,79,105,.55)`. Keep the token structure so a flavour or look
  could come back, but don't build or test others.
- **Type:** Archivo (500–900) and Archivo Black for display, JetBrains Mono for numbers and amounts.
- **New UI reuses existing components** (`apps/web/src/components/ui`, the shared sheets, chips, steppers,
  pickers and cards) and the same spacing and kicker headings as the page it sits on. Accessibility rules
  (contrast, 44 px hit targets on phones, focus rings) are enforced by `e2e/specs/a11y.spec.ts` and win over
  any styling choice.

## Visual verification (do this, don't guess)

Claude can drive a headless browser here with the **`playwright-cli`** project skill: `scripts/pw
open|goto|click|snapshot|screenshot|resize|close …` runs Microsoft's Playwright CLI on the nixpkgs Chromium
from the dev shell. Read the resulting PNG with the Read tool.

Every UI task ends with a screenshot check before its checkbox is ticked: screenshot the new or changed screen
in the running app on phone (430×932) and desktop (1920×1080), read the images, and confirm it matches the
styling of the rest of the app (tokens, type, spacing, component shapes, empty and loading states). Fix what
doesn't match. `file:` URLs are blocked in the CLI; serve things over HTTP. Screenshots never go into the repo.

## Git

- **Commit automatically** after each coherent unit of work, without asking. Small, descriptive commits.
- Branch is `master`. **Push when the whole task is done** (`git push`), not after every commit: a task may
  span several commits; push once at the end, after the last one lands and everything passes.
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
- No secrets today: PC Express runs signed out on the website's public API key, which the owner saves in Settings →
  Stores (PRD R6.28, SETUP.md). Any
  future secret is set by the owner with `firebase functions:secrets:set`; never ask for it, never write it anywhere.
- The Firebase CLI is already logged in as the owner. `firebase apps:sdkconfig web` re-fetches the web config.

## Project conventions

- TypeScript strict everywhere; pnpm workspaces (`apps/web`, `functions`, `packages/core`, `e2e`, `data`).
- All business math (units, ledger, scoring, optimiser, grocery builder) lives in `packages/core` and is
  shared by the web app and functions. Keep it free of Firebase imports.
- Supply is never written by the client. Every supply change is a command document applied by a function
  (spec §6). Don't shortcut this, even for "simple" cases.
- Ingredient name matching lives in `packages/core/src/ingredientMatch.ts` (`matchIngredient`, `suggestIngredients`).
  Duplicates are merged only by the `mergeIngredient` callable, which moves Supply and repoints every reference;
  never rewrite ingredient IDs from the client or a script that bypasses it.
- Say **Supply**, never "inventory", in UI text.
- Sides (M6) are ingredients with a per-person `portion` (canonical), snapshotted onto meals and plan items when
  created; everything downstream (builder, functions, History) reads the meal's copy, never Settings.
- `cuisine` and `mainProtein` come from `packages/core/taxonomy.ts` only. The Claude skill embeds the same lists.
- Every user-facing PRD requirement has a Playwright test tagged with its ID (`@R6.5`). Add the tag when you
  add the test; `pnpm e2e:coverage` fails on untagged requirements.
- UI: brutalist, Catppuccin, mobile-first, shadcn/ui + Tailwind. Units (PRD R8.13, rule v3): recipe pages show
  one unit system per amount, never both: imperial weights and fl oz/pints/quarts/gallons convert to metric only
  (`2 lb` → `900 g`), cups and spoons read as written with no metric (`1 cup flour`, `2 tbsp`), counts and metric as
  written; temperatures are Fahrenheit only, never Celsius. Supply reads in the unit
  it was added in (`displayUnit`, else the pack measure), stored in grams; everything else (grocery, History, review) is
  metric only.

## People

- Owner signs in as `buitenwerfa@gmail.com`; it is the first allowlist entry. First household is **Silbrass Pvt**.
