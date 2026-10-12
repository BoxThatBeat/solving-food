// PWA (PRD §12 "Installable PWA"): manifest, service worker, offline shell after the first visit.
import { expect, onboard, signInWithEmailLink, test } from "../fixtures/test";
import { allowlist } from "../fixtures/admin";

test.use({ serviceWorkers: "allow" });

test("the manifest is valid and its icons exist", { tag: ["@smoke"] }, async ({ page, request }) => {
  await page.goto("/sign-in");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "Solving Food", short_name: "Solving Food", display: "standalone", start_url: "/" });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#dce0e8");
  // Prompt-mode worker: a new build waits until the page posts SKIP_WAITING (then the page reloads itself).
  expect(await (await request.get("/sw.js")).text()).toContain("SKIP_WAITING");
});

test("the service worker registers and the shell loads offline after the first visit", async ({ page, context, browserName, uniqueEmail }) => {
  test.skip(browserName !== "chromium", "Playwright supports service-worker offline control in Chromium only");
  const email = uniqueEmail("offline");
  await allowlist(email);
  await signInWithEmailLink(page, email);
  await onboard(page, { displayName: "Aaron", household: "Silbrass Pvt" });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload once so the page is controlled by the worker, then cut the network.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  await expect(page.getByText("OFFLINE").first()).toBeAttached();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await context.setOffline(false);
});
