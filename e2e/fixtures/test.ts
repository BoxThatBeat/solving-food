// Shared fixtures (TECHNICAL_SPECS §14.1 "Structure & practices"): specs read as user stories.
//
// Tests run in parallel across workers and projects against one Emulator Suite, so every test uses its own
// addresses and households (`uniqueEmail`) instead of wiping data between files. `resetFirestore()` exists for
// suites that run alone.
import { test as base, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { addMember, allowlist, loadSeed, seedHousehold, seedProfile, uidFor } from "./admin";
import { appLinkFrom, latestSignInLink } from "./emulator";

export interface SignedInUser {
  email: string;
  uid: string;
  displayName: string;
  hid: string;
  householdName: string;
}

export interface SeedApi {
  /** Loads e2e/seed/<name>.json; `{var}` placeholders in paths and strings are replaced from `vars`. */
  load(name: string, vars?: Record<string, string>): Promise<void>;
}

function makeEmail(testInfo: TestInfo, prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${testInfo.project.name}-${testInfo.workerIndex}-${rand}@example.com`.toLowerCase();
}

/** Requests a link on /sign-in and opens it the way the email would (same browser, so no email prompt). */
export async function signInWithEmailLink(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  const oob = await latestSignInLink(email);
  await page.goto(appLinkFrom(oob));
}

/** First run through the UI: display name, then the household form with its defaults (name overridable). */
export async function onboard(page: Page, opts: { displayName: string; household?: string }): Promise<void> {
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
  await page.getByLabel("Display name").fill(opts.displayName);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create your household" })).toBeVisible();
  if (opts.household) await page.getByLabel("Household name").fill(opts.household);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page).toHaveURL(/\/recipes$/);
}

type Fixtures = {
  uniqueEmail: (prefix?: string) => string;
  signedInAs: (opts?: { email?: string; displayName?: string; household?: string; theme?: { flavour: string; accent: string } }) => Promise<SignedInUser>;
  household: SignedInUser;
  secondMember: { page: Page; context: BrowserContext; user: Omit<SignedInUser, "householdName"> };
  seed: SeedApi;
};

/** With E2E_DEBUG=1, browser console errors and warnings are printed with the test output. */
export function forwardConsole(page: Page, label = ""): void {
  if (!process.env.E2E_DEBUG) return;
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[browser${label}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[browser${label}] pageerror: ${e.message}`));
}

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    forwardConsole(page);
    await use(page);
  },
  uniqueEmail: async ({}, use, testInfo) => {
    await use((prefix = "user") => makeEmail(testInfo, prefix));
  },

  // Signs a fresh allowlisted person in through the real email-link flow; profile and household are seeded with the
  // Admin SDK (the UI paths for those are covered by auth.spec.ts and households.spec.ts).
  signedInAs: async ({ page }, use, testInfo) => {
    await use(async (opts = {}) => {
      const email = opts.email ?? makeEmail(testInfo, "member");
      const displayName = opts.displayName ?? "Aaron";
      await allowlist(email);
      await signInWithEmailLink(page, email);
      await expect(page).toHaveURL(/\/welcome$/);
      const uid = (await uidFor(email))!;
      await seedProfile(uid, email, displayName, opts.theme ? { theme: opts.theme } : {});
      const hh = await seedHousehold(uid, displayName, opts.household ?? "Silbrass Pvt");
      await expect(page).toHaveURL(/\/recipes$/, { timeout: 20_000 });
      await expect(page.getByRole("heading", { level: 1, name: "Recipes" })).toBeVisible();
      return { email, uid, displayName, hid: hh.hid, householdName: hh.name };
    });
  },

  household: async ({ signedInAs }, use) => {
    await use(await signedInAs());
  },

  // Another person in the same household, signed in on their own browser context.
  secondMember: async ({ browser, household }, use, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = makeEmail(testInfo, "second");
    await allowlist(email);
    await signInWithEmailLink(page, email);
    await expect(page).toHaveURL(/\/welcome$/);
    const uid = (await uidFor(email))!;
    await seedProfile(uid, email, "Sam");
    await addMember(household.hid, uid, "Sam");
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Recipes" })).toBeVisible();
    await use({ page, context, user: { email, uid, displayName: "Sam", hid: household.hid } });
    await context.close();
  },

  seed: async ({}, use) => {
    await use({
      async load(name, vars = {}) {
        const { default: docs } = (await import(`../seed/${name}.json`, { with: { type: "json" } })) as {
          default: Record<string, Record<string, unknown>>;
        };
        await loadSeed(docs, vars);
      },
    });
  },
});

export { expect };
