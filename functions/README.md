# functions

Cloud Functions for Firebase (2nd gen, TypeScript), region `us-east1`.

- `pnpm --filter @solving-food/functions build` bundles `src/` with esbuild into `lib/index.js`. `@solving-food/core`
  is inlined, so the deployed `package.json` needs only `firebase-admin` and `firebase-functions`.
- `pnpm test:functions` (repo root) builds, starts the Functions + Firestore emulators, and runs `test/`.
- **Node version:** the Cloud runtime is Node 22 (`engines.node` here and `runtime` in `firebase.json`). The dev shell
  ships Node 24 only; the emulator warns about the mismatch and runs the functions on Node 24 anyway. Bundling targets
  `node22`, so nothing newer than Node 22 syntax reaches the deployed code.
