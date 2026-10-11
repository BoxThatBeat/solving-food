import { describe, expect, it } from "vitest";
import { effectiveSides, formatPortion, portionFromInput, portionInputUnit, portionToInput, type SideIngredient } from "./sides";

const fries: SideIngredient = { id: "fries", name: "french fries", canonicalUnit: "g", allowedMeasures: ["weight"], freeUse: false, side: { portion: 150 } };
const bun: SideIngredient = { id: "bun", name: "hamburger buns", canonicalUnit: "g", unitWeightG: 55, allowedMeasures: ["weight", "count"], freeUse: false, side: { portion: 55 } };
const egg: SideIngredient = { id: "egg", name: "eggs", canonicalUnit: "count", unitWeightG: 50, allowedMeasures: ["count"], freeUse: false };
const rice: SideIngredient = { id: "rice", name: "rice", canonicalUnit: "g", allowedMeasures: ["weight"], freeUse: false };

describe("effective sides (R11.14)", () => {
  it("seed sides, household flags, and overrides; sorted by name", () => {
    const list = effectiveSides([fries, bun, egg, rice], { fries: { portion: 200 }, rice: { portion: 75 } });
    expect(list.map((s) => [s.ingredient.id, s.portion, s.source, s.defaultPortion])).toEqual([
      ["fries", 200, "seed", 150],
      ["bun", 55, "seed", undefined],
      ["rice", 75, "household", undefined],
    ]);
  });
  it("an override equal to the seed portion isn't an override", () => {
    expect(effectiveSides([fries], { fries: { portion: 150 } })[0]!.defaultPortion).toBeUndefined();
  });
});

describe("portions in metric (R8.13)", () => {
  it("grams, units with their weight, counts", () => {
    expect(formatPortion(150, fries)).toBe("150 g");
    expect(formatPortion(55, bun)).toBe("1 (55 g)");
    expect(formatPortion(110, bun)).toBe("2 (110 g)");
    expect(formatPortion(40, bun)).toBe("40 g");
    expect(formatPortion(2, egg)).toBe("2 (100 g)");
  });
  it("edits in units where an ingredient is counted, grams otherwise; round trip", () => {
    expect(portionInputUnit(fries)).toBe("g");
    expect(portionInputUnit(bun)).toBe("count");
    expect(portionInputUnit(egg)).toBe("count");
    expect(portionToInput(110, bun)).toBe(2);
    expect(portionFromInput(2, bun)).toBe(110);
    expect(portionFromInput(175, fries)).toBe(175);
    expect(portionFromInput(3, egg)).toBe(3);
  });
});
