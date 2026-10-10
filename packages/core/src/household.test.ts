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

import { buildInvite, inviteEmailSchema, inviteInbox, leaveConsequence, nextActiveHousehold, searchDirectory } from "./household";

describe("invites", () => {
  it("normalises invite emails and rejects bad ones", () => {
    expect(inviteEmailSchema.parse("  Sam@Example.COM ")).toBe("sam@example.com");
    expect(inviteEmailSchema.safeParse("nope").success).toBe(false);
    expect(inviteEmailSchema.safeParse("").success).toBe(false);
  });

  it("keys an invite by uid or by lower-cased email", () => {
    const ctx = { householdName: "Silbrass Pvt", invitedBy: "u1", invitedByName: "Aaron" };
    expect(buildInvite({ uid: "u2" }, ctx)).toEqual({ key: "u2", doc: { inviteeUid: "u2", ...ctx } });
    expect(buildInvite({ email: "Sam@X.com" }, ctx)).toEqual({ key: "sam@x.com", doc: { inviteeEmailLower: "sam@x.com", ...ctx } });
  });

  it("shows one invite per household and none for households I'm in", () => {
    const inv = [
      { hid: "a", key: "u2", householdName: "A" },
      { hid: "a", key: "sam@x.com", householdName: "A" },
      { hid: "b", key: "u2", householdName: "B" },
      { hid: "c", key: "u2", householdName: "C" },
    ];
    expect(inviteInbox(inv, ["c"]).map((i) => i.hid)).toEqual(["a", "b"]);
  });

  it("searches the directory by name, prefix matches first, skipping excluded people", () => {
    const dir = [
      { uid: "1", displayName: "Sam" },
      { uid: "2", displayName: "Samantha" },
      { uid: "3", displayName: "Isam" },
      { uid: "4", displayName: "Aaron" },
    ];
    expect(searchDirectory(dir, "sam", new Set(["2"])).map((d) => d.uid)).toEqual(["1", "3"]);
    expect(searchDirectory(dir, "  ", new Set())).toEqual([]);
  });

  it("warns the last member that leaving deletes the household (R2.13)", () => {
    expect(leaveConsequence(1)).toBe("deletesHousehold");
    expect(leaveConsequence(2)).toBe("leaves");
    expect(nextActiveHousehold("a", ["a", "b"])).toBe("b");
    expect(nextActiveHousehold("a", ["a"])).toBeNull();
  });
});
