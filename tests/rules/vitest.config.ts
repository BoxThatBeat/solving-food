import { defineConfig } from "vitest/config";

// Runs inside `firebase emulators:exec --only firestore,storage` (root `test:rules`).
export default defineConfig({
  test: {
    include: ["*.test.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
