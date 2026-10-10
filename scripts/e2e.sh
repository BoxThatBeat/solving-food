#!/usr/bin/env bash
# `pnpm e2e [playwright args…]`: builds the web app against the emulators, then runs Playwright inside
# `firebase emulators:exec` so the Emulator Suite starts and stops with the run.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm --filter @solving-food/functions build
pnpm --filter @solving-food/web build:e2e
args=""
for a in "$@"; do args+=" $(printf '%q' "$a")"; done
exec firebase emulators:exec --only auth,firestore,storage,functions "pnpm --filter @solving-food/e2e test${args}"
