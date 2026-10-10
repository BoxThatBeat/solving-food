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
    testTimeout: 20_000,
  },
});
