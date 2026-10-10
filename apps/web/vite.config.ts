import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

// Latte is the reference flavour (CLAUDE.md); the runtime theme updates <meta name="theme-color"> per flavour.
const LATTE_PG = "#dce0e8";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
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
        background_color: LATTE_PG,
        theme_color: LATTE_PG,
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
