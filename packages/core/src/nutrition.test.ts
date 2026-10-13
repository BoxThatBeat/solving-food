import { describe, expect, it } from "vitest";
import { deriveRecipe, lookupFrom, nutritionPerServing, type RecipeContent, type RecipeIngredientInfo } from "./recipe";
import { nutritionFacts, roundCalories, roundFat, roundGrams, roundMilligrams } from "./nutrition";
import { ingredientSchema, recipeSchema } from "./types";

const ING: Record<string, RecipeIngredientInfo> = {
  chicken: { name: "chicken breast", allowedMeasures: ["weight", "count"], canonicalUnit: "g", unitWeightG: 175, proteinPer100g: 31, nutrients: { kcal: 120, fatG: 2.6, satFatG: 0.6, carbG: 0, sugarsG: 0, sodiumMg: 70, cholesterolMg: 73, ironMg: 0.4 } },
  rice: { name: "rice", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.85, proteinPer100g: 7, nutrients: { kcal: 360, fatG: 0.6, satFatG: 0.2, carbG: 80, sugarsG: 0.1, sodiumMg: 5, ironMg: 4.3 } },
  butter: { name: "butter", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.96, proteinPer100g: 0.9 },
};

function content(over: Partial<RecipeContent> = {}): RecipeContent {
  return {
    title: "Chicken & Rice",
    servings: 4,
    prepMin: 10,
    cookMin: 30,
    cuisine: "american",
    mainProtein: "chicken",
    tags: ["dinner"],
    tools: [],
    ingredients: [
      { id: "l1", ingredientId: "chicken", amount: 4, measure: "count", canonicalAmount: 0, displayText: "chicken breasts", optional: false },
      { id: "l2", ingredientId: "rice", amount: 400, measure: "g", canonicalAmount: 0, displayText: "rice", optional: false },
    ],
    steps: [{ text: "Cook.", ingredientRefs: [] }],
    prepTasks: [],
    defaultLeftoverPortions: 0,
    imagePaths: [],
    ...over,
  };
}

describe("nutrition per serving (M10, R4.30)", () => {
  it("is Σ grams × per-100 g ÷ servings for every nutrient, count lines by unit weight", () => {
    const { nutrition, approximate } = nutritionPerServing(content(), lookupFrom(ING));
    // 700 g chicken + 400 g rice, 4 servings.
    expect(nutrition!.kcal).toBeCloseTo((7 * 120 + 4 * 360) / 4, 1);
    expect(nutrition!.carbG).toBeCloseTo((4 * 80) / 4, 2);
    expect(nutrition!.sodiumMg).toBeCloseTo((7 * 70 + 4 * 5) / 4, 1);
    // Cholesterol: only chicken knows it → approximate; potassium: nobody → left out.
    expect(nutrition!.cholesterolMg).toBeCloseTo((7 * 73) / 4, 1);
    expect(approximate).toContain("cholesterolMg");
    expect(nutrition!.potassiumMg).toBeUndefined();
    expect(approximate).not.toContain("kcal");
  });

  it("marks every nutrient approximate when an ingredient has no data, and deriveRecipe stores it", () => {
    const withButter = content({ ingredients: [...content().ingredients, { id: "l3", ingredientId: "butter", amount: 2, measure: "tbsp", canonicalAmount: 0, displayText: "butter", optional: false }] });
    const d = deriveRecipe(withButter, lookupFrom(ING));
    expect(d.nutrition?.kcal).toBeCloseTo((7 * 120 + 4 * 360) / 4, 1);
    expect(d.nutritionApproximate).toContain("kcal");
    expect(recipeSchema.shape.nutrition.parse(d.nutrition)).toEqual(d.nutrition);
    // Nobody has nutrients yet (before the upload): no nutrition at all.
    const none = deriveRecipe(content(), lookupFrom({ chicken: { ...ING.chicken!, nutrients: undefined }, rice: { ...ING.rice!, nutrients: undefined } }));
    expect(none.nutrition).toBeUndefined();
    expect(none.nutritionApproximate).toBeUndefined();
  });

  it("skips optional lines without making it approximate", () => {
    const opt = content({ ingredients: [...content().ingredients, { id: "l3", ingredientId: "butter", amount: 2, measure: "tbsp", canonicalAmount: 0, displayText: "butter", optional: true }] });
    expect(nutritionPerServing(opt, lookupFrom(ING)).approximate).toEqual(["cholesterolMg"]);
  });

  it("validates on ingredients", () => {
    expect(ingredientSchema.shape.nutrients.parse({ kcal: 120, sodiumMg: 70 })).toEqual({ kcal: 120, sodiumMg: 70 });
    expect(() => ingredientSchema.shape.nutrients.parse({ kcal: -1 })).toThrow();
  });
});

describe("nutrition facts table (Canadian label)", () => {
  it("rounds like Health Canada's rules", () => {
    expect(roundCalories(3.4)).toBe(3);
    expect(roundCalories(47)).toBe(45);
    expect(roundCalories(456)).toBe(460);
    expect(roundFat(0.34)).toBe(0.3);
    expect(roundFat(3.3)).toBe(3.5);
    expect(roundFat(12.6)).toBe(13);
    expect(roundGrams(0.4)).toBe(0);
    expect(roundGrams(7.6)).toBe(8);
    expect(roundMilligrams(3.2)).toBe(3);
    expect(roundMilligrams(72)).toBe(70);
    expect(roundMilligrams(456)).toBe(460);
  });

  it("lists rows in label order with % daily values and ~ for approximate ones", () => {
    const f = nutritionFacts({
      nutrition: { kcal: 563.4, fatG: 15.2, satFatG: 6.1, transFatG: 0.4, carbG: 40.2, sugarsG: 5.5, sodiumMg: 690, cholesterolMg: 101, ironMg: 2.7 },
      nutritionApproximate: ["sodiumMg"],
      proteinPerServingG: 42.3,
      fibrePerServingG: 3.6,
    })!;
    expect(f.calories).toBe("560");
    expect(f.rows.map((r) => r.label)).toEqual(["Fat", "Saturated", "+ Trans", "Carbohydrate", "Fibre", "Sugars", "Protein", "Cholesterol", "Sodium", "Iron"]);
    const row = (l: string) => f.rows.find((r) => r.label === l)!;
    expect(row("Fat")).toMatchObject({ amount: "15 g", dv: "20 %", sub: false });
    expect(row("Saturated")).toMatchObject({ amount: "6 g", dv: "33 %", sub: true }); // (6.1 + 0.4) / 20
    expect(row("Carbohydrate").dv).toBeNull();
    expect(row("Fibre")).toMatchObject({ amount: "4 g", dv: "13 %" });
    expect(row("Sodium")).toMatchObject({ amount: "~690 mg", dv: "30 %", approximate: true });
    expect(row("Cholesterol")).toMatchObject({ amount: "100 mg", dv: null });
    expect(row("Iron")).toMatchObject({ amount: "2.7 mg", dv: "15 %" });
    expect(f.approximate).toBe(true);
  });

  it("is null without data", () => {
    expect(nutritionFacts({ proteinPerServingG: 30 })).toBeNull();
  });
});
