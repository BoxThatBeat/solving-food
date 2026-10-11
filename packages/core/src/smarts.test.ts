// M5 core: preferences and diets, staples cadence, expiry alerts.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addPref, brokenDiets, DIETS, formatPref, matchesPref, parsePref, preferenceBlock, prefLabel, type PrefRecipe } from "./preferences";
import { cadenceInterval, duePrompts, isDue, snoozeUntil, updateCadence } from "./cadence";
import { expiryAlerts, recipesUsing } from "./alerts";
import { snoozeCadencePayload } from "./commands";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 16);

const META: Record<string, { category: string; name: string }> = {
  "chicken-breast": { category: "meat", name: "chicken breast" },
  "salmon-fillet": { category: "fish", name: "salmon fillet" },
  milk: { category: "dairy", name: "milk" },
  eggs: { category: "dairy", name: "eggs" },
  "all-purpose-flour": { category: "baking", name: "all-purpose flour" },
  "rice-flour": { category: "baking", name: "rice flour" },
  "peanut-butter": { category: "pantry", name: "peanut butter" },
  bacon: { category: "meat", name: "bacon" },
  shrimp: { category: "fish", name: "shrimp" },
  tofu: { category: "produce", name: "tofu" },
  olives: { category: "produce", name: "olives" },
};
const meta = (id: string) => META[id];

function r(over: Partial<PrefRecipe> = {}): PrefRecipe {
  return { title: "Dish", cuisine: "italian", mainProtein: "none", tags: [], ingredientIds: [], ...over };
}

describe("preferences", () => {
  it("parses and formats typed entries", () => {
    expect(parsePref("cuisine:italian")).toEqual({ kind: "cuisine", value: "italian" });
    expect(parsePref("cuisine:atlantis")).toBeNull();
    expect(parsePref("protein:pork")).toEqual({ kind: "protein", value: "pork" });
    expect(parsePref("nonsense")).toBeNull();
    expect(parsePref("text:")).toBeNull();
    expect(formatPref({ kind: "text", value: "  Olive " })).toBe("text:olive");
  });

  it("labels chips", () => {
    expect(prefLabel("cuisine:middle-eastern")).toBe("Middle Eastern");
    expect(prefLabel("ingredient:salmon-fillet", (id) => META[id]?.name)).toBe("Salmon fillet");
    expect(prefLabel("text:olive")).toBe("“olive”");
  });

  it("matches cuisine, protein, ingredient, and words in title, tags, wording, and ingredient names", () => {
    const x = r({ title: "Olive tapenade pasta", cuisine: "french", mainProtein: "fish", tags: ["Quick"], ingredientIds: ["salmon-fillet"], ingredientNames: ["kalamata olives"] });
    expect(matchesPref(x, "cuisine:french")).toBe(true);
    expect(matchesPref(x, "protein:fish")).toBe(true);
    expect(matchesPref(x, "ingredient:salmon-fillet")).toBe(true);
    expect(matchesPref(x, "text:kalamata")).toBe(true);
    expect(matchesPref(x, "text:quick")).toBe(true);
    expect(matchesPref(x, "text:salmon", meta)).toBe(true);
    expect(matchesPref(x, "text:beef", meta)).toBe(false);
  });

  it("diets: vegetarian, vegan, pescatarian, gluten-free, dairy-free, nut-free, no pork, no shellfish", () => {
    const chicken = r({ mainProtein: "chicken", ingredientIds: ["chicken-breast"] });
    const salmon = r({ mainProtein: "fish", ingredientIds: ["salmon-fillet"] });
    const cake = r({ ingredientIds: ["all-purpose-flour", "eggs", "milk"] });
    const riceCake = r({ ingredientIds: ["rice-flour"] });
    const satay = r({ mainProtein: "tofu", ingredientIds: ["tofu", "peanut-butter"] });
    expect(brokenDiets(chicken, ["vegetarian", "pescatarian"], meta)).toEqual(["Vegetarian", "Pescatarian"]);
    expect(brokenDiets(salmon, ["vegetarian", "pescatarian"], meta)).toEqual(["Vegetarian"]);
    expect(brokenDiets(cake, ["vegan", "vegetarian", "gluten-free", "dairy-free"], meta)).toEqual(["Vegan", "Gluten-free", "Dairy-free"]);
    expect(brokenDiets(riceCake, ["gluten-free"], meta)).toEqual([]);
    expect(brokenDiets(satay, ["vegan", "nut-free"], meta)).toEqual(["Nut-free"]);
    expect(brokenDiets(r({ ingredientIds: ["bacon"] }), ["no-pork"], meta)).toEqual(["No pork"]);
    expect(brokenDiets(r({ ingredientIds: ["shrimp"] }), ["no-shellfish"], meta)).toEqual(["No shellfish"]);
    expect(DIETS.map((d) => d.key)).toContain("vegan");
  });

  it("preferenceBlock names the diet or the dislike", () => {
    const x = r({ ingredientIds: ["olives", "chicken-breast"], mainProtein: "chicken" });
    expect(preferenceBlock(x, { likes: [], dislikes: ["ingredient:olives"], diets: [] }, meta, (id) => META[id]?.name)).toBe("Disliked: olives");
    expect(preferenceBlock(x, { likes: [], dislikes: ["ingredient:olives"], diets: ["vegetarian"] }, meta)).toBe("Not vegetarian");
    expect(preferenceBlock(x, { likes: ["ingredient:olives"], dislikes: [], diets: [] }, meta)).toBeNull();
  });

  it("addPref dedupes and ignores junk", () => {
    expect(addPref(["cuisine:thai"], "cuisine:thai")).toEqual(["cuisine:thai"]);
    expect(addPref([], "junk")).toEqual([]);
    expect(addPref([], "text:olive")).toEqual(["text:olive"]);
  });
});

describe("staples cadence", () => {
  it("EMA of purchase gaps; the seed interval until bought twice", () => {
    let c = updateCadence(null, NOW);
    expect(c).toEqual({ avgIntervalDays: null, lastPurchasedAtMs: NOW, purchaseCount: 1 });
    expect(cadenceInterval(c, 7)).toBe(7);
    c = updateCadence(c, NOW + 6 * DAY);
    expect(c.avgIntervalDays).toBe(6);
    c = updateCadence(c, NOW + 16 * DAY);
    expect(c.avgIntervalDays).toBe(8);
    expect(cadenceInterval(c, 7)).toBe(8);
    expect(cadenceInterval(null, undefined)).toBeNull();
  });

  it("isDue at 85 % of the interval, not while snoozed, never without a purchase or an interval", () => {
    const c = { avgIntervalDays: null, lastPurchasedAtMs: NOW, purchaseCount: 1 };
    const milk = { defaultCadenceDays: 10 };
    expect(isDue(c, milk, NOW + 8 * DAY)).toBe(false);
    expect(isDue(c, milk, NOW + 8.5 * DAY)).toBe(true);
    expect(isDue({ ...c, snoozedUntilMs: NOW + 9 * DAY }, milk, NOW + 8.6 * DAY)).toBe(false);
    expect(isDue({ ...c, snoozedUntilMs: NOW + 9 * DAY }, milk, NOW + 9.1 * DAY)).toBe(true);
    expect(isDue(c, {}, NOW + 100 * DAY)).toBe(false);
    expect(isDue(null, milk, NOW)).toBe(false);
  });

  it("snooze is a quarter interval, at least a day", () => {
    expect(snoozeUntil({ avgIntervalDays: 8, purchaseCount: 3 }, {}, NOW)).toBe(NOW + 2 * DAY);
    expect(snoozeUntil(null, { defaultCadenceDays: 2 }, NOW)).toBe(NOW + DAY);
  });

  it("due prompts: staples and free-use only, not already on a list, most overdue first", () => {
    const ings: Record<string, { defaultCadenceDays?: number; isStaple?: boolean; freeUse?: boolean }> = {
      milk: { defaultCadenceDays: 7, isStaple: true },
      "olive-oil": { defaultCadenceDays: 60, freeUse: true },
      salmon: { defaultCadenceDays: 7 },
      eggs: { defaultCadenceDays: 14, isStaple: true },
    };
    const at = (d: number) => ({ avgIntervalDays: null, lastPurchasedAtMs: NOW - d * DAY, purchaseCount: 1 });
    const p = duePrompts(
      [
        { ingredientId: "milk", c: at(7) },
        { ingredientId: "olive-oil", c: at(55) },
        { ingredientId: "salmon", c: at(30) },
        { ingredientId: "eggs", c: at(20) },
      ],
      (id) => ings[id],
      new Set(["eggs"]),
      NOW,
    );
    expect(p.map((x) => x.ingredientId)).toEqual(["milk", "olive-oil"]);
    expect(p[0]).toMatchObject({ intervalDays: 7, daysSince: 7 });
  });

  it("the snooze command payload", () => {
    expect(snoozeCadencePayload.parse({ ingredientId: "milk", until: NOW })).toEqual({ ingredientId: "milk", until: NOW });
    expect(() => snoozeCadencePayload.parse({ ingredientId: "milk" })).toThrow();
  });

  it("isDue never fires before 85 % of the interval (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), fc.double({ min: 0, max: 0.849, noNaN: true }), (days, share) => {
        expect(isDue({ avgIntervalDays: null, lastPurchasedAtMs: NOW, purchaseCount: 1 }, { defaultCadenceDays: days }, NOW + share * days * DAY)).toBe(false);
      }),
    );
  });
});

describe("expiry alerts", () => {
  const spare = new Map([
    ["salmon-fillet", { amount: 340, daysLeft: 2, expiresMs: NOW + 2 * DAY, lotIds: ["s1"] }],
    ["spinach", { amount: 5, daysLeft: 1, expiresMs: NOW + DAY, lotIds: ["p1"] }],
    ["eggs", { amount: 4, daysLeft: 3, expiresMs: NOW + 3 * DAY, lotIds: ["e1", "e2"] }],
    ["milk", { amount: 500, daysLeft: 0, expiresMs: NOW + 0.5 * DAY, lotIds: ["m1"] }],
  ]);
  const unit = (id: string) => (id === "eggs" ? ("count" as const) : ("g" as const));

  it("skips tiny amounts and dismissed lots; soonest first", () => {
    expect(expiryAlerts(spare, new Set(), unit).map((a) => a.ingredientId)).toEqual(["milk", "salmon-fillet", "eggs"]);
    expect(expiryAlerts(spare, new Set(["m1", "e1"]), unit).map((a) => a.ingredientId)).toEqual(["salmon-fillet", "eggs"]);
    expect(expiryAlerts(spare, new Set(["m1", "e1", "e2"]), unit).map((a) => a.ingredientId)).toEqual(["salmon-fillet"]);
  });

  it("recipes that use more of it come first", () => {
    const base = { cuisine: "x", mainProtein: "fish", tags: [], servings: 4, proteinPerServingG: 20 };
    const list = recipesUsing(
      "salmon-fillet",
      340,
      [
        { ...base, id: "a", title: "A", ingredientIds: ["salmon-fillet"], lines: { "salmon-fillet": 40 } },
        { ...base, id: "b", title: "B", ingredientIds: ["salmon-fillet"], lines: { "salmon-fillet": 100 } },
        { ...base, id: "c", title: "C", ingredientIds: ["rice"], lines: { rice: 100 } },
      ],
      4,
    );
    expect(list.map((x) => [x.recipe.id, x.uses])).toEqual([
      ["b", 340],
      ["a", 160],
    ]);
  });
});

describe("PC Express shapes", async () => {
  const { parsePackageSize, priceDocId } = await import("./pcx");
  it("reads pack sizes", () => {
    expect(parsePackageSize("400 g")).toEqual({ packAmount: 400, packMeasure: "weight" });
    expect(parsePackageSize("1.5 kg")).toEqual({ packAmount: 1500, packMeasure: "weight" });
    expect(parsePackageSize("946 mL")).toEqual({ packAmount: 946, packMeasure: "volume" });
    expect(parsePackageSize("4 L")).toEqual({ packAmount: 4000, packMeasure: "volume" });
    expect(parsePackageSize("6x355 mL")).toEqual({ packAmount: 2130, packMeasure: "volume" });
    expect(parsePackageSize("2 x 170 g")).toEqual({ packAmount: 340, packMeasure: "weight" });
    expect(parsePackageSize("12 ea")).toEqual({ packAmount: 12, packMeasure: "count" });
    expect(parsePackageSize("about a bunch")).toBeNull();
    expect(parsePackageSize(undefined)).toBeNull();
  });
  it("price doc IDs", () => {
    expect(priceDocId("1032", "20123_EA")).toBe("1032_20123_EA");
    expect(priceDocId("a/b", "c")).toBe("a-b_c");
  });
});
