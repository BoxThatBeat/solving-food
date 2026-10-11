import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  cookedCoverage,
  earliestExpiringUse,
  leftoverMealTypeOf,
  leftoverPortionsByType,
  mealRequirements,
  pendingReviews,
  projectedSupply,
  reviewDeltas,
  supplyCoverage,
  toMap,
  totalPortions,
  unexpiredByIngredient,
} from "./cooking";
import { expectedRunOut, updateCadence } from "./cadence";
import { consumeFEFO, refund, recomputeAmount, type LedgerLot } from "./ledger";
import { addLocalDays, daysLeft, estimateExpiry, expiresPhrase, expiryFlag, leftoverExpiry, shortDuration } from "./expiry";
import { localDate } from "./period";

const DAY = 86_400_000;
const TZ = "America/Toronto";
const NOW = Date.UTC(2026, 9, 10, 16); // 10 Oct 2026, noon in Toronto

const ingredients = new Map([
  ["chicken", { id: "chicken", name: "chicken", category: "meat", freeUse: false, canonicalUnit: "g" as const }],
  ["spinach", { id: "spinach", name: "spinach", category: "produce", freeUse: false, canonicalUnit: "g" as const }],
  ["oil", { id: "oil", name: "oil", category: "pantry", freeUse: true, canonicalUnit: "g" as const }],
]);
const recipes = new Map([
  [
    "r1",
    {
      servings: 4,
      ingredients: [
        { ingredientId: "chicken", canonicalAmount: 600, optional: false },
        { ingredientId: "spinach", canonicalAmount: 140, optional: false },
        { ingredientId: "oil", canonicalAmount: 27, optional: false },
      ],
    },
  ],
]);
const ctx = { recipes: (id: string) => recipes.get(id), ingredients: (id: string) => ingredients.get(id) };

describe("expiry estimates (R8.5)", () => {
  it("expires at local midnight n days after the purchase date", () => {
    const e = estimateExpiry({ fridge: 7 }, "fridge", NOW, TZ)!;
    expect(localDate(e, TZ)).toBe("2026-10-17");
    expect(localDate(e - 1, TZ)).toBe("2026-10-16");
    expect(estimateExpiry({ fridge: null }, "fridge", NOW, TZ)).toBeNull();
    expect(estimateExpiry({}, "pantry", NOW, TZ)).toBeNull();
  });
  it("crosses the November DST change on a whole-day boundary", () => {
    const e = addLocalDays(Date.UTC(2026, 9, 30, 16), 4, TZ);
    expect(localDate(e, TZ)).toBe("2026-11-03");
    expect(new Date(e).getUTCHours()).toBe(5); // EST midnight
  });
  it("leftovers keep 4 days in the fridge, 90 frozen (R6.10)", () => {
    expect(localDate(leftoverExpiry(NOW, TZ), TZ)).toBe("2026-10-14");
    expect(localDate(leftoverExpiry(NOW, TZ, true), TZ)).toBe("2027-01-08");
  });
  it("flags fresh, use soon, expired", () => {
    expect(expiryFlag(null, NOW, TZ)).toBe("none");
    expect(expiryFlag(addLocalDays(NOW, 10, TZ), NOW, TZ)).toBe("fresh");
    expect(expiryFlag(addLocalDays(NOW, 2, TZ), NOW, TZ)).toBe("soon");
    expect(expiryFlag(addLocalDays(NOW, 0, TZ), NOW, TZ)).toBe("expired");
    expect(daysLeft(addLocalDays(NOW, 3, TZ), NOW, TZ)).toBe(2);
    expect(expiresPhrase(addLocalDays(NOW, 3, TZ), NOW, TZ)).toBe("expires in 2 days");
    expect(expiresPhrase(addLocalDays(NOW, 1, TZ), NOW, TZ)).toBe("expires today");
    expect(shortDuration(150)).toBe("5MO");
  });
});

describe("cooking", () => {
  it("requirements scale with servings and skip free-use (R9.3, R8.14)", () => {
    const m = mealRequirements([{ recipeId: "r1", servingsMultiplier: 1 }], 2, ctx);
    expect([...m]).toEqual([
      ["chicken", 300],
      ["spinach", 70],
    ]);
  });
  it("leftovers: portions by meal type, a cooked meal keeps one slot", () => {
    const by = leftoverPortionsByType(
      [
        { recipeId: "a", servingsMultiplier: 1 },
        { recipeId: "b", servingsMultiplier: 2 },
      ],
      (id) => (id === "a" ? { defaultLeftoverPortions: 3, leftoverMealType: "lunch" } : { defaultLeftoverPortions: 1, leftoverMealType: "breakfast" }),
    );
    expect(by).toEqual({ lunch: 3, breakfast: 1 });
    expect(totalPortions(by)).toBe(4);
    expect(leftoverMealTypeOf(by)).toBe("lunch");
    expect(cookedCoverage("dinner")).toEqual({ dinner: 1 });
    expect(cookedCoverage("snack")).toEqual({});
  });
  it("review deltas are confirmed − deducted", () => {
    const d = reviewDeltas(
      toMap([
        { ingredientId: "chicken", canonicalAmount: 600 },
        { ingredientId: "spinach", canonicalAmount: 140 },
      ]),
      toMap([
        { ingredientId: "chicken", canonicalAmount: 700 },
        { ingredientId: "feta", canonicalAmount: 50 },
      ]),
    );
    expect(d).toEqual([
      { ingredientId: "chicken", delta: 100 },
      { ingredientId: "feta", delta: 50 },
      { ingredientId: "spinach", delta: -140 },
    ]);
  });
  it("finishCooking then a review nets to the confirmed amount (property)", () => {
    const mk = (id: string, amount: number, d: number): LedgerLot => ({ lotId: id, amount, location: "fridge", acquiredAtMs: NOW, expiresFreshMs: NOW + d * DAY });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 1500 }), (a, b, def, confirmed) => {
        const lots = [mk("a", a, 2), mk("b", b, 6)];
        const start = recomputeAmount(lots);
        const cook = consumeFEFO(lots, def, NOW);
        const deducted = start - recomputeAmount(cook.lots);
        const delta = confirmed - deducted;
        const after = delta >= 0 ? consumeFEFO(cook.lots, delta, NOW, "correction").lots : refund(cook.lots, cook.takes, -delta, () => mk("n", 0, 5)).lots;
        // Net effect: exactly the confirmed amount, unless there wasn't that much.
        expect(start - recomputeAmount(after)).toBeCloseTo(Math.min(confirmed, start), 3);
      }),
      { numRuns: 300 },
    );
  });
});

describe("projected supply and can-make (R8.4, R4.3, R4.4)", () => {
  const lots = (amount: number, d: number | null): LedgerLot[] => [{ lotId: "x", amount, location: "fridge", acquiredAtMs: NOW, expiresFreshMs: d === null ? null : NOW + d * DAY }];
  it("excludes expired lots and subtracts planned needs", () => {
    const un = unexpiredByIngredient(
      [
        { ingredientId: "chicken", lots: lots(1000, 3) },
        { ingredientId: "spinach", lots: lots(500, -1) },
        { lots: lots(2, 2) },
      ],
      NOW,
    );
    expect([...un]).toEqual([
      ["chicken", 1000],
      ["spinach", 0],
    ]);
    const p = projectedSupply(un, [{ id: "p", status: "planned", servings: 4, recipes: [{ recipeId: "r1", servingsMultiplier: 1 }] }], ctx);
    expect(p.get("chicken")).toBe(400);
    expect(p.get("spinach")).toBe(-140);
  });
  it("coverage ignores free-use; can make needs every tracked line", () => {
    const lines = recipes.get("r1")!.ingredients;
    const all = supplyCoverage(lines, new Map([["chicken", 600], ["spinach", 200]]), (id) => ingredients.get(id));
    expect(all).toEqual({ fraction: 1, canMake: true, missing: [] });
    const most = supplyCoverage(lines, new Map([["chicken", 600], ["spinach", 100]]), (id) => ingredients.get(id));
    expect(most.canMake).toBe(false);
    expect(most.fraction).toBeCloseTo(700 / 740);
    expect(most.missing).toEqual(["spinach"]);
  });
  it("expiry badge: earliest unexpired lot the item uses (R6.7)", () => {
    const e = earliestExpiringUse(new Map([["chicken", 600], ["spinach", 1]]), (id) => (id === "chicken" ? lots(500, 5) : lots(100, 2)), NOW);
    expect(e).toEqual({ ingredientId: "spinach", expiresMs: NOW + 2 * DAY });
    expect(earliestExpiringUse(new Map([["chicken", 1]]), () => lots(5, -1), NOW)).toBeNull();
  });
});

describe("staples cadence (R7.7)", () => {
  it("first purchase records the date; the EMA starts at the second", () => {
    const a = updateCadence(null, NOW);
    expect(a).toEqual({ avgIntervalDays: null, lastPurchasedAtMs: NOW, purchaseCount: 1 });
    const b = updateCadence(a, NOW + 10 * DAY);
    expect(b.avgIntervalDays).toBe(10);
    const c = updateCadence(b, NOW + 16 * DAY);
    expect(c.avgIntervalDays).toBe(8);
    expect(updateCadence(c, NOW + 16 * DAY + 3600_000)).toEqual({ ...c, lastPurchasedAtMs: NOW + 16 * DAY + 3600_000 });
    expect(expectedRunOut(a, 7)).toBe(NOW + 7 * DAY);
    expect(expectedRunOut(c, 7)).toBe(NOW + 24 * DAY);
  });
});

describe("pending reviews (R9.4)", () => {
  it("pending events, and recent ones I haven't rated", () => {
    const list = pendingReviews(
      [
        { id: "a", reviewStatus: "pending", ratedBy: ["me"], cookedAtMs: NOW - DAY },
        { id: "b", reviewStatus: "done", ratedBy: ["sam"], cookedAtMs: NOW - 2 * DAY },
        { id: "c", reviewStatus: "done", ratedBy: ["me"], cookedAtMs: NOW },
        { id: "d", reviewStatus: "done", ratedBy: ["sam"], cookedAtMs: NOW - 9 * DAY },
      ],
      "me",
      NOW,
    );
    expect(list.map((e) => [e.id, e.reason])).toEqual([
      ["a", "review"],
      ["b", "rate"],
    ]);
  });
});
