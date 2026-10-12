import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

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
            urlPattern: ({ url }) => url.pathname.startsWith("/fonts/"),
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
