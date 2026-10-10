// Command handlers on the emulators (Planning/M3 "Tests → Functions"): every handler's happy path through the real
// onDocumentCreated trigger, idempotent repeats, failed validation → `failed` with an error and a banner, and the net
// effect of finishCooking + submitReview equals the confirmed amounts.
import { beforeAll, describe, expect, it } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { clearFirestore, db, poll } from "./helpers";
import { applyCommand } from "../src/commands";

const HID = "hh-cmd";
const UID = "cook-1";
const UID2 = "cook-2";
const DAY = 86_400_000;

const ING = {
  rice: { name: "rice", aliases: [], category: "grains", defaultLocation: "pantry", allowedMeasures: ["weight"], canonicalUnit: "g", shelfLifeDays: { pantry: 365 }, freezable: false, isStaple: true, freeUse: false, needsReview: false },
  chicken: { name: "chicken thigh", aliases: [], category: "meat", defaultLocation: "fridge", allowedMeasures: ["weight"], canonicalUnit: "g", shelfLifeDays: { fridge: 2, freezer: 180 }, freezable: true, isStaple: false, freeUse: false, needsReview: false },
  spinach: { name: "baby spinach", aliases: [], category: "produce", defaultLocation: "fridge", allowedMeasures: ["weight"], canonicalUnit: "g", shelfLifeDays: { fridge: 5 }, freezable: false, isStaple: false, freeUse: false, needsReview: false },
  oil: { name: "olive oil", aliases: [], category: "pantry", defaultLocation: "pantry", allowedMeasures: ["volume"], canonicalUnit: "g", densityGPerMl: 0.91, shelfLifeDays: {}, freezable: false, isStaple: true, freeUse: true, needsReview: false },
};

function recipe(title: string, lines: Array<[string, number]>, extra: Record<string, unknown> = {}) {
  return {
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    servings: 4,
    prepMin: 10,
    cookMin: 20,
    cuisine: "other",
    mainProtein: "chicken",
    tags: ["dinner"],
    tools: [],
    ingredients: lines.map(([ingredientId, canonicalAmount], i) => ({ id: `l${i}`, ingredientId, amount: canonicalAmount, measure: "g", canonicalAmount, displayText: ingredientId, optional: false })),
    steps: [{ text: "Cook.", ingredientRefs: [] }],
    prepTasks: [],
    defaultLeftoverPortions: 0,
    fingerprint: title,
    ingredientIds: lines.map(([id]) => id),
    imagePaths: [],
    status: "active",
    createdBy: "x",
    updatedBy: "x",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

let n = 0;
async function command(type: string, payload: Record<string, unknown>, uid = UID): Promise<{ id: string; status: string; error?: string; result?: string }> {
  const id = `c${++n}-${Date.now()}`;
  await db.doc(`households/${HID}/commands/${id}`).set({ type, payload, uid, createdAt: FieldValue.serverTimestamp(), status: "pending" });
  const done = await poll(
    async () => {
      const d = (await db.doc(`households/${HID}/commands/${id}`).get()).data();
      return d && d.status !== "pending" ? d : null;
    },
    30_000,
    `command ${type}`,
  );
  return { id, status: done.status, error: done.error, result: done.result };
}

const supply = async (id: string) => (await db.doc(`households/${HID}/supply/${id}`).get()).data();
const txSum = async (id: string) => (await db.collection(`households/${HID}/supply/${id}/transactions`).get()).docs.reduce((s, d) => s + (d.data().delta as number), 0);

describe("supply commands", () => {
  beforeAll(async () => {
    await clearFirestore();
    const b = db.batch();
    for (const [id, d] of Object.entries(ING)) b.set(db.doc(`ingredients/${id}`), d);
    b.set(db.doc(`households/${HID}`), { name: "Cmd", createdBy: UID, timezone: "America/Toronto", currentPeriodId: "2026-10-05", periodDays: 7, budgetCents: 0, currency: "CAD", defaultServings: 4, plannedMealTypes: ["breakfast", "lunch", "dinner"], pcxStoreId: "x", settings: {} });
    b.set(db.doc("recipes/r-chicken"), recipe("Chicken spinach", [["chicken", 600], ["spinach", 140], ["oil", 27]], { defaultLeftoverPortions: 2, leftoverMealType: "lunch" }));
    b.set(db.doc("recipes/r-rice"), recipe("Plain rice", [["rice", 400]]));
    await b.commit();
  });

  it("addSupply adds a lot with an estimated expiry; free-use only records the date", async () => {
    const r = await command("addSupply", { ingredientId: "rice", amount: 1000, location: "pantry", entered: "1 kg" });
    expect(r.status).toBe("applied");
    const s = (await supply("rice"))!;
    expect(s.canonicalAmount).toBe(1000);
    expect(s.lots).toHaveLength(1);
    expect(s.lots[0].expiresFresh.toMillis()).toBeGreaterThan(Date.now() + 300 * DAY);
    expect(await txSum("rice")).toBe(1000);
    const oil = await command("addSupply", { ingredientId: "oil", amount: 500, location: "pantry" });
    expect(oil.result).toMatch(/staple/);
    expect(await supply("oil")).toBeUndefined();
    expect((await db.doc(`households/${HID}/cadence/oil`).get()).data()?.purchaseCount).toBe(1);
  });

  it("bad payloads fail with an error and a banner; a repeat run is a no-op", async () => {
    const bad = await command("addSupply", { ingredientId: "rice", amount: -5, location: "pantry" });
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/amount/);
    const banners = await db.collection(`users/${UID}/notifications`).where("kind", "==", "error").get();
    expect(banners.docs.some((d) => /Couldn't add to supply/.test(d.data().message))).toBe(true);
    const unknown = await command("discard", { supplyId: "rice", lotId: "nope" });
    expect(unknown.error).toMatch(/no longer in supply/);
    // Applying an applied command again changes nothing.
    const ok = await command("correctSupply", { supplyId: "rice", target: 900 });
    expect((await applyCommand(HID, ok.id)).status).toBe("skipped");
    expect((await supply("rice"))!.canonicalAmount).toBe(900);
  });

  it("correctSupply, freeze (split), thaw, discard, Still good keep Σ transactions == amount", async () => {
    await command("addSupply", { ingredientId: "chicken", amount: 3000, location: "fridge" });
    const lotId = (await supply("chicken"))!.lots[0].lotId as string;
    expect((await command("freeze", { supplyId: "chicken", lotId, amount: 2000 })).status).toBe("applied");
    let s = (await supply("chicken"))!;
    expect(s.lots.map((l: { amount: number; location: string }) => [l.amount, l.location]).sort()).toEqual([
      [1000, "fridge"],
      [2000, "freezer"],
    ]);
    const frozen = s.lots.find((l: { location: string }) => l.location === "freezer");
    expect(frozen.expiresFrozen.toMillis()).toBeGreaterThan(Date.now() + 100 * DAY);
    expect((await command("thaw", { supplyId: "chicken", lotId: frozen.lotId, amount: 500 })).status).toBe("applied");
    expect((await command("correctSupply", { supplyId: "chicken", target: 2800 })).status).toBe("applied");
    s = (await supply("chicken"))!;
    expect(s.canonicalAmount).toBe(2800);
    expect(await txSum("chicken")).toBeCloseTo(2800, 6);
    // An expired lot: Still good, then Threw it out.
    await db.doc(`households/${HID}/supply/spinach`).set({ ingredientId: "spinach", label: "baby spinach", canonicalUnit: "g", canonicalAmount: 0, lots: [] });
    await command("addSupply", { ingredientId: "spinach", amount: 200, location: "fridge" });
    const sp = (await supply("spinach"))!;
    const old = { ...sp.lots[0], expiresFresh: Timestamp.fromMillis(Date.now() - DAY) };
    await db.doc(`households/${HID}/supply/spinach`).update({ lots: [old] });
    expect((await command("extendExpiry", { supplyId: "spinach", lotId: old.lotId })).status).toBe("applied");
    const ext = (await supply("spinach"))!.lots[0];
    expect(ext.expiryExtendedTo.toMillis()).toBeGreaterThan(Date.now() + 2 * DAY);
    expect((await command("discard", { supplyId: "spinach", lotId: old.lotId })).status).toBe("applied");
    expect((await supply("spinach"))!.canonicalAmount).toBe(0);
  });
});

describe("receiveGroceries", () => {
  it("adds what arrived, freezes the bulk split, updates cadence, marks the list received with its cost", async () => {
    await db.doc(`households/${HID}/groceryLists/ord1`).set({
      periodId: "2026-10-05",
      status: "ordered",
      createdAt: new Date(),
      orderedAt: new Date(),
      orderedBy: UID,
      items: {
        rice: { ingredientId: "rice", amount: 2000, measure: "g", packs: 1, productName: "Rice 2 kg", storeId: "pc-express", estPriceCents: 600, source: "plan", checked: false },
        chicken: { ingredientId: "chicken", amount: 2000, measure: "g", packs: 1, productName: "Kirkland thighs", storeId: "costco", estPriceCents: 2000, source: "plan", checked: false },
        "manual_x": { freeText: "Birthday candles", amount: 0, measure: "count", packs: 1, productName: "Birthday candles", storeId: "pc-express", estPriceCents: null, source: "manual", checked: false },
      },
    });
    const riceBefore = (await supply("rice"))!.canonicalAmount as number;
    const chickenBefore = (await supply("chicken"))!.canonicalAmount as number;
    const r = await command("receiveGroceries", {
      listId: "ord1",
      items: [
        { itemId: "rice", ingredientId: "rice", amount: 1000 }, // a smaller bag arrived
        { itemId: "chicken", ingredientId: "chicken", amount: 2000, freezeAmount: 1500 },
        { itemId: "manual_x", amount: 0 },
      ],
    });
    expect(r.status).toBe("applied");
    expect((await supply("rice"))!.canonicalAmount).toBe(riceBefore + 1000);
    const ch = (await supply("chicken"))!;
    expect(ch.canonicalAmount).toBe(chickenBefore + 2000);
    expect(ch.lots.filter((l: { location: string; amount: number }) => l.location === "freezer").map((l: { amount: number }) => l.amount)).toContain(1500);
    const list = (await db.doc(`households/${HID}/groceryLists/ord1`).get()).data()!;
    expect(list.status).toBe("received");
    expect(list.receivedBy).toBe(UID);
    expect(list.receivedCents).toBe(300 + 2000);
    expect(list.items.rice.receivedAmount).toBe(1000);
    expect((await db.doc(`households/${HID}/cadence/chicken`).get()).data()?.purchaseCount).toBe(1);
    // Receiving twice does nothing more.
    const again = await command("receiveGroceries", { listId: "ord1", items: [] });
    expect(again.result).toBe("already received");
  });
});

describe("cooking, review, leftovers, eaten", () => {
  it("finishCooking deducts defaults FEFO, adds leftovers as supply and plan items, marks cooked, counts the stat; a second finish is a no-op", async () => {
    await db.doc(`households/${HID}/planItems/p1`).set({ periodId: "2026-10-05", kind: "meal", mealType: "dinner", servings: 4, recipes: [{ recipeId: "r-chicken", servingsMultiplier: 1 }], coverage: { dinner: 1, lunch: 2 }, status: "planned", addedBy: UID });
    const before = (await supply("chicken"))!.canonicalAmount as number;
    const spinachBefore = ((await supply("spinach"))?.canonicalAmount as number) ?? 0;
    const r = await command("finishCooking", { cookEventId: "ev1", planItemId: "p1", recipes: [{ recipeId: "r-chicken", servingsMultiplier: 1 }], servings: 4 });
    expect(r.status).toBe("applied");
    expect((await supply("chicken"))!.canonicalAmount).toBe(before - 600);
    expect((await supply("spinach"))!.canonicalAmount).toBe(spinachBefore); // there was none: short, not negative
    const ev = (await db.doc(`households/${HID}/cookEvents/ev1`).get()).data()!;
    expect(ev.reviewStatus).toBe("pending");
    expect(ev.used).toEqual([
      { ingredientId: "chicken", canonicalAmount: 600 },
      { ingredientId: "spinach", canonicalAmount: 140 },
    ]);
    expect(ev.deducted.find((d: { ingredientId: string }) => d.ingredientId === "spinach").canonicalAmount).toBe(0);
    expect(ev.leftoverPortions).toBe(2);
    const lo = (await supply("leftover_ev1"))!;
    expect(lo.canonicalAmount).toBe(2);
    expect(lo.lots[0].expiresFresh.toMillis() - Date.now()).toBeGreaterThan(3 * DAY);
    const items = await db.collection(`households/${HID}/planItems`).where("leftoverSupplyId", "==", "leftover_ev1").get();
    expect(items.size).toBe(2);
    expect(items.docs[0]!.data()).toMatchObject({ kind: "leftover", mealType: "lunch", coverage: { lunch: 1 }, status: "planned", recipes: [] });
    const plan = (await db.doc(`households/${HID}/planItems/p1`).get()).data()!;
    expect(plan.status).toBe("cooked");
    expect(plan.coverage).toEqual({ dinner: 1 });
    expect((await db.doc(`households/${HID}/stats/recipe_r-chicken`).get()).data()?.timesCooked).toBe(1);

    const twice = await command("finishCooking", { cookEventId: "ev1b", planItemId: "p1", recipes: [{ recipeId: "r-chicken", servingsMultiplier: 1 }], servings: 4 }, UID2);
    expect(twice.result).toBe("already cooked");
    expect((await supply("chicken"))!.canonicalAmount).toBe(before - 600);
    expect((await db.doc(`households/${HID}/stats/recipe_r-chicken`).get()).data()?.timesCooked).toBe(1);
  });

  it("submitReview: net effect equals the confirmed amounts; ratings to stats; leftovers resized; others only add ratings", async () => {
    const start = (await supply("chicken"))!.canonicalAmount as number; // after the default 600 came out
    const r = await command("submitReview", {
      cookEventId: "ev1",
      ratings: [
        { targetType: "recipe", targetId: "r-chicken", score: 8 },
        { targetType: "recipe", targetId: "not-in-meal", score: 1 },
      ],
      used: [
        { ingredientId: "chicken", canonicalAmount: 450 },
        { ingredientId: "rice", canonicalAmount: 100 },
        { ingredientId: "oil", canonicalAmount: 30 },
      ],
      leftoverPortions: 3,
    });
    expect(r.status).toBe("applied");
    // Chicken: 600 deducted, 450 confirmed → 150 back. Rice: 100 more. Free-use oil ignored.
    expect((await supply("chicken"))!.canonicalAmount).toBe(start + 150);
    expect(await txSum("chicken")).toBeCloseTo((await supply("chicken"))!.canonicalAmount, 6);
    const ev = (await db.doc(`households/${HID}/cookEvents/ev1`).get()).data()!;
    expect(ev.reviewStatus).toBe("done");
    expect(ev.ratedBy).toEqual([UID]);
    expect(ev.leftoverPortions).toBe(3);
    expect((await supply("leftover_ev1"))!.canonicalAmount).toBe(3);
    expect((await db.collection(`households/${HID}/planItems`).where("leftoverSupplyId", "==", "leftover_ev1").get()).size).toBe(3);
    const st = (await db.doc(`households/${HID}/stats/recipe_r-chicken`).get()).data()!;
    expect([st.ratingSum, st.ratingCount, st.timesCooked]).toEqual([8, 1, 1]);
    expect((await db.doc(`households/${HID}/stats/recipe_not-in-meal`).get()).exists).toBe(false);

    // Re-rating replaces; another member's rating adds; neither touches supply again.
    const chickenNow = (await supply("chicken"))!.canonicalAmount;
    await command("submitReview", { cookEventId: "ev1", ratings: [{ targetType: "recipe", targetId: "r-chicken", score: 6 }] });
    await command("submitReview", { cookEventId: "ev1", ratings: [{ targetType: "recipe", targetId: "r-chicken", score: 10 }], used: [{ ingredientId: "chicken", canonicalAmount: 9999 }] }, UID2);
    const st2 = (await db.doc(`households/${HID}/stats/recipe_r-chicken`).get()).data()!;
    expect([st2.ratingSum, st2.ratingCount]).toEqual([16, 2]);
    expect((await supply("chicken"))!.canonicalAmount).toBe(chickenNow);
  });

  it("markEaten: a leftover portion leaves supply; a cooked meal changes status only; an uncooked dinner is refused", async () => {
    const lo = (await db.collection(`households/${HID}/planItems`).where("leftoverSupplyId", "==", "leftover_ev1").get()).docs[0]!;
    expect((await command("markEaten", { planItemId: lo.id })).status).toBe("applied");
    expect((await supply("leftover_ev1"))!.canonicalAmount).toBe(2);
    expect((await db.doc(lo.ref.path).get()).data()!.status).toBe("eaten");
    expect((await command("markEaten", { planItemId: "p1" })).status).toBe("applied");
    expect((await db.doc(`households/${HID}/planItems/p1`).get()).data()!.status).toBe("eaten");
    await db.doc(`households/${HID}/planItems/p2`).set({ periodId: "2026-10-05", kind: "meal", mealType: "dinner", servings: 4, recipes: [{ recipeId: "r-rice", servingsMultiplier: 1 }], coverage: { dinner: 1 }, status: "planned", addedBy: UID });
    expect((await command("markEaten", { planItemId: "p2" })).status).toBe("failed");
  });

  it("a review queued offline with its finishCooking applies after it, whatever order they arrive in", async () => {
    await db.doc(`households/${HID}/planItems/p3`).set({ periodId: "2026-10-05", kind: "meal", mealType: "dinner", servings: 4, recipes: [{ recipeId: "r-rice", servingsMultiplier: 1 }], coverage: { dinner: 1 }, status: "planned", addedBy: UID });
    const before = (await supply("rice"))!.canonicalAmount as number;
    const b = db.batch();
    const at = FieldValue.serverTimestamp();
    b.set(db.doc(`households/${HID}/commands/offline-review`), { type: "submitReview", payload: { cookEventId: "ev-off", ratings: [{ targetType: "recipe", targetId: "r-rice", score: 7 }], used: [{ ingredientId: "rice", canonicalAmount: 300 }], leftoverPortions: 0 }, uid: UID, createdAt: at, status: "pending" });
    b.set(db.doc(`households/${HID}/commands/offline-finish`), { type: "finishCooking", payload: { cookEventId: "ev-off", planItemId: "p3", recipes: [{ recipeId: "r-rice", servingsMultiplier: 1 }], servings: 4 }, uid: UID, createdAt: at, status: "pending" });
    await b.commit();
    for (const id of ["offline-review", "offline-finish"]) {
      const d = await poll(async () => {
        const x = (await db.doc(`households/${HID}/commands/${id}`).get()).data();
        return x && x.status !== "pending" ? x : null;
      });
      expect(d.status, id).toBe("applied");
    }
    expect((await supply("rice"))!.canonicalAmount).toBe(before - 300);
    expect((await db.doc(`households/${HID}/cookEvents/ev-off`).get()).data()!.reviewStatus).toBe("done");
  });

  it("importHousehold is a placeholder until M4", async () => {
    const r = await command("importHousehold", { path: "imports/x.zip" });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/M4/);
  });
});
