// data-transfer.spec.ts (TECHNICAL_SPECS §14.1, PRD R11.10): Download produces a valid zip with everything the household
// holds; importing it into another household after the replace warning reproduces supply, plan, history, and
// favourites; members are unchanged; an invalid file is rejected (in the page, and with an error banner from the
// function).
import { readFileSync } from "node:fs";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { readExportZip } from "../../packages/core/src/index";
import { addMember, adminDb, allowlist, seedProfile } from "../fixtures/admin";
import { bucket, seedRecipeId } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { seedPeriod, seedPlanItem } from "../pages/plan";
import { seedOrderedList, seedSupply, groceryLine } from "../pages/supply";

test("download the household's data, then import it into another household after the replace warning", { tag: ["@R11.10", "@smoke"] }, async ({ page, household }, testInfo) => {
  // Household A (Silbrass Pvt) with a plan, supply with history, a cooked meal with a rating, a favourite, a note, and
  // a received grocery list.
  const pid = await seedPeriod(household.hid);
  const feta = await seedRecipeId("Baked Feta Pasta");
  const biscuits = await seedRecipeId("Breakfast Biscuits");
  await seedPlanItem(household.hid, pid, [feta]);
  await seedSupply(household.hid, "chicken-thigh", [{ amount: 600, location: "fridge", expiresInDays: 3 }, { amount: 1500, frozen: { frozenDaysAgo: 1, expiresInDays: 170 } }]);
  await adminDb.doc(`households/${household.hid}/favourites/recipe_${biscuits}`).set({ type: "recipe", targetId: biscuits });
  await adminDb.doc(`households/${household.hid}/notes/${feta}`).set({ text: "Double the feta", updatedBy: household.uid, updatedAt: FieldValue.serverTimestamp() });
  await adminDb.doc(`households/${household.hid}/cookEvents/ev1`).set({
    recipeIds: [biscuits], titles: ["Breakfast Biscuits"], title: "Breakfast Biscuits", cookedBy: household.uid, cookedAt: Timestamp.fromMillis(Date.now() - 86_400_000),
    used: [], defaults: [], leftoverPortions: 0, reviewStatus: "done", ratedBy: [household.uid],
  });
  await adminDb.doc(`households/${household.hid}/ratings/ev1_${household.uid}_recipe_${biscuits}`).set({ uid: household.uid, cookEventId: "ev1", targetType: "recipe", targetId: biscuits, score: 8, createdAt: FieldValue.serverTimestamp() });
  const listId = await seedOrderedList(household.hid, pid, { a: groceryLine({ ingredientId: "chicken-thigh", amount: 600, productName: "Thighs", storeId: "pc-express", estPriceCents: 900 }) });
  await adminDb.doc(`households/${household.hid}/groceryLists/${listId}`).update({ status: "received", receivedAt: FieldValue.serverTimestamp(), receivedBy: household.uid, receivedCents: 900 });
  await adminDb.doc(`households/${household.hid}`).update({ budgetCents: 15500, "settings.tools": ["Wok"] });

  await page.goto("/settings/data");
  await expect(page.getByTestId("read-estimate")).toHaveText(/About \d+ Firestore reads/);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download household data" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^solving-food-silbrass-pvt-\d{4}-\d{2}-\d{2}\.zip$/);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const parsed = readExportZip(new Uint8Array(readFileSync(file)));
  expect(parsed.export.household.name).toBe("Silbrass Pvt");
  expect(parsed.export.collections.planItems).toHaveLength(1);
  expect(parsed.export.supply.map((s) => [s.id, s.data.canonicalAmount, s.transactions.length])).toEqual([["chicken-thigh", 2100, 2]]);
  expect(parsed.export.collections.cookEvents.map((e) => e.id)).toEqual(["ev1"]);
  expect(parsed.export.collections.groceryLists[0]!.data.status).toBe("received");
  expect(parsed.export.recipes.map((r) => r.title).sort()).toEqual(["Baked Feta Pasta", "Breakfast Biscuits"]);
  expect([...parsed.cook.keys()].every((k) => k.endsWith(".cook"))).toBe(true);

  // Household B (Cottage): me and Pat, with a plan item of its own that the import replaces.
  const cottage = adminDb.collection("households").doc();
  await cottage.set({
    name: "Cottage", createdBy: household.uid, periodDays: 7, budgetCents: 20000, currency: "CAD", timezone: "America/Toronto", defaultServings: 2,
    plannedMealTypes: ["dinner"], pcxStoreId: "loblaws-greenbank-road", currentPeriodId: null,
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} }, createdAt: FieldValue.serverTimestamp(),
  });
  await addMember(cottage.id, household.uid, "Aaron");
  const patEmail = `pat-${cottage.id.toLowerCase()}@example.com`;
  await allowlist(patEmail);
  await seedProfile(`pat-${cottage.id}`, patEmail, "Pat");
  await addMember(cottage.id, `pat-${cottage.id}`, "Pat");
  const cottagePid = await seedPeriod(cottage.id);
  await seedPlanItem(cottage.id, cottagePid, [biscuits], { mealType: "lunch" });
  await adminDb.doc(`users/${household.uid}`).update({ activeHouseholdId: cottage.id });
  await expect(page.getByRole("button", { name: /Household: Cottage/ }).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/settings/data");
  await page.getByLabel("Export file (.zip)").setInputFiles(file);
  const summary = page.getByRole("region", { name: "File summary" });
  await expect(summary).toContainText("Silbrass Pvt · exported");
  await expect(summary.getByRole("definition").nth(0)).toHaveText("1"); // plan items
  await expect(summary).toContainText("Supply items");
  await page.getByRole("button", { name: "Import into Cottage" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace Cottage's data?" });
  await expect(dialog).toContainText("Members stay as they are.");
  await dialog.getByRole("button", { name: "Replace data" }).click();
  await expect(page.getByText(/^Imported\. 1 plan items, 1 supply items, 1 cooked meals\.$/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Household data imported/)).toBeVisible();

  // Cottage now has Silbrass Pvt's plan, supply (with its history), history, and favourites; its own plan is gone.
  await page.goto("/plan");
  await expect(page.getByTestId("plan-item").filter({ hasText: "Baked Feta Pasta" })).toBeVisible();
  await expect(page.getByTestId("plan-item").filter({ hasText: "Breakfast Biscuits" })).toHaveCount(0);
  await page.goto("/supply");
  await expect(page.getByRole("list", { name: "Supply" })).toContainText(/chicken thigh/i);
  await page.goto("/history");
  await expect(page.getByText("Breakfast Biscuits").first()).toBeVisible();
  const c = (path: string) => adminDb.collection(`households/${cottage.id}/${path}`).get();
  expect((await c("favourites")).docs.map((d) => d.id)).toEqual([`recipe_${biscuits}`]);
  expect((await c("supply/chicken-thigh/transactions")).size).toBe(2);
  const hb = (await adminDb.doc(`households/${cottage.id}`).get()).data()!;
  expect(hb).toMatchObject({ name: "Cottage", budgetCents: 15500, currentPeriodId: pid });
  expect(hb.settings.tools).toEqual(["Wok"]);
  // Members unchanged.
  expect((await c("members")).docs.map((d) => d.id).sort()).toEqual([household.uid, `pat-${cottage.id}`].sort());
  // The original household still has its own data.
  expect((await adminDb.collection(`households/${household.hid}/planItems`).get()).size).toBe(1);
});

test("an invalid file is rejected before upload, and a bad upload fails with an error banner", { tag: ["@R11.10"] }, async ({ page, household }) => {
  await page.goto("/settings/data");
  await page.getByLabel("Export file (.zip)").setInputFiles({ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("these are not the files you are looking for") });
  await expect(page.getByRole("alert")).toHaveText("That isn't a Solving Food export (not a zip file).");
  await expect(page.getByRole("button", { name: /Import into/ })).toHaveCount(0);

  // A file that reaches the function and fails there (e.g. tampered with after the check): the function reports it.
  const path = `imports/${household.hid}/tampered.zip`;
  await bucket().file(path).save(Buffer.from("PK\u0003\u0004 broken"), { contentType: "application/zip" });
  await adminDb.collection(`households/${household.hid}/commands`).add({ type: "importHousehold", payload: { path }, uid: household.uid, createdAt: FieldValue.serverTimestamp(), status: "pending" });
  await expect(page.getByText(/Couldn't import household data: That isn't a Solving Food export/)).toBeVisible({ timeout: 30_000 });
});
