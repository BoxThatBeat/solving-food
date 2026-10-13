import { describe, expect, it } from "vitest";
import { buildProfile, normalizeEmail } from "./profile";
import { landingPath } from "./landing";
import { userSchema } from "./types";

describe("buildProfile", () => {
  it("creates the user and directory docs with a trimmed name and lower-cased email", () => {
    const { user, directory } = buildProfile({ email: " BuitenwerfA@Gmail.com ", displayName: "  Aaron B " });
    expect(userSchema.parse(user)).toBeTruthy();
    expect(user).toEqual({
      email: "buitenwerfa@gmail.com",
      activeHouseholdId: null,
      householdsCreated: 0,
      theme: { flavour: "latte", accent: "green" },
    });
    expect(directory).toEqual({ displayName: "Aaron B", displayNameLower: "aaron b" });
  });

  it("keeps a chosen theme and rejects blank or very long names", () => {
    expect(buildProfile({ email: "a@b.co", displayName: "A", theme: { flavour: "mocha", accent: "mauve" } }).user.theme) // M9: Latte only
      .toEqual({ flavour: "latte", accent: "mauve" });
    expect(() => buildProfile({ email: "a@b.co", displayName: "   " })).toThrow();
    expect(() => buildProfile({ email: "a@b.co", displayName: "x".repeat(41) })).toThrow();
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  A@B.CO")).toBe("a@b.co");
  });
});

describe("landingPath", () => {
  it("goes to Plan only when the current period has items", () => {
    expect(landingPath(true)).toBe("/plan");
    expect(landingPath(false)).toBe("/recipes");
  });
});
