// history.spec.ts (TECHNICAL_SPECS §14.1): the cooked list (date, meal, ratings, who cooked, notes, deviations, deleted
// titles), the shared filter and sort, and the stats: most cooked, average rating by cuisine, spend per period.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../fixtures/admin";
import { seedRecipeId } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { seedPeriod } from "../pages/plan";

const DAY = 86_400_000;

async function seedEvent(hid: string, id: string, o: { recipeIds: string[]; titles: string[]; daysAgo: number; cookedBy: string; ratings?: Array<[string, number]>; used?: Array<[string, number]>; defaults?: Array<[string, number]>; note?: string; reviewStatus?: "pending" | "done" }) {
  const used = (o.used ?? []).map(([ingredientId, canonicalAmount]) => ({ ingredientId, canonicalAmount }));
  await adminDb.doc(`households/${hid}/cookEvents/${id}`).set({
    recipeIds: o.recipeIds,
    titles: o.titles,
    title: o.titles.join(" + "),
    cookedBy: o.cookedBy,
    cookedAt: Timestamp.fromMillis(Date.now() - o.daysAgo * DAY),
    used,
    defaults: (o.defaults ?? o.used ?? []).map(([ingredientId, canonicalAmount]) => ({ ingredientId, canonicalAmount })),
    leftoverPortions: 0,
    reviewStatus: o.reviewStatus ?? "done",
    ratedBy: (o.ratings ?? []).map(([uid]) => uid),
    ...(o.note ? { note: o.note } : {}),
  });
  for (const [uid, score] of o.ratings ?? []) {
    for (const rid of o.recipeIds) await adminDb.doc(`households/${hid}/ratings/${id}_${uid}_recipe_${rid}`).set({ uid, cookEventId: id, targetType: "recipe", targetId: rid, score, createdAt: FieldValue.serverTimestamp() });
  }
}

test("lists everything cooked with date, ratings, who cooked, notes, and deviations; deleted recipes keep their title (R10.1)", { tag: ["@R10.1", "@smoke"] }, async ({ page, household }) => {
  const garlic = await seedRecipeId("Garlic Rice and Chicken");
  await seedEvent(household.hid, "e1", { recipeIds: [garlic], titles: ["Garlic Rice and Chicken"], daysAgo: 1, cookedBy: household.uid, ratings: [[household.uid, 9], ["sam", 7]], used: [["chicken-breast", 700]], defaults: [["chicken-breast", 600]], note: "Needed more garlic." });
  await seedEvent(household.hid, "e2", { recipeIds: ["gone-recipe"], titles: ["Grandma's soup"], daysAgo: 3, cookedBy: household.uid, ratings: [[household.uid, 8]] });
  await page.goto("/history");
  const rows = page.getByTestId("history-row");
  await expect(rows).toHaveCount(2);
  const first = rows.first();
  await expect(first).toContainText("Garlic Rice and Chicken");
  await expect(first).toContainText(`COOKED BY ${household.displayName.toUpperCase()}`, { ignoreCase: true });
  await expect(first.getByLabel("Average rating 8.0")).toBeVisible();
  await expect(first).toContainText(/\+100 g chicken breast/i); // deviation from the recipe
  await expect(first).toContainText("“Needed more garlic.”");
  await expect(rows.nth(1)).toContainText("Grandma's soup (deleted)");
});

test("the shared filter and sort apply to history (R10.2, R4.7)", { tag: ["@R10.2", "@R4.7"] }, async ({ page, household }) => {
  const a = await seedRecipeId("Garlic Rice and Chicken");
  const b = await seedRecipeId("Easy Flatbread No Yeast");
  await seedEvent(household.hid, "f1", { recipeIds: [a], titles: ["Garlic Rice and Chicken"], daysAgo: 2, cookedBy: household.uid, ratings: [[household.uid, 6]] });
  await seedEvent(household.hid, "f2", { recipeIds: [b], titles: ["Easy Flatbread No Yeast"], daysAgo: 1, cookedBy: household.uid, ratings: [[household.uid, 9]] });
  await page.goto("/history");
  const rows = page.getByTestId("history-row");
  await expect(rows.first()).toContainText("Easy Flatbread"); // newest first
  await page.getByRole("searchbox", { name: "Search what you cooked…" }).fill("garlic");
  await expect(rows).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search what you cooked…" }).fill("");
  await expect(rows).toHaveCount(2);
  await page.goto("/history?sort=rating");
  await expect(rows.first()).toContainText("Easy Flatbread");
  await page.goto("/history?minRating=8");
  await expect(rows).toHaveCount(1);
});

test("stats: most cooked, average rating by cuisine, spend per period from received lists (R10.3)", { tag: ["@R10.3"] }, async ({ page, household }) => {
  const a = await seedRecipeId("Garlic Rice and Chicken");
  const pid = await seedPeriod(household.hid, { budgetCents: 10000 });
  await seedEvent(household.hid, "g1", { recipeIds: [a], titles: ["Garlic Rice and Chicken"], daysAgo: 1, cookedBy: household.uid, ratings: [[household.uid, 8]] });
  await seedEvent(household.hid, "g2", { recipeIds: [a], titles: ["Garlic Rice and Chicken"], daysAgo: 0, cookedBy: household.uid, ratings: [[household.uid, 10]] });
  await adminDb.doc(`households/${household.hid}/groceryLists/r1`).set({ periodId: pid, status: "received", createdAt: new Date(), receivedAt: new Date(), receivedCents: 4210, items: {} });
  await adminDb.doc(`households/${household.hid}/groceryLists/r2`).set({ periodId: pid, status: "received", createdAt: new Date(), receivedAt: new Date(), receivedCents: 1500, items: {} });
  await page.goto("/history");
  await expect(page.getByTestId("stat-most-cooked")).toContainText("Garlic Rice and Chicken");
  await expect(page.getByTestId("stat-most-cooked")).toContainText("2×");
  await expect(page.getByTestId("stat-cuisine")).toContainText(/9\.0/); // (8 + 10) / 2 for its cuisine
  await expect(page.getByTestId("stat-spend")).toContainText("$57.10");
  await expect(page.getByTestId("stat-spend")).toContainText("budget $100.00");
});
