---
name: design-compare
description: Compare a page of the running Solving Food app against the Claude Design prototype at the same device size and flavour, by screenshotting both with scripts/pw and reading the images side by side. Use after building or changing any screen, before ticking its plan checkbox, or when asked whether the UI matches the design.
allowed-tools: Bash(scripts/pw:*) Bash(node scripts/design-serve.mjs:*) Bash(nix develop:*) Bash(pnpm:*) Read
---

# Design compare: app vs. prototype

The reference is `claude-design-result/Solving Food.dc.html`. `scripts/design-serve.mjs` serves it on
`http://127.0.0.1:8787/` with generated variants for every device mode, flavour, and look:

```
/                                       Phone · Latte · Classic (the file as shipped)
/v/<device>/<flavour>/<look>.html       device: phone | tablet | desktop | 4k | fill
                                        flavour: latte | frappe | macchiato | mocha
                                        look: quiet | classic | loud
```

`fill` makes the prototype fill the window, so pair it with `scripts/pw resize W H` for any viewport. The
prototype's page (Plan, Recipes, …) is UI state: navigate with the bottom nav or side nav after loading.

## Viewports

| Device | Prototype variant | `scripts/pw resize` | Matches spec breakpoint |
|---|---|---|---|
| Phone | `phone` | 430 932 | base |
| Tablet | `tablet` | 820 1180 | md |
| Desktop 1080p | `desktop` | 1920 1080 | xl |
| 4K | `4k` | 3840 2160 | 3xl (large PNG; crop with a `screenshot <ref>` on an element when possible) |

## Procedure

1. **Serve the prototype** (once): `node scripts/design-serve.mjs --daemon`. Stop later with `--stop`.
2. **Run the app** against the emulators (`pnpm dev`, or `vite preview` on a built app) and note its URL.
3. **Screenshot the prototype** for the page and device under review:
   ```bash
   scripts/pw -s=design open http://127.0.0.1:8787/v/phone/latte/classic.html
   scripts/pw -s=design resize 430 932
   scripts/pw -s=design find "Recipes"          # get the nav ref
   scripts/pw -s=design click e42               # navigate to the page under review
   scripts/pw -s=design screenshot --filename=/tmp/claude-1000/.../design-recipes-phone.png
   ```
4. **Screenshot the app** at the same size and route, signed in the same way the fixtures do:
   ```bash
   scripts/pw -s=app open http://localhost:5173/recipes
   scripts/pw -s=app resize 430 932
   scripts/pw -s=app screenshot --filename=/tmp/claude-1000/.../app-recipes-phone.png
   ```
5. **Read both PNGs** with the Read tool and compare, in this order:
   - Layout: same regions, same order, same column count for the device.
   - Type: Archivo for display, JetBrains Mono for numbers and labels; weights and the uppercase tracking on
     labels.
   - Tokens: background `--pg`/`--base` layering, `--ink` text, `--line` borders at `--bw` width, hard
     `--sh` shadow, radius `--r`, accent only where the prototype uses it.
   - Spacing and density: card padding, gaps, control heights.
   - Content states: empty state, badges, chips, counts in the nav.
6. **List the differences** concretely ("card border is 1px, prototype is 2px"; "nav label is sentence case,
   prototype is uppercase mono"), fix them, re-screenshot, and repeat until the remaining differences are
   intentional. Record intentional differences in the plan file for that milestone.
7. **Close** both sessions: `scripts/pw -s=design close`, `scripts/pw -s=app close`.

## Rules

- Latte is the only flavour the app ships (M9); compare in Latte only.
- Never copy the prototype's mock data or state model; only its appearance.
- Behaviour follows the PRD and spec when they disagree with the prototype; appearance follows the prototype.
- Screenshots are temporary: write them under the session scratchpad or `.playwright-cli/`, never into the repo.
