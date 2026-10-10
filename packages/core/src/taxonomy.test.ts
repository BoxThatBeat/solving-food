import { describe, expect, it } from "vitest";
import { CUISINES, MAIN_PROTEINS, MEAL_TYPES, PLANNABLE_MEAL_TYPES } from "./taxonomy";

describe("taxonomy", () => {
  it.each([
    ["cuisine", CUISINES],
    ["main protein", MAIN_PROTEINS],
    ["meal type", MEAL_TYPES],
  ] as const)("%s list is non-empty, unique, lower-case slugs", (_name, list) => {
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list).size).toBe(list.length);
    for (const v of list) expect(v).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("has an escape hatch in each recipe list", () => {
    expect(CUISINES).toContain("other");
    expect(MAIN_PROTEINS).toContain("none");
  });

  it("plannable meal types are meal types without snack", () => {
    expect(PLANNABLE_MEAL_TYPES).toEqual(MEAL_TYPES.filter((t) => t !== "snack"));
  });
});
