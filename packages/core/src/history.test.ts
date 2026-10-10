import { describe, expect, it } from "vitest";
import { avgRatingByCuisine, deviations, eventAverage, mostCooked, spendPerPeriod } from "./history";
import { parseCommand, ratingId } from "./commands";
import { projectPending, type ProjectedDoc } from "./projection";

const DAY = 86_400_000;

describe("history stats (R10.3)", () => {
  it("most cooked, average rating by cuisine, event average", () => {
    const events = [
      { id: "1", recipeIds: ["a", "b"], titles: ["Dal", "Rice"], cookedAtMs: 1 },
      { id: "2", recipeIds: ["a"], titles: ["Dal (new title)"], cookedAtMs: 2 },
    ];
    expect(mostCooked(events)).toEqual([
      { recipeId: "a", title: "Dal (new title)", count: 2 },
      { recipeId: "b", title: "Rice", count: 1 },
    ]);
    const ratings = [
      { cookEventId: "1", targetType: "recipe" as const, targetId: "a", score: 8, uid: "x" },
      { cookEventId: "1", targetType: "recipe" as const, targetId: "b", score: 6, uid: "x" },
      { cookEventId: "1", targetType: "meal" as const, targetId: "m", score: 10, uid: "x" },
    ];
    expect(avgRatingByCuisine(ratings, (id) => (id === "a" ? "indian" : id === "b" ? "chinese" : undefined))).toEqual([
      { cuisine: "indian", avg: 8, count: 1 },
      { cuisine: "chinese", avg: 6, count: 1 },
    ]);
    expect(eventAverage(ratings)).toBe(8);
    expect(eventAverage([])).toBeNull();
  });
  it("spend per period sums lists received in each period", () => {
    const periods = [
      { id: "p2", startMs: 7 * DAY, endMs: 14 * DAY, budgetCents: 100 },
      { id: "p1", startMs: 0, endMs: 7 * DAY, budgetCents: 100 },
    ];
    const out = spendPerPeriod(
      [
        { receivedAtMs: DAY, cents: 500 },
        { receivedAtMs: 6 * DAY, cents: 250 },
        { receivedAtMs: 7 * DAY, cents: 1 },
      ],
      periods,
    );
    expect(out.map((p) => [p.id, p.cents])).toEqual([
      ["p1", 750],
      ["p2", 1],
    ]);
  });
  it("deviations: confirmed vs. recipe, noise ignored", () => {
    expect(
      deviations(
        [
          { ingredientId: "a", canonicalAmount: 600 },
          { ingredientId: "b", canonicalAmount: 1000 },
        ],
        [
          { ingredientId: "a", canonicalAmount: 700 },
          { ingredientId: "b", canonicalAmount: 1005 },
          { ingredientId: "c", canonicalAmount: 1 },
        ],
      ),
    ).toEqual([
      { ingredientId: "a", delta: 100 },
      { ingredientId: "c", delta: 1 },
    ]);
  });
});

describe("commands", () => {
  it("parses known commands and rejects bad payloads", () => {
    expect(parseCommand({ type: "addSupply", payload: { ingredientId: "rice", amount: 1000, location: "pantry" } }).type).toBe("addSupply");
    expect(() => parseCommand({ type: "addSupply", payload: { ingredientId: "rice", amount: -1, location: "pantry" } })).toThrow();
    expect(() => parseCommand({ type: "nope", payload: {} })).toThrow();
    expect(() => parseCommand({ type: "submitReview", payload: { cookEventId: "e", ratings: [{ targetType: "recipe", targetId: "r", score: 11 }] } })).toThrow();
    expect(ratingId("e", "u", "recipe", "r")).toBe("e_u_recipe_r");
  });
});

describe("optimistic projection of pending commands", () => {
  const NOW = Date.UTC(2026, 9, 10, 16);
  const ing = (id: string) => (id === "rice" ? { name: "rice", canonicalUnit: "g" as const, defaultLocation: "pantry" as const, shelfLifeDays: { pantry: 365 }, freeUse: false } : id === "salt" ? { name: "salt", canonicalUnit: "g" as const, defaultLocation: "pantry" as const, shelfLifeDays: {}, freeUse: true } : undefined);
  it("adds, corrects, discards, and freezes on a copy", () => {
    const base = new Map<string, ProjectedDoc>([["rice", { ingredientId: "rice", label: "rice", canonicalUnit: "g", lots: [{ lotId: "l1", amount: 500, location: "pantry", acquiredAtMs: NOW - DAY }] }]]);
    const out = projectPending(
      base,
      [
        { id: "c1", command: { type: "addSupply", payload: { ingredientId: "rice", amount: 1000, location: "pantry" } } },
        { id: "c2", command: { type: "addSupply", payload: { ingredientId: "salt", amount: 1000, location: "pantry" } } },
        { id: "c3", command: { type: "discard", payload: { supplyId: "rice", lotId: "l1" } } },
        { id: "c4", command: { type: "freeze", payload: { supplyId: "rice", lotId: "c1", amount: 400 } } },
      ],
      { nowMs: NOW, tz: "America/Toronto", ingredient: ing },
    );
    expect(base.get("rice")!.lots).toHaveLength(1); // untouched
    const rice = out.get("rice")!;
    expect(rice.pending).toBe(true);
    expect(rice.lots.map((l) => [l.lotId, l.amount, l.location])).toEqual([
      ["c1", 600, "pantry"],
      ["c1-f1", 400, "freezer"],
    ]);
    expect(out.has("salt")).toBe(false); // free-use: no tracked amount
  });
});
