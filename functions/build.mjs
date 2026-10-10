// Bundles the functions with esbuild. @solving-food/core (and its deps) are inlined from the workspace, so the
// deployed package.json only lists firebase-admin and firebase-functions and Cloud Build's `npm install` works
// without pnpm's workspace protocol.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*", "sharp"],
  banner: {
    // Some bundled CJS deps call require(); give ESM output a require().
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
