import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { groupTools, missingTools, TOOL_SYNONYMS, toolKey, toolLabel } from "./tools";
import { TOOL_SUGGESTIONS } from "./household";

describe("toolKey (R11.1, M7)", () => {
  it.each([
    ["Skillet", "skillet"],
    ["frying pan", "skillet"],
    ["large skillet", "skillet"],
    ["10-inch oven-safe skillet", "skillet"],
    ["large cast iron skillet", "skillet"],
    ["non-stick pan", "skillet"],
    ["large sauté pan", "skillet"],
    ["large high sided pan", "skillet"],
    ["pan", "skillet"],
    ["9x13-inch baking dish", "baking dish"],
    ["9 x 13 inch pan", "baking dish"],
    ["8x8 pan", "baking dish"],
    ["9x9 square pan", "baking dish"],
    ["8-inch or 9-inch baking pan", "baking dish"],
    ["8 by 8-inch baking pan", "baking dish"],
    ["large casserole dish", "baking dish"],
    ["disposable aluminum pans", "baking dish"],
    ["9x2-inch deep dish pie dish", "pie dish"],
    ["baking sheets", "sheet pan"],
    ["rimmed baking sheets", "sheet pan"],
    ["half sheet pan", "sheet pan"],
    ["large cookie sheet", "sheet pan"],
    ["baking tray", "sheet pan"],
    ["large pot", "pot"],
    ["3.5-quart oven-safe saucepan", "pot"],
    ["small saucepan", "pot"],
    ["soup pot", "pot"],
    ["Stock pot", "pot"],
    ["large shallow mixing bowl", "bowl"],
    ["microwave safe bowl", "bowl"],
    ["medium bowl", "bowl"],
    ["12-cup muffin pan", "muffin tin"],
    ["12 cavity muffin tray", "muffin tin"],
    ["12-count muffin tin", "muffin tin"],
    ["loaf tin", "loaf pan"],
    ["8-inch round cake pans", "cake pan"],
    ["wire cooling rack", "wire rack"],
    ["Instant Pot", "instant pot"],
    ["pressure cooker", "instant pot"],
    ["crockpot", "slow cooker"],
    ["mini food processor", "food processor"],
    ["electric mixer", "stand mixer"],
    ["hand mixer", "hand mixer"],
    ["high speed blender", "blender"],
    ["hand blender", "immersion blender"],
    ["box grater", "grater"],
    ["colander", "strainer"],
    ["digital meat thermometer", "thermometer"],
    ["sharp knife", "knife"],
    ["mason jars", "jar"],
    ["10-oz jar", "jar"],
    ["tongs", "tongs"],
    ["wooden skewers", "skewer"],
    ["Dutch oven", "dutch oven"],
    ["large wok", "wok"],
    ["Cast iron pan", "skillet"],
  ])("%s → %s", (name, key) => expect(toolKey(name)).toBe(key));

  it("every canonical name is its own key, and every synonym maps to it", () => {
    for (const [canon, alts] of Object.entries(TOOL_SYNONYMS)) {
      expect(toolKey(canon)).toBe(canon);
      for (const a of alts) expect(toolKey(a)).toBe(canon);
    }
  });

  it("the suggestion list holds one name per tool", () => {
    expect(new Set(TOOL_SUGGESTIONS.map(toolKey)).size).toBe(TOOL_SUGGESTIONS.length);
  });

  it("property: idempotent and case-insensitive", () => {
    const word = fc.constantFrom("large", "small", "9x13", "8-inch", "or", "baking", "sheet", "pan", "pans", "pot", "bowl", "dish", "Skillet", "frying", "knives", "oven-safe", "12", "cup", "tongs", "the", "instant", "mixer", "sauté");
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 5 }), (ws) => {
        const name = ws.join(" ");
        const k = toolKey(name);
        expect(toolKey(k)).toBe(k);
        expect(toolKey(name.toUpperCase())).toBe(k);
        expect(toolKey(name.toLowerCase())).toBe(k);
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: "grapheme-ascii", maxLength: 40 }), (name) => {
        const k = toolKey(name);
        expect(toolKey(k)).toBe(k);
        expect(toolKey(name.toUpperCase())).toBe(toolKey(name.toLowerCase()));
      }),
    );
  });
});

describe("missingTools / toolLabel / groupTools", () => {
  it("owning a skillet covers a frying pan; a wok is still missing", () => {
    expect(missingTools(["frying pan", "large wok", "9x13 baking dish"], ["Skillet", "Casserole dish"])).toEqual(["large wok"]);
  });
  it("labels are lower-case", () => {
    expect(toolLabel("  Instant   Pot ")).toBe("instant pot");
  });
  it("groups spellings under one chip, the canonical name first, the rest as 'also'", () => {
    const g = groupTools(["Frying pan", "skillet", "pan", "pan", "Wok", "large skillet"]);
    expect(g).toEqual([
      { key: "skillet", label: "skillet", also: ["pan", "frying pan", "large skillet"] },
      { key: "wok", label: "wok", also: [] },
    ]);
    // Without a canonical name the chip says the key, the plainest spelling.
    expect(groupTools(["Pasta machine", "pasta machines", "pasta machines"])[0]).toMatchObject({ label: "pasta machine", also: ["pasta machines"] });
    expect(groupTools(["large wok"])[0]).toMatchObject({ label: "wok", also: ["large wok"] });
  });
});
