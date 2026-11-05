import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";

/**
 * Hands-free mode (M11): onnxruntime-web references its 27 MB WASM binary with `new URL(…, import.meta.url)`, so the
 * build would copy it into dist and Hosting would serve it. Transformers.js loads ONNX Runtime's WASM from the jsDelivr
 * CDN instead (and caches it in the browser), so the copy is never requested: drop it to keep it off Hosting.
 */
function dropOrtWasm(): Plugin {
  return {
    name: "sf-drop-ort-wasm",
    apply: "build",
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

/**
 * The ingredient seed for the plan worker (M23): `virtual:sf-seed-ingredients` is data/ingredients/*.json with only the
 * fields scoring and costing read (snapshot.ts), so nutrients, nutrient sources and aliases stay out of the bundle.
 */
const SEED_DIR = fileURLToPath(new URL("../../data/ingredients/", import.meta.url));
const SEED_FIELDS = [
  "id",
  "name",
  "category",
  "allowedMeasures",
  "canonicalUnit",
  "densityGPerMl",
  "unitWeightG",
  "freeUse",
  "defaultPackAmount",
  "defaultPackMeasure",
  "defaultCadenceDays",
  "isStaple",
] as const;
function sfSeedIngredients(): Plugin {
  const id = "virtual:sf-seed-ingredients";
  return {
    name: "sf-seed-ingredients",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null;
      const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".json")).sort();
      const all: Array<Record<string, unknown>> = [];
      for (const f of files) {
        this.addWatchFile(SEED_DIR + f);
        for (const i of JSON.parse(readFileSync(SEED_DIR + f, "utf8")) as Array<Record<string, unknown>>) {
          all.push(Object.fromEntries(SEED_FIELDS.filter((k) => i[k] !== undefined).map((k) => [k, i[k]])));
        }
      }
      return `export default ${JSON.stringify(all)};`;
    },
  };
}

// The splash and install chrome match the app icon's navy (apps/web/public/icons) rather than a Latte
// surface, so no light-grey field shows behind the icon; the runtime theme still updates
// <meta name="theme-color"> per flavour once the app is up.
const ICON_NAVY = "#262a3b";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    dropOrtWasm(),
    sfSeedIngredients(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      filename: "sw.js",
      includeAssets: ["fonts/*.woff2", "icons/*.png"],
      manifest: {
        id: "/",
        name: "Solving Food",
        short_name: "Solving Food",
        description: "Household meal planning: recipes, plan, grocery list, and supply.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: ICON_NAVY,
        theme_color: ICON_NAVY,
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell: everything the build emits, so the shell loads offline after the first visit.
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
        // The speech recognition worker (M11, ~550 kB with ONNX Runtime) is downloaded only by those who switch
        // hands-free on, then cached at runtime below. The hidden voice diagnostics (M13) are for the owner only.
        globIgnores: ["**/stt.worker-*.js", "**/VoiceDiagnostics-*.js"],
        navigateFallback: "/index.html",
        // Firebase reserved paths (auth handler) must reach the network.
        navigateFallbackDenylist: [/^\/__\//],
        cleanupOutdatedCaches: true,
        // Timer push notifications (public/push-sw.js, TECHNICAL_SPECS §12).
        importScripts: ["/push-sw.js"],
        runtimeCaching: [
          {
            // Recipe photos (Storage, public): cached as they're viewed, so planned recipes and the cook view show
            // their images offline (TECHNICAL_SPECS §12 "Offline").
            urlPattern: ({ url }) => url.hostname === "firebasestorage.googleapis.com" && url.pathname.includes("/o/recipes%2F"),
            handler: "CacheFirst",
            options: { cacheName: "recipe-images", expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/stt.worker-"),
            handler: "CacheFirst",
            options: { cacheName: "hands-free", expiration: { maxEntries: 4 } },
          },
          {
            // ONNX Runtime's WASM and its loader (M12), fetched by the speech worker from jsDelivr. The library's own
            // Cache API copy can fail to store ("Cache.put() encountered a network error"), which meant a 5.5 MB
            // download every visit; the service worker keeps it too. Versioned URLs, so CacheFirst is safe.
            urlPattern: ({ url }) => url.hostname === "cdn.jsdelivr.net" && /^\/npm\/onnxruntime-web@[^/]+\/dist\//.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "hands-free-runtime", expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/fonts/"),
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Worker bundles get their own plugin list: the plan worker needs the slim seed.
  worker: { plugins: () => [sfSeedIngredients()] },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // Source maps are built (for debugging a production stack trace by hand) but not referenced from the bundles, and
  // firebase.json keeps them off Hosting (M23: ~10 MB per deploy).
  build: { target: "es2022", sourcemap: "hidden" },
});
