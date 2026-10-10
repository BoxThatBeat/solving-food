import { describe, expect, it } from "vitest";
import { themeVars } from "./apply";

describe("themeVars", () => {
  it("maps Latte + green to the prototype's tokens with the Classic look", () => {
    expect(themeVars({ flavour: "latte", accent: "green" })).toEqual({
      ink: "#4c4f69",
      sub: "#5c5f77",
      base: "#eff1f5",
      mantle: "#e6e9ef",
      pg: "#dce0e8",
      s0: "#ccd0da",
      onc: "#4c4f69",
      desk: "#bcc0cc",
      scrim: "rgba(76,79,105,.55)",
      line: "#4c4f69",
      acc: "#a6da95",
      bw: "0.1875rem",
      sh: "0.25rem",
      r: "0.375rem",
      tt: "none",
      tilt: "0deg",
    });
  });

  it("uses the flavour's ink as the line colour and the chosen accent", () => {
    const v = themeVars({ flavour: "mocha", accent: "peach" });
    expect(v.line).toBe("#cdd6f4");
    expect(v.acc).toBe("#f5a97f");
    expect(v.onc).toBe("#11111b");
  });
});
