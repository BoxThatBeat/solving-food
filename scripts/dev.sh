#!/usr/bin/env bash
# `pnpm dev`: Emulator Suite (with the UI on :4000) + Vite dev server on :5173 wired to the emulators.
# Emulator data persists in .emulator-data/ between runs. The owner's allowlist entry is seeded on start.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm --filter @solving-food/functions build
import=()
if [[ -d .emulator-data ]]; then import=(--import .emulator-data); fi
exec firebase emulators:exec --ui --only auth,firestore,storage,functions "${import[@]}" --export-on-exit .emulator-data \
  "pnpm seed:allowlist:emulator && pnpm --filter @solving-food/web dev"
