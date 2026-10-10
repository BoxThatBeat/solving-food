import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Runs inside `firebase emulators:exec` (see the root `test:functions` script): tests call deployed-in-emulator
// functions over HTTP and inspect Firestore through the Admin SDK.
export default defineConfig({
  resolve: {
    alias: { "@solving-food/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One emulator suite and live triggers: files and tests run one at a time.
    fileParallelism: false,
  },
});
