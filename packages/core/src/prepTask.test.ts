import { describe, expect, it } from "vitest";
import { renderPrepTask } from "./prepTask";
import { lookupFrom, type RecipeIngredient, type RecipeIngredientInfo, type StepSegment } from "./recipe";

const ING: Record<string, RecipeIngredientInfo> = {
  garlic: { name: "garlic", allowedMeasures: ["weight", "count"], canonicalUnit: "g", unitWeightG: 5 },
  basil: { name: "basil", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.1 },
  thyme: { name: "thyme", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.2 },
  cheese: { name: "cottage cheese", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 1 },
  chicken: { name: "chicken thigh", allowedMeasures: ["weight", "count"], canonicalUnit: "g", unitWeightG: 120 },
  onion: { name: "onion", allowedMeasures: ["weight", "count"], canonicalUnit: "g", unitWeightG: 150 },
  butter: { name: "butter", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.96 },
  chips: { name: "chocolate chips", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.7 },
};
const lookup = lookupFrom(ING);
const line = (id: string, ingredientId: string, amount: number, measure: string, displayText: string): RecipeIngredient => ({ id, ingredientId, amount, measure, canonicalAmount: 0, displayText, optional: false });
const LINES = [
  line("l1", "garlic", 5, "clove", "garlic"),
  line("l2", "basil", 0.25, "cup", "basil"),
  line("l3", "thyme", 1, "tbsp", "fresh thyme"),
  line("l4", "cheese", 450, "g", "cottage cheese"),
  line("l5", "chicken", 2, "lb", "chicken thighs"),
  line("l6", "onion", 1, "count", "onion"),
  line("l7", "butter", 1, "cup", "butter"),
  line("l8", "chips", 1, "cup", "chocolate chips"),
];
const text = (segs: StepSegment[]) => segs.map((s) => (s.kind === "text" ? s.text : `${s.name}[${s.amount}]`)).join("");

describe("renderPrepTask (M29, R4.42)", () => {
  it("a name without a quantity gets the recipe line's amount, in one unit system (R8.13)", () => {
    expect(text(renderPrepTask("Dice the onion", LINES, lookup))).toBe("Dice the onion[1]");
    expect(text(renderPrepTask("Pat the chicken thighs dry", LINES, lookup))).toBe("Pat the chicken thighs[900 g] dry");
  });
  it("a quantity written before the name becomes the badge, with a count noun after it", () => {
    expect(text(renderPrepTask("Mince 5 garlic cloves", LINES, lookup))).toBe("Mince garlic[5 cloves]");
    expect(text(renderPrepTask("Chop 0.25 cup basil, plus more for serving", LINES, lookup))).toBe("Chop basil[¼ cup], plus more for serving");
    expect(text(renderPrepTask("Blend 450 g cottage cheese", LINES, lookup))).toBe("Blend cottage cheese[450 g]");
  });
  it("scales with the servings, including a part of a line ('set aside')", () => {
    expect(text(renderPrepTask("Mince 5 garlic cloves", LINES, lookup, 2))).toBe("Mince garlic[10 cloves]");
    expect(text(renderPrepTask("Set aside 0.25 cup chocolate chips for topping", LINES, lookup, 2))).toBe("Set aside chocolate chips[½ cup] for topping");
    expect(text(renderPrepTask("Soften butter", LINES, lookup, 0.5))).toBe("Soften butter[½ cup]");
  });
  it("finds a name without its preparation words, and several names in one task", () => {
    const segs = renderPrepTask("Chop thyme and basil", LINES, lookup);
    expect(text(segs)).toBe("Chop thyme[1 tbsp] and basil[¼ cup]");
    expect(segs.filter((s) => s.kind === "ingredient").map((s) => s.kind === "ingredient" && s.lineId)).toEqual(["l3", "l2"]);
  });
  it("leaves tasks without ingredients alone, Fahrenheit only", () => {
    expect(text(renderPrepTask("Preheat the oven to 220°C", LINES, lookup))).toBe("Preheat the oven to 430°F");
    expect(text(renderPrepTask("Line a tray with parchment", LINES, lookup))).toBe("Line a tray with parchment");
  });
  it("doesn't match inside a word", () => {
    expect(text(renderPrepTask("Grease the onionskin paper", LINES, lookup))).toBe("Grease the onionskin paper");
  });
  it("editor tasks with placeholders render like steps", () => {
    expect(text(renderPrepTask("Measure {{ing:l4}}", LINES, lookup, 2))).toBe("Measure cottage cheese[900 g]");
  });
});
