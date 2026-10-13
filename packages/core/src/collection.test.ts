import { describe, expect, it } from "vitest";
import { activeFilterCount, applyCollection, collectionSearchSchema, isSideOnly, mealTypesOf, NO_FACTS, optionCount, passes, tagCounts, taxonomyLabel, toSearchParams, type HouseholdFacts } from "./collection";
import type { RecipeSummary } from "./recipe";

function r(id: string, over: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id,
    title: id,
    tags: ["dinner"],
    cuisine: "italian",
    mainProtein: "chicken",
    proteinPerServingG: 30,
    proteinApproximate: false,
    ingredientIds: [],
    ingredientNames: [],
    totalMin: 30,
    activeMin: 10,
    servings: 4,
    thumb: null,
    sourceUrlCanonical: null,
    fingerprint: id,
    createdAtMs: 0,
    ...over,
  };
}

const all = [
  r("Alpha", { cuisine: "greek", totalMin: 20, proteinPerServingG: 40, createdAtMs: 3, tags: ["dinner", "feta"] }),
  r("Bravo", { mainProtein: "fish", totalMin: 50, activeMin: 25, proteinPerServingG: 10, createdAtMs: 1, tags: ["lunch"] }),
  r("Charlie", { cuisine: "greek", mainProtein: "dairy", proteinPerServingG: null, createdAtMs: 2, tags: ["breakfast", "muffins"] }),
];
const facts: Record<string, HouseholdFacts> = {
  Alpha: { favourite: true, timesCooked: 3, lastCookedAtMs: 100, rating: 9 },
  Bravo: { favourite: false, timesCooked: 1, lastCookedAtMs: 200, rating: 7 },
};
const factsOf = (id: string) => facts[id] ?? NO_FACTS;
const ids = (s: object, m: Map<string, number> | null = null) => applyCollection(all, collectionSearchSchema.parse(s), factsOf, m).items.map((x) => x.id);

describe("<CollectionView> filters and sorts (R4.2, R4.7)", () => {
  it("default sort is Suggested = newest until M5", () => {
    expect(ids({})).toEqual(["Alpha", "Charlie", "Bravo"]);
  });
  it("filters by cuisine, main protein, meal type, tags", () => {
    expect(ids({ cuisine: "greek" })).toEqual(["Alpha", "Charlie"]);
    expect(ids({ protein: "fish,dairy" })).toEqual(["Charlie", "Bravo"]);
    expect(ids({ meal: "breakfast" })).toEqual(["Charlie"]);
    expect(ids({ tags: "feta" })).toEqual(["Alpha"]);
  });
  it("filters by protein, total time, active time", () => {
    expect(ids({ minProtein: 25 })).toEqual(["Alpha"]);
    expect(ids({ maxTotal: 30 })).toEqual(["Alpha", "Charlie"]);
    expect(ids({ maxActive: 15 })).toEqual(["Alpha", "Charlie"]);
  });
  it("filters by household facts: rating, cooked before / never, favourites", () => {
    expect(ids({ minRating: 8 })).toEqual(["Alpha"]);
    expect(ids({ cooked: "before" })).toEqual(["Alpha", "Bravo"]);
    expect(ids({ cooked: "never" })).toEqual(["Charlie"]);
    expect(ids({ fav: true })).toEqual(["Alpha"]);
  });
  it("sorts", () => {
    expect(ids({ sort: "name" })).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(ids({ sort: "quickest" })).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(ids({ sort: "protein" })).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(ids({ sort: "rating" })).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(ids({ sort: "made" })).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(ids({ sort: "recent" })).toEqual(["Bravo", "Alpha", "Charlie"]);
  });
  it("text matches restrict and order by relevance unless a sort is chosen", () => {
    const m = new Map([["Bravo", 5], ["Charlie", 9]]);
    expect(ids({}, m)).toEqual(["Charlie", "Bravo"]);
    expect(ids({ sort: "name" }, m)).toEqual(["Bravo", "Charlie"]);
  });
  it("URL round trip drops unknowns and empties", () => {
    const s = collectionSearchSchema.parse({ cuisine: "greek,martian", sort: "bogus", minProtein: "25", fav: "true", q: "" });
    expect(s).toMatchObject({ cuisine: ["greek"], sort: undefined, minProtein: 25, fav: true });
    expect(toSearchParams(s)).toEqual({ cuisine: "greek", minProtein: 25, fav: true });
    expect(activeFilterCount(s)).toBe(3);
  });
  it("option counts ignore the option's own group", () => {
    const s = collectionSearchSchema.parse({ cuisine: "greek" });
    expect(optionCount(all, s, factsOf, null, "cuisine", "italian")).toBe(1);
    expect(optionCount(all, s, factsOf, null, "protein", "dairy")).toBe(1);
    expect(passes(all[1]!, s, NO_FACTS, "cuisine")).toBe(true);
  });
  it("tag counts exclude meal types; labels", () => {
    expect(tagCounts(all)).toEqual([["feta", 1], ["muffins", 1]]);
    expect(taxonomyLabel("middle-eastern")).toBe("Middle Eastern");
  });
});

describe("M2 filters: has all tools, cost per serving, Cheapest", () => {
  const f: Record<string, HouseholdFacts> = {
    Alpha: { ...NO_FACTS, hasAllTools: false, costPerServingCents: 150 },
    Bravo: { ...NO_FACTS, hasAllTools: true, costPerServingCents: 450 },
    Charlie: { ...NO_FACTS, hasAllTools: true, costPerServingCents: null },
  };
  const run = (s: object) => applyCollection(all, collectionSearchSchema.parse(s), (id) => f[id] ?? NO_FACTS).items.map((x) => x.id);
  it("filters", () => {
    expect(run({ tools: "true" })).toEqual(["Charlie", "Bravo"]);
    expect(run({ maxCost: "200" })).toEqual(["Alpha"]);
    expect(run({ maxCost: "600" })).toEqual(["Alpha", "Bravo"]); // unknown cost never passes a cost filter
    expect(activeFilterCount(collectionSearchSchema.parse({ tools: "1", maxCost: "400" }))).toBe(2);
  });
  it("sorts cheapest first, unknown last", () => {
    expect(run({ sort: "cheapest" })).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
  it("missingTools is case-insensitive", async () => {
    const { missingTools } = await import("./collection");
    expect(missingTools(["Instant Pot", "Wok"], ["instant pot "])).toEqual(["Wok"]);
  });
});

describe("supply filters (R4.3, R4.4)", () => {
  it("can make and Use what's left read the household's supply facts", async () => {
    const { passes, collectionSearchSchema, activeFilterCount } = await import("./collection");
    const r: RecipeSummary = { id: "r", title: "x", tags: [], cuisine: "other", mainProtein: "none", proteinPerServingG: 1, proteinApproximate: false, ingredientIds: [], ingredientNames: [], totalMin: 1, activeMin: 1, servings: 1, thumb: null, sourceUrlCanonical: null, fingerprint: "f", createdAtMs: 0 };
    const base = { favourite: false, timesCooked: 0, lastCookedAtMs: null, rating: null };
    const can = collectionSearchSchema.parse({ supply: "can" });
    const use = collectionSearchSchema.parse({ supply: "useup" });
    expect(passes({ ...r }, can, { ...base, canMake: true, supplyFraction: 1 })).toBe(true);
    expect(passes({ ...r }, can, { ...base, canMake: false, supplyFraction: 0.9 })).toBe(false);
    expect(passes({ ...r }, use, { ...base, canMake: false, supplyFraction: 0.9 })).toBe(true);
    expect(passes({ ...r }, use, { ...base, canMake: false, supplyFraction: 0.5 })).toBe(false);
    expect(activeFilterCount(use)).toBe(1);
    expect(collectionSearchSchema.parse({ supply: "bogus" }).supply).toBeUndefined();
  });
});

describe("meal type (course) tags, side recipes (M9: R4.2, R4.28)", () => {
  const withSide = [...all, r("Delta", { tags: ["side", "rice"] }), r("Echo", { tags: ["lunch", "side"] })];
  const ids2 = (s: object) => applyCollection(withSide, collectionSearchSchema.parse(s), factsOf, null).items.map((x) => x.id);
  it("side is a meal type option, not a tag", () => {
    expect(ids2({ meal: "side" })).toEqual(["Delta", "Echo"]);
    expect(collectionSearchSchema.parse({ meal: "side,brunch" }).meal).toEqual(["side"]);
    expect(tagCounts(withSide).map(([t]) => t)).not.toContain("side");
    expect(mealTypesOf({ tags: ["Side", "rice"] })).toEqual(["side"]);
  });
  it("side-only means tagged side and nothing else", () => {
    expect(isSideOnly({ tags: ["side", "rice"] })).toBe(true);
    expect(isSideOnly({ tags: ["lunch", "side"] })).toBe(false);
    expect(isSideOnly({ tags: ["dinner"] })).toBe(false);
    expect(isSideOnly({ tags: [] })).toBe(false);
  });
});
