import { describe, expect, it } from "vitest";
import { buildPlanItem, carriedItemId, carryOver, coverageFor, createMealInputSchema, defaultMealName, planItemTitle, proteinSummary, stripCount, stripModel } from "./plan";
import type { PlanItemDoc } from "./types";

const recipes: Record<string, { defaultLeftoverPortions: number; leftoverMealType?: "breakfast" | "lunch" | "dinner" | "snack" }> = {
  plain: { defaultLeftoverPortions: 0 },
  prep: { defaultLeftoverPortions: 4, leftoverMealType: "lunch" },
  bake: { defaultLeftoverPortions: 2, leftoverMealType: "breakfast" },
  sweet: { defaultLeftoverPortions: 3, leftoverMealType: "snack" },
};
const lookup = (id: string) => recipes[id];
const ref = (recipeId: string) => ({ recipeId, servingsMultiplier: 1 });

describe("coverageFor", () => {
  it("an ordinary dinner covers one dinner", () => {
    expect(coverageFor({ mealType: "dinner", recipes: [ref("plain")] }, lookup)).toEqual({ dinner: 1 });
  });
  it("meal prep covers its leftover portions as soon as it's planned", () => {
    expect(coverageFor({ mealType: "dinner", recipes: [ref("prep")] }, lookup)).toEqual({ dinner: 1, lunch: 4 });
  });
  it("sums leftover portions across the meal's recipes", () => {
    expect(coverageFor({ mealType: "dinner", recipes: [ref("prep"), ref("bake"), ref("plain")] }, lookup)).toEqual({ dinner: 1, lunch: 4, breakfast: 2 });
  });
  it("snacks and snack leftovers fill no strip cells", () => {
    expect(coverageFor({ mealType: "snack", recipes: [ref("sweet")] }, lookup)).toEqual({});
  });
  it("unknown recipes still count the meal", () => {
    expect(coverageFor({ mealType: "lunch", recipes: [ref("gone")] }, lookup)).toEqual({ lunch: 1 });
  });
});

const item = (coverage: PlanItemDoc["coverage"], status: PlanItemDoc["status"] = "planned") => ({ coverage, status });

describe("stripModel", () => {
  it("fills left to right: cooked solid first, then planned outlined", () => {
    const rows = stripModel([item({ dinner: 1 }), item({ dinner: 1 }, "cooked"), item({ dinner: 1 }), item({ dinner: 1, lunch: 4 })], 7, ["breakfast", "lunch", "dinner"]);
    const dinner = rows.find((r) => r.mealType === "dinner")!;
    expect(dinner.cells).toEqual(["cooked", "planned", "planned", "planned", "open", "open", "open"]);
    expect(stripCount(dinner)).toBe("4/7");
    expect(rows.find((r) => r.mealType === "lunch")!.filled).toBe(4);
    expect(rows.find((r) => r.mealType === "breakfast")!.filled).toBe(0);
  });
  it("shows overflow", () => {
    const rows = stripModel(Array.from({ length: 8 }, () => item({ dinner: 1 })), 7, ["dinner"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells).toHaveLength(7);
    expect(rows[0]!.overflow).toBe(1);
    expect(stripCount(rows[0]!)).toBe("8/7 · +1");
  });
  it("only rows for planned meal types; items for others still exist but have no row", () => {
    const rows = stripModel([item({ breakfast: 1 }), item({ dinner: 1 })], 5, ["dinner"]);
    expect(rows.map((r) => r.mealType)).toEqual(["dinner"]);
  });
  it("skipped items don't count, eaten ones are solid", () => {
    const rows = stripModel([item({ lunch: 1 }, "skipped"), item({ lunch: 1 }, "eaten")], 3, ["lunch"]);
    expect(rows[0]!.cells).toEqual(["cooked", "open", "open"]);
  });
});

describe("Create meal", () => {
  const base = { recipes: [ref("plain")], mealType: "dinner" as const, servings: 4, saveAsMeal: false };
  it("validates", () => {
    expect(createMealInputSchema.safeParse(base).success).toBe(true);
    expect(createMealInputSchema.safeParse({ ...base, recipes: [] }).success).toBe(false);
    expect(createMealInputSchema.safeParse({ ...base, saveAsMeal: true }).success).toBe(false);
    expect(createMealInputSchema.safeParse({ ...base, saveAsMeal: true, name: "Taco night" }).success).toBe(true);
  });
  it("builds the plan item with coverage and the saved meal link", () => {
    const it = buildPlanItem({ ...base, recipes: [ref("prep"), ref("plain")], name: "Prep night", saveAsMeal: true }, { periodId: "2026-10-05", uid: "u1", recipes: lookup, savedMealId: "m1" });
    expect(it).toEqual({
      periodId: "2026-10-05",
      kind: "meal",
      mealType: "dinner",
      servings: 4,
      recipes: [ref("prep"), ref("plain")],
      coverage: { dinner: 1, lunch: 4 },
      status: "planned",
      addedBy: "u1",
      savedMealId: "m1",
      name: "Prep night",
    });
    // A one-recipe meal doesn't carry a stray name.
    expect(buildPlanItem({ ...base, name: "x" }, { periodId: "p", uid: "u", recipes: lookup }).name).toBeUndefined();
  });
  it("titles and default names", () => {
    expect(defaultMealName(["Carnitas", "Pico", "Tortillas"])).toBe("Carnitas + Pico + Tortillas");
    expect(defaultMealName(["x".repeat(100)])).toHaveLength(80);
    const titles: Record<string, string> = { a: "Carnitas", b: "Pico" };
    expect(planItemTitle({ recipes: [ref("a"), ref("b")] }, (id) => titles[id])).toBe("Carnitas + Pico");
    expect(planItemTitle({ name: "Taco night", recipes: [ref("a")] }, (id) => titles[id])).toBe("Taco night");
  });
});

describe("rollover helpers", () => {
  it("carries a planned item with a pointer back and a deterministic ID", () => {
    const orig: PlanItemDoc = { periodId: "p1", kind: "meal", mealType: "dinner", servings: 4, recipes: [ref("a")], coverage: { dinner: 1 }, status: "planned", addedBy: "u" };
    expect(carryOver(orig, "i1", "p2")).toEqual({ ...orig, periodId: "p2", carriedFromId: "i1" });
    expect(carriedItemId("p2", "i1")).toBe("p2_i1");
  });
});

describe("proteinSummary", () => {
  it("averages per meal type, summing a meal's recipes", () => {
    const p: Record<string, number | null> = { a: 30, b: 10, c: null };
    const s = proteinSummary(
      [
        { mealType: "dinner", recipes: [ref("a"), ref("b")], status: "planned" },
        { mealType: "dinner", recipes: [ref("a")], status: "planned" },
        { mealType: "lunch", recipes: [ref("c")], status: "planned" },
      ],
      (id) => p[id],
    );
    expect(s).toEqual({ dinner: { avg: 35, items: 2 } });
  });
});
