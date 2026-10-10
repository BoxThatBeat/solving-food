// toHaveScreenshot baselines for the sign-in page and the Recipes library in Latte and Mocha at phone, 1080p, and 4K (TECHNICAL_SPECS §14.1).
// Chromium projects only, so baselines come from one engine; generated in the Nix dev shell, which CI also uses.
import { allowlist, seedHousehold, seedProfile, uidFor } from "../fixtures/admin";
import { expect, signInWithEmailLink, test } from "../fixtures/test";

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== "chromium", "visual baselines are Chromium-only");
});

for (const flavour of ["latte", "mocha"] as const) {
  test(`sign-in page · ${flavour}`, async ({ page }) => {
    await page.goto("/sign-in");
    // The localStorage mirror the app writes (src/theme/apply.ts); index.html paints it before boot.
    await page.evaluate(async (f) => {
      const vars: Record<string, string> =
        f === "mocha"
          ? { ink: "#cdd6f4", sub: "#a6adc8", base: "#1e1e2e", mantle: "#181825", pg: "#11111b", s0: "#313244", onc: "#11111b", desk: "#0a0a11", scrim: "rgba(0,0,0,.65)", line: "#cdd6f4", acc: "#a6da95" }
          : { ink: "#4c4f69", sub: "#6c6f85", base: "#eff1f5", mantle: "#e6e9ef", pg: "#dce0e8", s0: "#ccd0da", onc: "#4c4f69", desk: "#bcc0cc", scrim: "rgba(76,79,105,.55)", line: "#4c4f69", acc: "#a6da95" };
      localStorage.setItem("sf.theme", JSON.stringify({ theme: { flavour: f, accent: "green" }, vars }));
    }, flavour);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`sign-in-${flavour}.png`, { fullPage: true });
  });

  test(`Recipes library · ${flavour}`, async ({ page, uniqueEmail }) => {
    // Fixed names so the pixels don't depend on generated test data.
    const email = uniqueEmail("visual");
    await allowlist(email);
    await signInWithEmailLink(page, email);
    await expect(page).toHaveURL(/\/welcome$/);
    const uid = (await uidFor(email))!;
    await seedProfile(uid, email, "Aaron", { theme: { flavour, accent: "green" } });
    await seedHousehold(uid, "Aaron", "Silbrass Pvt");
    await expect(page).toHaveURL(/\/recipes$/);
    // A fixed slice of the seeded household recipes (other specs add recipes in parallel; theirs are cuisine "other").
    await page.goto("/recipes?cuisine=greek&protein=dairy&sort=name");
    const cards = page.getByRole("list", { name: "Recipes" }).getByRole("heading", { level: 3 });
    await expect(cards).toHaveText(["Greek Salad", "Tzatziki Sauce"]);
    await expect.poll(() => page.locator("img").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    // Wait for the live data the shell shows: household name and its member list.
    const wide = page.viewportSize()!.width >= 1024;
    await expect(page.getByText(wide ? "Silbrass Pvt" : "Silbrass Pvt · 1").filter({ visible: true }).first()).toBeVisible();
    if (wide) await expect(page.getByText("Aaron", { exact: true }).filter({ visible: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`recipes-library-${flavour}.png`, { fullPage: true });
  });
}
