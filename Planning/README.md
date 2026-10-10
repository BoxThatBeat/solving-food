# Planning

One file per milestone, in build order. Each plan turns the milestone row in `TECHNICAL_SPECS.md` §15 into
ordered, checkable tasks with the files they touch, the tests that prove them, and the exit criteria.

| File | Milestone | Depends on | Delivers |
|---|---|---|---|
| [M0-skeleton.md](M0-skeleton.md) | Skeleton | — | Monorepo, Firebase wiring, emulators, PWA shell, theme, sign-in with allowlist, first household, CI, Playwright harness |
| [M1-recipes.md](M1-recipes.md) | Recipes | M0 | Ingredient seed data, recipe editor, versioning, Trash, search, drop folder + Claude skill, dedupe, share links, notifications |
| [M2-plan-grocery.md](M2-plan-grocery.md) | Plan + Grocery | M1 | Periods, household settings, meals, Plan page, budget meter, brand mappings, stores, grocery builder, copy button |
| [M3-supply-cooking.md](M3-supply-cooking.md) | Supply & Cooking | M2 | Commands + ledger, Supply page, receive groceries, cooking views, timers, review flow, leftovers, expiry, History |
| [M4-households.md](M4-households.md) | Households | M3 | Directory, invites, multiple households, member management, data download & import |
| [M5-smarts.md](M5-smarts.md) | Smarts | M3 (M4 optional) | Suggestions, weights, protein goals, optimiser, expiry alerts, staples cadence, PC Express module |

## How to use these plans

- **Read the current plan before coding.** Tasks are ordered; later tasks assume earlier ones exist.
- **Tick checkboxes as tasks land** and commit the plan with the code. A task is done when its tests pass, not
  when the code compiles.
- **Deviations go in the plan**, in the same commit, with a one-line reason. The spec is updated too if the
  deviation changes a documented decision.
- **Design reference:** every UI task should be built by opening `claude-design-result/Solving Food.dc.html`
  on the matching page and device mode first (see `CLAUDE.md`).
- **Requirement tags:** every user-facing requirement ID listed under a milestone's "Requirements covered"
  must have a Playwright test tagged with it by the end of that milestone. `pnpm e2e:coverage` enforces this
  for the IDs whose milestone is complete (it reads the `Status` line at the top of each plan).
- **Definition of done** for a milestone: all checkboxes ticked, the listed spec files pass in CI across the
  project matrix, the exit-criteria checklist is verified on the deployed app, and `Status:` is set to `done`.

## Cross-cutting rules (apply to every milestone)

- Business logic goes in `packages/core` with unit tests; the web app and functions only call it.
- Clients never write function-only collections (supply, stats, cookEvents, ratings, cadence).
- Free tier: before adding any Firebase/GCP feature, update the §2 quota table in the spec.
- Both metric and imperial everywhere an amount is shown (`formatAmount()` from core).
- Mobile-first, then tablet, 1080p, 4K. Every page must look intentional at 360 px and 3840 px.
- The word is **Supply**, never inventory.
