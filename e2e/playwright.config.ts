// Playwright suite (TECHNICAL_SPECS §14.1). Run with `pnpm e2e` from the repo root: it builds the web app against the
// emulators and wraps this in `firebase emulators:exec`.
import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
const PORT = 4173;

const LAYOUT_SPECS = /(responsive|visual|cooking)\.spec\.ts/;

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Two per job on CI: each browser project has its own runner and Emulator Suite (checks.yml), and the emulators are
  // the bottleneck there, not the browsers.
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", maxDiffPixelRatio: 0.002 },
  },
  reporter: CI ? [["github"], ["html", { open: "never" }], ["list"]] : [["list"], ["html", { open: "never" }]],
  globalSetup: "./global-setup.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",
    // The app's service worker is exercised in pwa.spec.ts only; elsewhere it would just precache on every page.
    serviceWorkers: "block",
    timezoneId: "America/Toronto",
    locale: "en-CA",
  },
  webServer: {
    command: "pnpm --filter @solving-food/web preview:e2e",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
  projects: [
    { name: "phone-ios", use: { ...devices["iPhone 15"], viewport: { width: 390, height: 844 } } },
    { name: "phone-android", use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 } } },
    {
      name: "tablet",
      use: { ...devices["iPad (gen 7)"], viewport: { width: 820, height: 1180 } },
      testMatch: LAYOUT_SPECS,
    },
    {
      name: "desktop-1080p",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "desktop-firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1920, height: 1080 } },
      grep: /@smoke/,
    },
    {
      name: "desktop-4k",
      use: { ...devices["Desktop Chrome"], viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 },
      testMatch: /(responsive|visual)\.spec\.ts/,
    },
    {
      name: "desktop-4k-2x",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
      testMatch: /(responsive|visual)\.spec\.ts/,
    },
  ],
});
