import { describe, expect, it } from "vitest";
import {
  buildNewHousehold,
  canCreateHousehold,
  defaultHouseholdInput,
  pickActiveHousehold,
} from "./household";
import { householdSchema } from "./types";
import { DEFAULT_BUDGET_CENTS, DEFAULT_PCX_STORE_ID, DEFAULT_PERIOD_DAYS } from "./config";

const creator = { uid: "u1", displayName: "Aaron" };

describe("defaultHouseholdInput", () => {
  it("uses Home, 4 servings, all three meal types, and the detected timezone", () => {
    expect(defaultHouseholdInput("America/Vancouver")).toEqual({
      name: "Home",
      timezone: "America/Vancouver",
      defaultServings: 4,
      plannedMealTypes: ["breakfast", "lunch", "dinner"],
    });
  });

  it("falls back to America/Toronto when detection fails or is bogus", () => {
    expect(defaultHouseholdInput().timezone).toBe("America/Toronto");
    expect(defaultHouseholdInput("Mars/Olympus").timezone).toBe("America/Toronto");
  });
});

describe("buildNewHousehold", () => {
  it("builds a valid household with CAD, 7 days, $200, and the default store", () => {
    const { household, member } = buildNewHousehold(
      { name: "  Silbrass Pvt ", timezone: "America/Toronto", defaultServings: 2, plannedMealTypes: ["dinner", "lunch"] },
      creator,
    );
    expect(householdSchema.parse(household)).toBeTruthy();
    expect(household).toMatchObject({
      name: "Silbrass Pvt",
      createdBy: "u1",
      currency: "CAD",
      periodDays: DEFAULT_PERIOD_DAYS,
      budgetCents: DEFAULT_BUDGET_CENTS,
      pcxStoreId: DEFAULT_PCX_STORE_ID,
      defaultServings: 2,
      plannedMealTypes: ["lunch", "dinner"],
      currentPeriodId: null,
    });
    expect(member).toEqual({ uid: "u1", displayName: "Aaron" });
  });

  it("rejects an empty name, zero meal types, bad servings, and unknown timezones", () => {
    const ok = defaultHouseholdInput();
    expect(() => buildNewHousehold({ ...ok, name: " " }, creator)).toThrow();
    expect(() => buildNewHousehold({ ...ok, plannedMealTypes: [] }, creator)).toThrow();
    expect(() => buildNewHousehold({ ...ok, defaultServings: 0 }, creator)).toThrow();
    expect(() => buildNewHousehold({ ...ok, timezone: "Nowhere/Land" }, creator)).toThrow();
  });
});

describe("household limits and the active household", () => {
  it("allows creating up to 3 households", () => {
    expect([0, 1, 2, 3].map(canCreateHousehold)).toEqual([true, true, true, false]);
  });

  it("keeps the chosen household while still a member, else falls back to the first", () => {
    expect(pickActiveHousehold("b", ["a", "b"])).toBe("b");
    expect(pickActiveHousehold("gone", ["a", "b"])).toBe("a");
    expect(pickActiveHousehold(null, ["a"])).toBe("a");
    expect(pickActiveHousehold("a", [])).toBeNull();
  });
});
