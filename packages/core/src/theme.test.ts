import { describe, expect, it } from "vitest";
import { ACCENTS, DEFAULT_THEME, FLAVOURS, normalizeTheme } from "./theme";

describe("theme", () => {
  it("defaults to Latte with the green accent", () => {
    expect(DEFAULT_THEME).toEqual({ flavour: "latte", accent: "green" });
  });

  it("lists four flavours and twelve unique accents", () => {
    expect(FLAVOURS).toHaveLength(4);
    expect(new Set(ACCENTS).size).toBe(12);
  });

  it("normalizes junk to the default and keeps valid values", () => {
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme({ flavour: "solarized", accent: 3 })).toEqual(DEFAULT_THEME);
    expect(normalizeTheme({ flavour: "mocha", accent: "peach" })).toEqual({ flavour: "mocha", accent: "peach" });
  });
});
