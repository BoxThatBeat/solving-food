// history.spec.ts (TECHNICAL_SPECS §14.1): the cooked list (date, meal, ratings, who cooked, notes, deviations, deleted
// titles), the shared filter and sort, and the stats: most cooked, average rating by cuisine, spend per period.
// M27: Prices, this week's biggest moves against usual (R10.4).
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../fixtures/admin";
import { seedRecipeId } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { seedPeriod } from "../pages/plan";
import { ownPcxStore, seedPriceHistory } from "../pages/prices";

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
  await expect(first).toContainText(`Cooked by ${household.displayName}`);
  await expect(first.getByLabel("Average rating 8.0")).toBeVisible();
  await expect(first).toContainText(/\+100 g chicken breast/i); // deviation from the recipe
  await expect(first).toContainText("“Needed more garlic.”");
  await expect(rows.nth(1)).toContainText("Grandma's soup (deleted)");
});

test("history loads the newest 100 meals; Show more adds the rest (R10.1, M23)", { tag: ["@R10.1"] }, async ({ page, household }) => {
  const batch = adminDb.batch();
  for (let i = 0; i < 103; i++) {
    batch.set(adminDb.doc(`households/${household.hid}/cookEvents/m${String(i).padStart(3, "0")}`), {
      recipeIds: ["gone-recipe"],
      titles: [`Meal ${i}`],
      title: `Meal ${i}`,
      cookedBy: household.uid,
      cookedAt: Timestamp.fromMillis(Date.now() - (i + 1) * 3600_000),
      used: [],
      defaults: [],
      leftoverPortions: 0,
      reviewStatus: "done",
      ratedBy: [household.uid],
    });
  }
  await batch.commit();
  await page.goto("/history");
  const rows = page.getByTestId("history-row");
  await expect(rows).toHaveCount(100);
  await expect(rows.first()).toContainText("Meal 0 (deleted)");
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(103);
  await expect(rows.last()).toContainText("Meal 102 (deleted)");
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
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
  // M24: with nothing to show, each stat says what will appear there (not a bare "Nothing yet." while loading).
  await page.goto("/history");
  await expect(page.getByTestId("history-count")).toHaveText(/^0 entries/);
  await expect(page.getByTestId("stat-most-cooked").getByTestId("stat-empty")).toContainText("cook");
  await expect(page.getByTestId("stat-cuisine").getByTestId("stat-empty")).toContainText("Rate a meal");
  await expect(page.getByTestId("stat-spend").getByTestId("stat-empty")).toContainText("received");
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

test("Prices: this week's biggest moves against the usual price, up and down; nothing yet without history (R10.4)", { tag: ["@R10.4"] }, async ({ page, household }) => {
  await ownPcxStore(household.hid);
  await seedPeriod(household.hid);
  await page.goto("/history");
  await expect(page.getByTestId("stat-prices").getByTestId("stat-empty")).toContainText("Settings → Brands", { timeout: 20_000 });
  // Rice up 30 % this week, chicken down 20 %, milk unchanged; olive oil's last price is two weeks old (not this week).
  await seedPriceHistory(household.hid, "jasmine-rice", { productName: "PC Jasmine Rice 2 kg", productCode: "E2E-RICE", packAmount: 2000, packMeasure: "weight", weekly: [500, 500, 500, 650], lastDaysAgo: 1 });
  await seedPriceHistory(household.hid, "chicken-thigh", { productName: "PC Chicken Thighs", productCode: "E2E-CHX", packAmount: 900, packMeasure: "weight", weekly: [1000, 1000, 1000, 800], lastDaysAgo: 2 });
  await seedPriceHistory(household.hid, "milk", { productName: "Lactantia 2% Milk", productCode: "E2E-MILK", packAmount: 4000, packMeasure: "volume", weekly: [679, 679, 679, 679], lastDaysAgo: 1 });
  await seedPriceHistory(household.hid, "olive-oil", { productName: "PC Olive Oil", productCode: "E2E-OIL", packAmount: 1000, packMeasure: "volume", weekly: [1000, 1000, 1000, 500], lastDaysAgo: 14 });
  const tile = page.getByTestId("stat-prices");
  const rows = tile.getByTestId("price-mover");
  await expect(rows).toHaveCount(2, { timeout: 20_000 });
  await expect(rows.nth(0)).toContainText("PC Jasmine Rice 2 kg");
  await expect(rows.nth(0)).toContainText("$6.50");
  await expect(rows.nth(0)).toContainText("+30%");
  await expect(rows.nth(0)).toContainText(/usual \$5\.00/i);
  await expect(rows.nth(1)).toContainText("PC Chicken Thighs");
  await expect(rows.nth(1)).toContainText("−20%");
});
