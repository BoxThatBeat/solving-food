// R2.1 passwordless sign-in, R2.12 invite-only sign-up, R2.11 same experience on every device.
import { adminDb, allowlist, uidFor } from "../fixtures/admin";
import { appLinkFrom, latestSignInLink } from "../fixtures/emulator";
import { expect, onboard, signInWithEmailLink, test } from "../fixtures/test";

test.describe("sign-in", () => {
  test("an allowlisted address signs in with an email link and sets a display name", { tag: ["@R2.1", "@R2.12", "@smoke"] }, async ({ page, uniqueEmail }) => {
    const email = uniqueEmail("owner");
    await allowlist(email);
    await signInWithEmailLink(page, email);
    await expect(page).toHaveURL(/\/welcome$/);

    await page.getByLabel("Display name").fill("  Aaron  ");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Create your household" })).toBeVisible();

    const uid = (await uidFor(email))!;
    // The page moves on as soon as the write is applied locally; wait for the server copy.
    await expect.poll(async () => (await adminDb.doc(`users/${uid}`).get()).exists).toBe(true);
    const user = (await adminDb.doc(`users/${uid}`).get()).data();
    expect(user).toMatchObject({ email, householdsCreated: 0, activeHouseholdId: null, theme: { flavour: "latte", accent: "green" } });
    expect((await adminDb.doc(`directory/${uid}`).get()).data()).toEqual({ displayName: "Aaron", displayNameLower: "aaron" });
  });

  test("a display name is required", { tag: ["@R2.1"] }, async ({ page, uniqueEmail }) => {
    const email = uniqueEmail();
    await allowlist(email);
    await signInWithEmailLink(page, email);
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("Enter a name");
    await expect(page).toHaveURL(/\/welcome$/);
  });

  test("an address that isn't invited reaches 'not invited' and nothing is created", { tag: ["@R2.12", "@smoke"] }, async ({ page, uniqueEmail }) => {
    const email = uniqueEmail("stranger");
    await signInWithEmailLink(page, email);
    await expect(page.getByRole("heading", { name: "This address hasn't been invited" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page).toHaveURL(/\/not-invited/);

    const uid = (await uidFor(email))!;
    expect((await adminDb.doc(`users/${uid}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`directory/${uid}`).get()).exists).toBe(false);

    // Signed out: the shell is out of reach.
    await page.goto("/recipes");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("the 'Paste sign-in link' fallback signs in (iOS home-screen app)", { tag: ["@R2.1"] }, async ({ page, browser, uniqueEmail }) => {
    const email = uniqueEmail("ios");
    await allowlist(email);
    // The link is requested in "Safari"…
    const safari = await browser.newPage();
    await safari.goto("/sign-in");
    await safari.getByLabel("Email", { exact: true }).fill(email);
    await safari.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(safari.getByText("Check your email")).toBeVisible();
    const link = (await latestSignInLink(email)).oobLink;
    await safari.close();
    // …and pasted into the installed app, which has its own storage.
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Sign-in link").fill(link);
    await page.getByRole("button", { name: "Sign in with link" }).click();
    await expect(page).toHaveURL(/\/welcome$/);
  });

  test("a pasted link that isn't a sign-in link is rejected", { tag: ["@R2.1"] }, async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill("someone@example.com");
    await page.getByLabel("Sign-in link").fill("https://example.com/not-a-link");
    await page.getByRole("button", { name: "Sign in with link" }).click();
    await expect(page.getByRole("alert")).toContainText("isn't a Solving Food sign-in link");
  });

  test("a link opened in another browser asks for the address first", { tag: ["@R2.1"] }, async ({ page, browser, uniqueEmail }) => {
    const email = uniqueEmail("other-device");
    await allowlist(email);
    const requester = await browser.newPage();
    await requester.goto("/sign-in");
    await requester.getByLabel("Email", { exact: true }).fill(email);
    await requester.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(requester.getByText("Check your email")).toBeVisible();
    await requester.close();

    await page.goto(appLinkFrom(await latestSignInLink(email)));
    await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/welcome$/);
  });

  test("a used link explains itself", { tag: ["@R2.1"] }, async ({ page, browser, uniqueEmail }) => {
    const email = uniqueEmail("reuse");
    await allowlist(email);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    // The emulator forgets a code once it's used, so keep the link before using it.
    const link = appLinkFrom(await latestSignInLink(email));
    await page.goto(link);
    await expect(page).toHaveURL(/\/welcome$/);
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto("/sign-in");
    await p2.evaluate((e) => localStorage.setItem("sf.signInEmail", e), email);
    await p2.goto(link);
    await expect(p2.getByRole("alert")).toContainText("expired or was already used");
    await other.close();
  });

  test("signing out from Settings returns to sign-in", { tag: ["@R2.1"] }, async ({ page, household }) => {
    void household;
    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/plan");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("the same account on a second device sees the same household", { tag: ["@R2.11"] }, async ({ page, browser, uniqueEmail }) => {
    const email = uniqueEmail("two-devices");
    await allowlist(email);
    await signInWithEmailLink(page, email);
    await onboard(page, { displayName: "Aaron", household: "Silbrass Pvt" });

    const desktop = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p2 = await desktop.newPage();
    await signInWithEmailLink(p2, email);
    await expect(p2).toHaveURL(/\/recipes$/);
    await expect(p2.getByRole("button", { name: /Household: Silbrass Pvt/ }).first()).toBeVisible();
    await desktop.close();
  });
});
