// M0 part of households.spec.ts: create the first household (timezone, servings, meal types) and the 3-household
// limit (R2.3), which the rules enforce.
import { adminDb, allowlist, uidFor } from "../fixtures/admin";
import { expect, signInWithEmailLink, test } from "../fixtures/test";

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

  // Lands on an empty Recipes page (R12 landing: no plan yet).
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  await expect(page.getByText("No recipes yet.")).toBeVisible();
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
