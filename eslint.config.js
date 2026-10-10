// ESLint 9+/10 flat config for the whole monorepo.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-e2e/**",
      "functions/lib/**",
      "**/routeTree.gen.ts",
      "claude-design-result/**",
      "e2e/test-results/**",
      "e2e/playwright-report/**",
      ".emulator-data/**",
      ".playwright-cli/**",
      "scripts/design-serve.mjs", // dev-only helper for design comparison, not app code
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Business logic stays free of Firebase (CLAUDE.md, Planning/README.md).
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["firebase", "firebase/*", "firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*", "@firebase/*"],
              message: "packages/core must not import Firebase. Keep business logic pure; call it from apps/web or functions.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Playwright fixtures must destructure `{}` when they use no other fixtures.
    files: ["e2e/**/*.ts"],
    rules: { "no-empty-pattern": "off" },
  },
  {
    // TanStack Router route modules export `Route` next to their components; the router plugin handles HMR.
    files: ["apps/web/src/routes/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
