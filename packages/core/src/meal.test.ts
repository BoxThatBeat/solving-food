import { describe, expect, it } from "vitest";
import { mealRow, newMeal, planItemRow } from "./meal";
import type { RecipeSummary } from "./recipe";

const s = (id: string, over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id,
  title: id,
  tags: ["dinner"],
  cuisine: "mexican",
  mainProtein: "pork",
  proteinPerServingG: 20,
  proteinApproximate: false,
  ingredientIds: [`${id}-i`],
  ingredientNames: [`${id} thing`],
  totalMin: 30,
  activeMin: 10,
  servings: 4,
  thumb: null,
  sourceUrlCanonical: null,
  fingerprint: id,
  createdAtMs: 0,
  tools: [],
  ...over,
});

describe("meal rows for <CollectionView> (R4.7)", () => {
  const byId = (id: string) => ({ carnitas: s("carnitas", { totalMin: 70, thumb: "x", tools: ["Dutch oven"] }), pico: s("pico", { proteinPerServingG: 1, tags: ["side"] }) })[id];
  it("combines recipes: times summed, protein summed, tags united, missing recipes listed", () => {
    const row = mealRow("m1", { name: "Taco night", recipes: [{ recipeId: "carnitas", servingsMultiplier: 1 }, { recipeId: "pico", servingsMultiplier: 1 }, { recipeId: "gone", servingsMultiplier: 1 }], updatedAt: new Date(5) }, byId);
    expect(row).toMatchObject({ id: "m1", title: "Taco night", totalMin: 100, proteinPerServingG: 21, thumb: "x", tools: ["Dutch oven"], missing: ["gone"] });
    expect(row.tags).toEqual(["dinner", "side"]);
  });
  it("plan item rows are tagged with their slot", () => {
    const row = planItemRow("p1", { recipes: [{ recipeId: "pico", servingsMultiplier: 1 }], mealType: "lunch" }, byId, "Pico");
    expect(row.tags).toEqual(["lunch"]); // M9: "side" is a course tag (R4.28), replaced by the slot like the others
  });
  it("sides make a meal findable by side name, without changing protein or times (R5.9)", () => {
    const row = mealRow("m2", { name: "Fish", recipes: [{ recipeId: "pico", servingsMultiplier: 1 }], sides: [{ ingredientId: "fries", portion: 150 }], updatedAt: new Date(5) }, byId, (id) => (id === "fries" ? "frozen french fries" : undefined));
    expect(row.ingredientIds).toContain("fries");
    expect(row.ingredientNames).toContain("frozen french fries");
    expect(row).toMatchObject({ proteinPerServingG: 1, totalMin: 30 });
  });
  it("new meal keeps sides", () => {
    expect(newMeal("Fish", [{ recipeId: "a", servingsMultiplier: 1 }], "u1", [{ ingredientId: "fries", portion: 150 }]).sides).toEqual([{ ingredientId: "fries", portion: 150 }]);
    expect("sides" in newMeal("Fish", [{ recipeId: "a", servingsMultiplier: 1 }], "u1", [])).toBe(false);
  });
  it("new meal document", () => {
    expect(newMeal(" Taco night ", [{ recipeId: "a", servingsMultiplier: 2 }], "u1")).toEqual({ name: "Taco night", recipes: [{ recipeId: "a", servingsMultiplier: 2 }], createdBy: "u1", updatedBy: "u1" });
  });
});
