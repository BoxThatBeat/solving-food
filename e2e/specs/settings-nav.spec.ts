// settings-nav.spec.ts (Planning/M20): the Settings page grouped under headings, its search, the Nutrition goals and
// Account pages split off, the invites banner only with an open invite, and the ChatGPT instructions in Stores.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makePlanRecipe, seedPeriod, seedPlanItem } from "../pages/plan";

const GROUPS = ["Household", "Food & planning", "Shopping", "Recipes & ingredients", "You & data"];

test("Settings sections sit under group headings (R11.16)", { tag: ["@R11.16"] }, async ({ page, household }) => {
  void household;
  await page.goto("/settings");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  for (const g of GROUPS) await expect(nav.getByRole("heading", { name: g, exact: true, level: 2 })).toBeVisible();
  const group = (name: string) => nav.getByRole("region", { name, exact: true });
  await expect(group("Household").getByRole("link")).toHaveText([/^Household/, /^Members/]);
  await expect(group("Food & planning").getByRole("link")).toHaveText([/^Preferences/, /^Nutrition goals/, /^Sides/, /^Kitchen tools/, /^Suggestion weights/]);
  await expect(group("Shopping").getByRole("link")).toHaveText([/^Stores/, /^Brands/]);
  await expect(group("Recipes & ingredients").getByRole("link")).toHaveText([/^Ingredients/, /^Gemini/]);
  await expect(group("You & data").getByRole("link")).toHaveText([/^Account/, /^Theme/, /^Data/]);
  // Account and Invites are no longer cards on this page.
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByText("No open invites.")).toHaveCount(0);
});

test("Settings search filters the sections by name, description and keywords; Enter opens the first (R11.17)", { tag: ["@R11.17"] }, async ({ page, household }) => {
  void household;
  await page.goto("/settings");
  const search = page.getByRole("searchbox", { name: "Search settings" });
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await search.fill("costco");
  await expect(nav.getByRole("link")).toHaveText([/^Stores/]);
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText(["Shopping"]);
  await search.fill("protein");
  await expect(nav.getByRole("link")).toHaveText([/^Nutrition goals/]);
  await search.fill("API key");
  await expect(nav.getByRole("link")).toHaveText([/^Stores/, /^Gemini/]);
  await search.fill("budget");
  await expect(nav.getByRole("link")).toHaveText([/^Household/]);
  await search.fill("chatgpt");
  await expect(nav.getByRole("link")).toHaveText([/^Stores/]);
  await search.fill("accent");
  await expect(nav.getByRole("link")).toHaveText([/^Theme/]);
  await search.fill("zzqx nonsense");
  await expect(nav).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "No settings match" })).toBeVisible();
  await search.fill("fibre");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/settings\/nutrition$/);
  await expect(page.getByRole("heading", { name: "Nutrition goals", level: 1 })).toBeVisible();
});

test("Nutrition goals is its own page with the protein goal; Preferences keeps likes and diets (R11.16, R11.4)", { tag: ["@R11.16", "@R11.4"] }, async ({ page, household }) => {
  void household;
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Nutrition goals/ }).click();
  await expect(page).toHaveURL(/\/settings\/nutrition$/);
  await expect(page.getByRole("switch", { name: "Track protein and fibre" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Dinner protein goal" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Dinner fibre goal" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Preferences/ }).click();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(page.getByLabel("Add a food, cuisine or word")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Dinner protein goal" })).toHaveCount(0);
});

test("Account is its own page: who's signed in, Sign out, invites (R11.18, R2.1)", { tag: ["@R11.18", "@R2.1"] }, async ({ page, household }) => {
  void household;
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Account/ }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByText(/Signed in as .* · /)).toBeVisible();
  await expect(page.getByText("No open invites.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the invites banner shows at the top of Settings only while there's an open invite (R11.18, R2.4)", { tag: ["@R11.18", "@R2.4"] }, async ({ page, household }) => {
  await page.goto("/settings");
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Invites" })).toHaveCount(0);

  const other = adminDb.collection("households").doc();
  await other.set({ name: "Cottage", createdBy: "someone", periodDays: 7, budgetCents: 0, currency: "CAD", timezone: "America/Toronto", defaultServings: 2, plannedMealTypes: ["dinner"], pcxStoreId: "x", currentPeriodId: null, settings: {} });
  await adminDb.doc(`households/${other.id}/invites/${household.uid}`).set({ inviteeUid: household.uid, householdName: "Cottage", invitedBy: "someone", invitedByName: "Kim", createdAt: FieldValue.serverTimestamp() });
  const banner = page.getByRole("region", { name: "Invites" });
  await expect(banner).toContainText("Cottage");
  await expect(banner).toContainText("Kim invited you");

  // Settings → Account lists it in a card instead of the banner.
  await page.goto("/settings/account");
  await expect(page.getByRole("list", { name: "Household invites" })).toContainText("Cottage");
  await expect(page.getByRole("region", { name: "Invites" })).toHaveCount(0);

  // Declined: gone from Settings.
  await page.getByRole("button", { name: "Decline the invite to Cottage" }).click();
  await expect(page.getByText("No open invites.")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Invites" })).toHaveCount(0);
});

test("Instructions for ChatGPT can be set in Settings → Stores and show on the Grocery page, and back (R11.19, R7.5)", { tag: ["@R11.19", "@R7.5"] }, async ({ page, household }) => {
  const r = await makePlanRecipe("ChatGPT settings");
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [r.id]);
  await page.goto("/settings/stores");
  const box = page.getByTestId("chatgpt-card").getByLabel("Instructions for ChatGPT");
  await box.fill("Prefer No Name brands.");
  await box.blur();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.chatgptInstructions).toBe("Prefer No Name brands.");

  await page.goto("/grocery");
  await expect(page.getByText("Building the list…")).toHaveCount(0, { timeout: 20_000 });
  const onGrocery = page.getByTestId("store-pcExpress").getByLabel("Instructions for ChatGPT");
  await expect(onGrocery).toHaveValue("Prefer No Name brands.");
  await onGrocery.fill("Prefer President's Choice.");
  await onGrocery.blur();
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).data()?.settings?.chatgptInstructions).toBe("Prefer President's Choice.");

  await page.goto("/settings/stores");
  await expect(page.getByTestId("chatgpt-card").getByLabel("Instructions for ChatGPT")).toHaveValue("Prefer President's Choice.");
});
