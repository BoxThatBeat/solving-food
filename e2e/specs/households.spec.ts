// households.spec.ts (TECHNICAL_SPECS §14.1): create the first household (timezone, servings, meal types) and the
// 3-household limit (R2.3, M0); invites by email and by name, accept and decline, switching, removing, leaving with the
// last-member warning, and creating more households from the sheet (M4).
import type { Browser, Page } from "@playwright/test";
import { adminDb, allowlist, seedHousehold, seedProfile, uidFor } from "../fixtures/admin";
import { seedRecipeId } from "../fixtures/recipes";
import { expect, signInWithEmailLink, test } from "../fixtures/test";
import { seedPeriod, seedPlanItem } from "../pages/plan";

test("create the first household with timezone, default servings, and meal types", { tag: ["@R2.3", "@smoke"] }, async ({ page, uniqueEmail }) => {
  const email = uniqueEmail("creator");
  await allowlist(email);
  await signInWithEmailLink(page, email);
  await page.getByLabel("Display name").fill("Aaron");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByLabel("Household name")).toHaveValue("Home");
  await expect(page.getByLabel("Timezone")).toHaveValue("America/Toronto"); // detected from the browser
  await expect(page.getByRole("group", { name: "Default servings" })).toContainText("4");
  for (const m of ["Breakfast", "Lunch", "Dinner"]) {
    await expect(page.getByRole("button", { name: m })).toHaveAttribute("aria-pressed", "true");
  }

  await page.getByLabel("Household name").fill("Silbrass Pvt");
  await page.getByLabel("Timezone").selectOption("America/Vancouver");
  await page.getByRole("button", { name: "Fewer servings" }).click();
  await page.getByRole("button", { name: "Fewer servings" }).click();
  await page.getByRole("button", { name: "Breakfast" }).click();
  await page.getByRole("button", { name: "Create household" }).click();

  // Lands on the Recipes page (R12 landing: no plan yet), which shows the shared library.
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recipes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first()).toBeVisible();

  const uid = (await uidFor(email))!;
  const user = (await adminDb.doc(`users/${uid}`).get()).data()!;
  expect(user.householdsCreated).toBe(1);
  const hh = (await adminDb.doc(`households/${user.activeHouseholdId}`).get()).data()!;
  expect(hh).toMatchObject({
    name: "Silbrass Pvt",
    createdBy: uid,
    timezone: "America/Vancouver",
    defaultServings: 2,
    plannedMealTypes: ["lunch", "dinner"],
    currency: "CAD",
    periodDays: 7,
    budgetCents: 20000,
  });
  const member = (await adminDb.doc(`households/${user.activeHouseholdId}/members/${uid}`).get()).data()!;
  expect(member).toMatchObject({ uid, displayName: "Aaron" });
});

test("at least one meal type must be planned", async ({ page, uniqueEmail }) => {
  const email = uniqueEmail();
  await allowlist(email);
  await signInWithEmailLink(page, email);
  await page.getByLabel("Display name").fill("Aaron");
  await page.getByRole("button", { name: "Continue" }).click();
  for (const m of ["Breakfast", "Lunch", "Dinner"]) await page.getByRole("button", { name: m }).click();
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("alert")).toContainText("Plan at least one meal type");
});

// The UI for more households arrives in M4; the limit itself is in the rules, so prove it from the page with the
// same batch the UI writes (emulator builds expose the Firestore SDK as window.__sfTest).
test("a person can create at most 3 households", { tag: ["@R2.3"] }, async ({ page, household, seed }) => {
  await seed.load("three-households", { uid: household.uid, prefix: household.hid });
  await adminDb.doc(`users/${household.uid}`).update({ householdsCreated: 2 });

  const createFromPage = (hid: string) =>
    page.evaluate(async ({ hid, uid }) => {
      type F = (...a: unknown[]) => unknown;
      type T = { db: unknown; fs: { doc: F; writeBatch: F; serverTimestamp: F; increment: F } };
      const { db, fs } = (window as unknown as { __sfTest: T }).__sfTest;
      const hRef = fs.doc(db, "households", hid);
      const batch = fs.writeBatch(db) as { set: (...a: unknown[]) => void; update: (...a: unknown[]) => void; commit: () => Promise<void> };
      batch.set(hRef, {
        name: "Another", createdBy: uid, periodDays: 7, budgetCents: 20000, currency: "CAD", timezone: "America/Toronto",
        defaultServings: 4, plannedMealTypes: ["dinner"], pcxStoreId: "loblaws-greenbank-road", currentPeriodId: null,
        createdAt: fs.serverTimestamp(),
      });
      batch.set(fs.doc(db, "households", hid, "members", uid), { uid, displayName: "Aaron", joinedAt: fs.serverTimestamp() });
      batch.update(fs.doc(db, "users", uid), { householdsCreated: fs.increment(1), activeHouseholdId: hid });
      try {
        await batch.commit();
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? String(e);
      }
    }, { hid, uid: household.uid });

  await page.waitForFunction(() => "__sfTest" in window);
  expect(await createFromPage(`${household.hid}-third`)).toBe("ok");
  expect(await createFromPage(`${household.hid}-fourth`)).toBe("permission-denied");
  expect((await adminDb.doc(`users/${household.uid}`).get()).data()!.householdsCreated).toBe(3);
  expect((await adminDb.doc(`households/${household.hid}-fourth`).get()).exists).toBe(false);
});

test("the household chip lists my households and switches the active one", async ({ page, household, seed }) => {
  await seed.load("three-households", { uid: household.uid, prefix: household.hid });
  await page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Households" });
  await expect(sheet.getByRole("button", { name: /Cottage/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Parents/ })).toBeVisible();
  await sheet.getByRole("button", { name: /Cottage/ }).click();
  await expect(page.getByRole("button", { name: /Household: Cottage/ }).first()).toBeVisible();
});

// ---------- M4: invites, joining, switching, removing, leaving, creating more (R2.2–R2.6, R2.11, R2.13, R11.8)


/** Another person on their own device, signed in through the real email link; profile seeded unless `onboard` is false. */
async function newDevice(browser: Browser, email: string, displayName: string, opts: { profile?: boolean } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithEmailLink(page, email);
  await expect(page).toHaveURL(/\/welcome$/);
  const uid = (await uidFor(email))!;
  if (opts.profile !== false) await seedProfile(uid, email, displayName);
  return { context, page, uid };
}

async function openMembers(page: Page) {
  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
}

test("invite by email: the newcomer signs up on their phone, sees the invite, joins, and sees the household's plan", { tag: ["@R2.4", "@R11.8", "@R2.6", "@R2.11", "@R2.12"] }, async ({ page, household, browser, uniqueEmail }) => {
  const pid = await seedPeriod(household.hid);
  const feta = await seedRecipeId("Baked Feta Pasta");
  await seedPlanItem(household.hid, pid, [feta]);

  await openMembers(page);
  const spouse = uniqueEmail("spouse");
  await page.getByLabel("Email address").fill(spouse.toUpperCase()); // stored lower-cased
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText(`Invited ${spouse}`)).toBeVisible();
  const pending = page.getByRole("list", { name: "Pending invites" });
  await expect(pending).toContainText(spouse);
  await expect(pending).toContainText("waiting for sign-up");
  // The address is now on the sign-up allowlist, with the invite alongside (R2.12).
  expect((await adminDb.doc(`allowlist/${spouse}`).get()).data()).toMatchObject({ addedBy: household.uid, inviteHouseholdId: household.hid });

  // Their own device: sign in (allowed now), pick a name, and the invite is waiting.
  const sam = await newDevice(browser, spouse, "Sam", { profile: false });
  await sam.page.getByLabel("Display name").fill("Sam");
  await sam.page.getByRole("button", { name: "Continue" }).click();
  await expect(sam.page.getByRole("heading", { name: "Join a household" })).toBeVisible();
  const invites = sam.page.getByRole("list", { name: "Household invites" });
  await expect(invites).toContainText("Silbrass Pvt");
  await expect(invites).toContainText("Aaron invited you");
  await invites.getByRole("button", { name: "Join Silbrass Pvt" }).click();
  await expect(sam.page).toHaveURL(/\/plan$/, { timeout: 20_000 });
  await expect(sam.page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first()).toBeVisible();
  // Same household, same plan, on their own device (R2.6, R2.11).
  await expect(sam.page.getByTestId("plan-item").filter({ hasText: "Baked Feta Pasta" })).toBeVisible();

  // The inviter sees them join live; the invite is gone.
  await expect(page.getByRole("list", { name: "Members" })).toContainText("Sam");
  await expect(pending).not.toContainText(spouse);
  expect((await adminDb.doc(`households/${household.hid}/members/${sam.uid}`).get()).data()).toMatchObject({ uid: sam.uid, displayName: "Sam" });
  expect((await adminDb.doc(`users/${sam.uid}`).get()).data()!.householdsCreated).toBe(0); // joining doesn't count (R2.3)
  await sam.context.close();
});

test("invite by name: someone with an account gets a banner on any page, joins, and switches between households", { tag: ["@R2.4", "@R2.2", "@R11.8"] }, async ({ page, household, browser, uniqueEmail }) => {
  const email = uniqueEmail("kim");
  await allowlist(email);
  const kim = await newDevice(browser, email, "Kimberly Quinn");
  await seedHousehold(kim.uid, "Kimberly Quinn", "Quinn Flat");
  await expect(kim.page).toHaveURL(/\/recipes$/, { timeout: 20_000 });

  await openMembers(page);
  await page.getByLabel("Search people by name").fill("kimberly q");
  const people = page.getByRole("list", { name: "People" });
  await people.getByRole("button", { name: "Invite Kimberly Quinn" }).click();
  await expect(page.getByText("Invite sent to Kimberly Quinn.")).toBeVisible();
  await expect(people.getByRole("button", { name: "Kimberly Quinn invited" })).toBeDisabled();
  await expect(page.getByRole("list", { name: "Pending invites" })).toContainText("invited by name");

  // Kim is on Recipes in her own household; the banner appears there without a reload.
  const banner = kim.page.getByRole("region", { name: "Invites" });
  await expect(banner).toContainText("Silbrass Pvt");
  await banner.getByRole("button", { name: "Join Silbrass Pvt" }).click();
  await expect(kim.page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(banner).toHaveCount(0);

  // Two households now (R2.2): switch back and forth from the household sheet.
  await kim.page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first().click();
  const sheet = kim.page.getByRole("dialog", { name: "Households" });
  await expect(sheet.getByRole("button", { name: /Silbrass Pvt/ })).toContainText("2 members");
  await sheet.getByRole("button", { name: /Quinn Flat/ }).click();
  await expect(kim.page.getByRole("button", { name: /Household: Quinn Flat/ }).first()).toBeVisible();
  await kim.context.close();
});

test("an invite can be declined, or cancelled by the household", { tag: ["@R2.4"] }, async ({ page, household, browser, uniqueEmail }) => {
  const email = uniqueEmail("dee");
  await allowlist(email);
  const dee = await newDevice(browser, email, "Deedee");
  await expect(dee.page).toHaveURL(/\/welcome\/household$/);
  await openMembers(page);
  await page.getByLabel("Search people by name").fill("Deedee");
  await page.getByRole("button", { name: "Invite Deedee" }).click();
  await page.getByLabel("Email address").fill("someone.new@example.com");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const pending = page.getByRole("list", { name: "Pending invites" });
  await expect(pending.getByRole("listitem")).toHaveCount(2);

  await dee.page.getByRole("button", { name: "Decline the invite to Silbrass Pvt" }).click();
  await expect(dee.page.getByRole("heading", { name: "Create your household" })).toBeVisible();
  await expect(pending.getByRole("listitem")).toHaveCount(1);
  await pending.getByRole("button", { name: "Cancel the invite for someone.new@example.com" }).click();
  await expect(pending.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText("Nobody is waiting to join.")).toBeVisible();
  expect((await adminDb.collection(`households/${household.hid}/invites`).get()).size).toBe(0);
  await dee.context.close();
});

test("any member removes another; it takes effect on their device at once", { tag: ["@R2.5", "@R11.8"] }, async ({ page, household, secondMember }) => {
  // Sam also has a household of their own, but is looking at Silbrass Pvt.
  await seedHousehold(secondMember.user.uid, "Sam", "Sam's Place");
  await adminDb.doc(`users/${secondMember.user.uid}`).update({ activeHouseholdId: household.hid });
  const sam = secondMember.page;
  await sam.goto("/supply");
  await expect(sam.getByRole("button", { name: /Household: Silbrass Pvt/ }).first()).toBeVisible({ timeout: 20_000 });

  // No roles: Sam could remove me just as well; here I remove Sam.
  await openMembers(page);
  const members = page.getByRole("list", { name: "Members" });
  await expect(members.getByRole("button", { name: "Remove Aaron" })).toHaveCount(0); // that's me: I leave instead
  await members.getByRole("button", { name: "Remove Sam" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Remove Sam?" });
  await expect(dialog).toContainText("lose access");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(members).not.toContainText("Sam");

  // Sam's app drops the household live and switches to their own one, with a notice.
  await expect(sam.getByRole("button", { name: /Household: Sam's Place/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(sam.getByText("You're no longer a member of Silbrass Pvt.")).toBeVisible();
  expect((await adminDb.doc(`households/${household.hid}/members/${secondMember.user.uid}`).get()).exists).toBe(false);
});

test("leaving: a member just leaves; the last member is warned it deletes everything, and the household and its count are gone", { tag: ["@R2.13", "@R11.8", "@R2.3"] }, async ({ page, household, secondMember }) => {
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [await seedRecipeId("Baked Feta Pasta")]);
  const sam = secondMember.page;
  await openMembers(sam);
  await sam.getByRole("button", { name: "Leave this household" }).click();
  const samDialog = sam.getByRole("alertdialog", { name: "Leave Silbrass Pvt?" });
  await expect(samDialog).toContainText("Anyone still in it can invite you back.");
  await samDialog.getByRole("button", { name: "Leave", exact: true }).click();
  // Sam had no other household: back to joining or creating one.
  await expect(sam).toHaveURL(/\/welcome\/household$/, { timeout: 20_000 });
  await expect(sam.getByRole("heading", { name: "Create your household" })).toBeVisible();

  // I'm the last member now.
  await openMembers(page);
  await expect(page.getByRole("list", { name: "Members" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Leave this household" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete Silbrass Pvt?" });
  await expect(dialog).toContainText("deletes the household and all of its data");
  await expect(dialog).toContainText("Recipes and meals in the shared library stay.");
  await expect(dialog.getByRole("link", { name: "Download its data first" })).toBeVisible();
  await dialog.getByRole("button", { name: "Leave and delete" }).click();
  await expect(page).toHaveURL(/\/welcome\/household$/, { timeout: 20_000 });

  // The cleanup function deletes the household and everything in it, and it stops counting toward my 3 (R2.3).
  await expect.poll(async () => (await adminDb.doc(`households/${household.hid}`).get()).exists, { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => (await adminDb.collection(`households/${household.hid}/planItems`).get()).size, { timeout: 30_000 }).toBe(0);
  await expect.poll(async () => (await adminDb.doc(`users/${household.uid}`).get()).data()!.householdsCreated, { timeout: 30_000 }).toBe(0);
});

test("create another household from the household sheet; at 3 created the sheet says so", { tag: ["@R2.2", "@R2.3"] }, async ({ page, household }) => {
  await page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Households" });
  await sheet.getByRole("link", { name: "+ New household (1 of 3 created)" }).click();
  await expect(page.getByRole("heading", { name: "Create a household" })).toBeVisible();
  await page.getByLabel("Household name").fill("Cottage");
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("button", { name: /Household: Cottage/ }).first()).toBeVisible({ timeout: 20_000 });
  expect((await adminDb.doc(`users/${household.uid}`).get()).data()!.householdsCreated).toBe(2);

  await page.getByRole("button", { name: /Household: Cottage/ }).first().click();
  await expect(sheet.getByRole("button", { name: /Silbrass Pvt/ })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "+ New household (2 of 3 created)" })).toBeVisible();
  await page.keyboard.press("Escape");

  await adminDb.doc(`users/${household.uid}`).update({ householdsCreated: 3 });
  await page.getByRole("button", { name: /Household: Cottage/ }).first().click();
  await expect(sheet.getByRole("note")).toContainText("3 of 3 households created");
  await expect(sheet.getByRole("note")).toContainText("stops counting when it's deleted");
  await page.keyboard.press("Escape");
  await page.goto("/welcome/household");
  await expect(page.getByRole("note")).toContainText("You've created 3 of 3 households");
  await expect(page.getByRole("button", { name: "Create household" })).toBeDisabled();
});
