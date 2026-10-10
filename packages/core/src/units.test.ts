import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  enterableMeasures,
  formatAmount,
  formatGrams,
  formatOriginal,
  formatOunces,
  formatQuantity,
  fromCanonical,
  parseUnit,
  toCanonical,
  unitLabel,
  UNITS,
  type ConvertibleIngredient,
} from "./units";

const flour: ConvertibleIngredient = { allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.53 };
const potato: ConvertibleIngredient = { allowedMeasures: ["weight", "count"], canonicalUnit: "g", unitWeightG: 213 };
const milk: ConvertibleIngredient = { allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 1.03 };
const bayLeaf: ConvertibleIngredient = { allowedMeasures: ["count"], canonicalUnit: "count" };
const garlic: ConvertibleIngredient = { allowedMeasures: ["weight", "count", "volume"], canonicalUnit: "g", unitWeightG: 5, densityGPerMl: 0.6 };

describe("parseUnit", () => {
  it.each([
    ["Tbsp", "tbsp"],
    ["tablespoons", "tbsp"],
    ["T", "tbsp"],
    ["teaspoon", "tsp"],
    ["cups", "cup"],
    ["oz", "oz"],
    ["ounces", "oz"],
    ["lbs", "lb"],
    ["pound", "lb"],
    ["qts", "quart"],
    ["pints", "pint"],
    ["g", "g"],
    ["", "count"],
    ["pinch", "pinch"],
  ])("%s → %s", (text, key) => {
    expect(parseUnit(text).measure).toBe(key);
  });

  it("keeps count nouns, singular", () => {
    expect(parseUnit("cloves")).toMatchObject({ measure: "clove", def: { kind: "count" } });
    expect(parseUnit("lemons").measure).toBe("lemon");
    expect(parseUnit("clove").measure).toBe("clove");
  });
});

describe("toCanonical (spec §5 examples)", () => {
  it('"2 medium potatoes" → 426 g', () => {
    expect(toCanonical(2, "count", potato)).toEqual({ ok: true, canonicalAmount: 426, canonicalUnit: "g" });
  });
  it('"1 cup flour" → ~125 g', () => {
    const r = toCanonical(1, "cup", flour);
    expect(r.ok && Math.round(r.canonicalAmount)).toBe(125);
  });
  it('"500 ml milk" → 515 g', () => {
    const r = toCanonical(500, "ml", milk);
    expect(r.ok && r.canonicalAmount).toBeCloseTo(515);
  });
  it("count nouns use the unit weight", () => {
    const r = toCanonical(2, "clove", garlic);
    expect(r.ok && r.canonicalAmount).toBe(10);
  });
  it("count-canonical ingredients keep counts", () => {
    expect(toCanonical(2, "count", bayLeaf)).toEqual({ ok: true, canonicalAmount: 2, canonicalUnit: "count" });
  });
  it("reports missing conversions and vague amounts", () => {
    expect(toCanonical(1, "cup", potato)).toEqual({ ok: false, reason: "missingDensity" });
    expect(toCanonical(1, "count", flour)).toEqual({ ok: false, reason: "missingUnitWeight" });
    expect(toCanonical(1, "pinch", flour)).toEqual({ ok: false, reason: "vague" });
  });
  it("weights convert by the static table", () => {
    const r = toCanonical(1, "lb", potato);
    expect(r.ok && r.canonicalAmount).toBeCloseTo(453.59);
    const oz = toCanonical(8, "oz", potato);
    expect(oz.ok && oz.canonicalAmount).toBeCloseTo(226.8, 1);
  });
});

describe("property: conversions", () => {
  const ingredient = fc.record({
    density: fc.double({ min: 0.05, max: 3, noNaN: true }),
    unitWeight: fc.double({ min: 0.5, max: 3000, noNaN: true }),
  });
  const measures = Object.values(UNITS).filter((u) => u.kind !== "vague").map((u) => u.key);

  it("round-trips through canonical within tolerance", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100_000, noNaN: true }), fc.constantFrom(...measures), ingredient, (amount, measure, i) => {
        const ing: ConvertibleIngredient = {
          allowedMeasures: ["weight", "volume", "count"],
          canonicalUnit: "g",
          densityGPerMl: i.density,
          unitWeightG: i.unitWeight,
        };
        const c = toCanonical(amount, measure, ing);
        expect(c.ok).toBe(true);
        if (!c.ok) return;
        const back = fromCanonical(c.canonicalAmount, measure, ing);
        expect(back).not.toBeNull();
        expect(Math.abs(back! - amount)).toBeLessThanOrEqual(1e-6 * Math.max(1, amount));
      }),
    );
  });

  it("is never negative, even for negative input", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.constantFrom(...measures), (amount, measure) => {
        const c = toCanonical(amount, measure, { ...garlic, allowedMeasures: ["weight", "volume", "count"] });
        if (c.ok) expect(c.canonicalAmount).toBeGreaterThanOrEqual(0);
        const back = fromCanonical(amount, measure, garlic);
        if (back !== null) expect(back).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("formatting never shows a minus sign", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e7, noNaN: true }), (g) => {
        expect(formatGrams(g)).not.toContain("-");
        expect(formatOunces(g)).not.toContain("-");
      }),
    );
  });
});

describe("formatting (R8.13)", () => {
  it("rounds metric per magnitude", () => {
    expect(formatGrams(2.46)).toBe("2.5 g");
    expect(formatGrams(45.4)).toBe("45 g");
    expect(formatGrams(125.4)).toBe("125 g");
    expect(formatGrams(426)).toBe("430 g");
    expect(formatGrams(1234)).toBe("1.2 kg");
    expect(formatGrams(2000)).toBe("2.0 kg");
    expect(formatGrams(12_345)).toBe("12 kg");
  });
  it("rounds imperial per magnitude", () => {
    expect(formatOunces(125)).toBe("4.4 oz");
    expect(formatOunces(426)).toBe("15 oz");
    expect(formatOunces(1200)).toBe("2.6 lb");
    expect(formatOunces(2000)).toBe("4.4 lb");
    expect(formatOunces(10)).toBe("0.4 oz");
  });
  it("matches the spec's examples", () => {
    expect(formatAmount(125.4, flour, { original: "1 cup flour" })).toBe("1 cup flour (125 g · 4.4 oz)");
    expect(formatAmount(426, potato, { original: "2 potatoes" })).toBe("2 potatoes (430 g · 15 oz)");
    expect(formatAmount(2000, flour)).toBe("2.0 kg · 4.4 lb");
  });
  it("count-only ingredients show the count", () => {
    expect(formatAmount(2, bayLeaf, { original: "2 bay leaves" })).toBe("2 bay leaves");
    expect(formatAmount(2, bayLeaf)).toBe("2");
  });
  it("kitchen fractions for spoons, cups and pieces; decimals for metric", () => {
    expect(formatQuantity(0.25, "cup")).toBe("¼");
    expect(formatQuantity(1.5, "cup")).toBe("1½");
    expect(formatQuantity(1 / 3, "tsp")).toBe("⅓");
    expect(formatQuantity(2, "count")).toBe("2");
    expect(formatQuantity(0.125, "tsp")).toBe("⅛");
    expect(formatQuantity(1.43, "cup")).toBe("1.43");
    expect(formatQuantity(1.37, "cup")).toBe("1⅜");
    expect(formatQuantity(226.8, "g")).toBe("227");
    expect(formatQuantity(1.25, "kg")).toBe("1.25");
  });
  it("original wording", () => {
    expect(formatOriginal(2, "clove")).toBe("2 cloves");
    expect(formatOriginal(1, "clove")).toBe("1 clove");
    expect(formatOriginal(0.5, "cup")).toBe("½ cup");
    expect(formatOriginal(2, "cup")).toBe("2 cups");
    expect(formatOriginal(2, "count")).toBe("2");
    expect(formatOriginal(0, "to taste")).toBe("to taste");
    expect(formatOriginal(1, "pinch")).toBe("1 pinch");
    expect(formatOriginal(0, "count")).toBe("");
    expect(unitLabel("tbsp", 3)).toBe("tbsp");
  });
});

describe("enterableMeasures (R8.3)", () => {
  it("only allowed measures that have a conversion", () => {
    expect(enterableMeasures(flour)).toEqual(["weight", "volume"]);
    expect(enterableMeasures({ ...potato, allowedMeasures: ["weight", "count", "volume"] })).toEqual(["weight", "count"]);
    expect(enterableMeasures(bayLeaf)).toEqual(["count"]);
  });
});
