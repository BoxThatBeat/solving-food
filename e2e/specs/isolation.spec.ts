// isolation.spec.ts (TECHNICAL_SPECS §14.1, PRD R2.8, NFR4): two people in two households. Neither sees the other's
// supply, plan, history, or ratings, in the UI or through direct Firestore reads from the page (the rules refuse them,
// collection-group queries included). Someone in both households sees each one's data only while it's active.
import type { Page } from "@playwright/test";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, allowlist, seedHousehold, seedProfile, uidFor } from "../fixtures/admin";
import { seedRecipeId } from "../fixtures/recipes";
import { expect, signInWithEmailLink, test } from "../fixtures/test";
import { seedPeriod, seedPlanItem } from "../pages/plan";
import { seedSupply } from "../pages/supply";

type Probe = { label: string; kind: "doc" | "col" | "cg"; path: string; where?: [string, string] };

/** Runs each read with the page's own Firestore SDK (signed in as that person) and reports "ok" or the error code. */
async function probe(page: Page, probes: Probe[]): Promise<Record<string, string>> {
  await page.waitForFunction(() => "__sfTest" in window);
  return page.evaluate(async (list) => {
    type F = (...a: unknown[]) => unknown;
    const { db, fs } = (window as unknown as { __sfTest: { db: unknown; fs: Record<string, F> } }).__sfTest;
    const out: Record<string, string> = {};
    for (const p of list) {
      try {
        if (p.kind === "doc") await (fs.getDocFromServer as F)((fs.doc as F)(db, p.path));
        else if (p.kind === "col") await (fs.getDocsFromServer as F)((fs.collection as F)(db, p.path));
        else {
          const cg = (fs.collectionGroup as F)(db, p.path);
          await (fs.getDocsFromServer as F)(p.where ? (fs.query as F)(cg, (fs.where as F)(p.where[0], "==", p.where[1])) : cg);
        }
        out[p.label] = "ok";
      } catch (e) {
        out[p.label] = (e as { code?: string }).code ?? String(e);
      }
    }
    return out;
  }, probes);
}

async function seedHouseholdData(hid: string, uid: string, title: string, ingredientId: string) {
  const pid = await seedPeriod(hid);
  const recipeId = await seedRecipeId(title);
  await seedPlanItem(hid, pid, [recipeId]);
  await seedSupply(hid, ingredientId, [{ amount: 500, location: "fridge", expiresInDays: 10 }]);
  await adminDb.doc(`households/${hid}/cookEvents/ev-${hid}`).set({
    recipeIds: [recipeId], titles: [title], title, cookedBy: uid, cookedAt: FieldValue.serverTimestamp(), used: [], defaults: [],
    leftoverPortions: 0, reviewStatus: "done", ratedBy: [uid],
  });
  await adminDb.doc(`households/${hid}/ratings/ev-${hid}_${uid}_recipe_${recipeId}`).set({ uid, cookEventId: `ev-${hid}`, targetType: "recipe", targetId: recipeId, score: 9, createdAt: FieldValue.serverTimestamp() });
  await adminDb.doc(`households/${hid}/stats/recipe_${recipeId}`).set({ timesCooked: 1, ratingSum: 9, ratingCount: 1 });
  await adminDb.doc(`households/${hid}/invites/someone`).set({ inviteeUid: "someone", householdName: "x", invitedBy: uid, createdAt: FieldValue.serverTimestamp() });
}

function probesFor(hid: string, otherUid: string): Probe[] {
  const h = `households/${hid}`;
  return [
    { label: "household", kind: "doc", path: h },
    { label: "members", kind: "col", path: `${h}/members` },
    { label: "invites", kind: "col", path: `${h}/invites` },
    { label: "supply", kind: "col", path: `${h}/supply` },
    { label: "supply doc", kind: "doc", path: `${h}/supply/chicken-thigh` },
    { label: "supply history", kind: "col", path: `${h}/supply/chicken-thigh/transactions` },
    { label: "plan", kind: "col", path: `${h}/planItems` },
    { label: "periods", kind: "col", path: `${h}/periods` },
    { label: "history", kind: "col", path: `${h}/cookEvents` },
    { label: "ratings", kind: "col", path: `${h}/ratings` },
    { label: "stats", kind: "col", path: `${h}/stats` },
    { label: "grocery", kind: "col", path: `${h}/groceryLists` },
    { label: "commands", kind: "col", path: `${h}/commands` },
    { label: "all ratings", kind: "cg", path: "ratings" },
    { label: "all supply", kind: "cg", path: "supply" },
    { label: "all history", kind: "cg", path: "transactions" },
    { label: "their memberships", kind: "cg", path: "members", where: ["uid", otherUid] },
    { label: "their invites", kind: "cg", path: "invites", where: ["inviteeUid", "someone"] },
  ];
}

test("two households can't see each other's supply, plan, history, or ratings, in the UI or by direct reads", { tag: ["@R2.8", "@NFR4"] }, async ({ page, household, browser, uniqueEmail }) => {
  // Household A: me (the fixture). Household B: Bea, on her own device.
  const email = uniqueEmail("bea");
  await allowlist(email);
  const ctx = await browser.newContext();
  const bea = await ctx.newPage();
  await signInWithEmailLink(bea, email);
  await expect(bea).toHaveURL(/\/welcome$/);
  const beaUid = (await uidFor(email))!;
  await seedProfile(beaUid, email, "Bea");
  const hB = await seedHousehold(beaUid, "Bea", "Bea's Flat");
  await expect(bea).toHaveURL(/\/recipes$/, { timeout: 20_000 });

  await seedHouseholdData(household.hid, household.uid, "Baked Feta Pasta", "chicken-thigh");
  await seedHouseholdData(hB.hid, beaUid, "Breakfast Biscuits", "chicken-thigh");

  // Each sees only their own, through the UI.
  for (const [p, mine, theirs] of [
    [page, "Baked Feta Pasta", "Breakfast Biscuits"],
    [bea, "Breakfast Biscuits", "Baked Feta Pasta"],
  ] as const) {
    await p.goto("/plan");
    await expect(p.getByTestId("plan-item").filter({ hasText: mine })).toBeVisible();
    await expect(p.getByTestId("plan-item").filter({ hasText: theirs })).toHaveCount(0);
    await p.goto("/history");
    await expect(p.getByText(mine).first()).toBeVisible();
    await expect(p.getByText(theirs)).toHaveCount(0);
    await p.goto("/supply");
    await expect(p.getByRole("list", { name: "Supply" }).getByRole("listitem")).toHaveCount(1);
  }

  // Direct reads of the other household from each page: every one refused.
  const fromA = await probe(page, probesFor(hB.hid, beaUid));
  const fromB = await probe(bea, probesFor(household.hid, household.uid));
  for (const r of [fromA, fromB]) for (const [label, code] of Object.entries(r)) expect(code, label).toBe("permission-denied");
  // …while the same reads of one's own household work (the probe itself is sound).
  const own = await probe(page, probesFor(household.hid, household.uid).filter((p) => p.kind !== "cg"));
  for (const [label, code] of Object.entries(own)) expect(code, label).toBe("ok");
  await ctx.close();
});

test("someone in two households sees each one's data only while it's the active one", { tag: ["@R2.8", "@R2.2"] }, async ({ page, household }) => {
  await seedHouseholdData(household.hid, household.uid, "Baked Feta Pasta", "chicken-thigh");
  const cottage = adminDb.collection("households").doc();
  await cottage.set({
    name: "Cottage", createdBy: household.uid, periodDays: 7, budgetCents: 20000, currency: "CAD", timezone: "America/Toronto",
    defaultServings: 4, plannedMealTypes: ["dinner"], pcxStoreId: "loblaws-greenbank-road", currentPeriodId: null,
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} }, createdAt: FieldValue.serverTimestamp(),
  });
  await adminDb.doc(`households/${cottage.id}/members/${household.uid}`).set({ uid: household.uid, displayName: "Aaron", joinedAt: FieldValue.serverTimestamp() });

  await page.goto("/supply");
  await expect(page.getByRole("list", { name: "Supply" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: /Household: Silbrass Pvt/ }).first().click();
  await page.getByRole("dialog", { name: "Households" }).getByRole("button", { name: /Cottage/ }).click();
  await expect(page.getByRole("button", { name: /Household: Cottage/ }).first()).toBeVisible();
  await expect(page.getByText("Supply starts empty.")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByText("Nothing cooked yet in this household.")).toBeVisible();
  await page.goto("/plan");
  await expect(page.getByTestId("plan-item")).toHaveCount(0);
});
