import { describe, expect, it } from "vitest";
import type { RecipeSummary } from "@solving-food/core";
import { buildIndex, runQuery, toSearchDocs } from "./engine";

const r = (id: string, title: string, tags: string[], ingredientNames: string[]): RecipeSummary => ({
  id, title, tags, ingredientNames, cuisine: "greek", mainProtein: "chicken", proteinPerServingG: 30, proteinApproximate: false,
  ingredientIds: [], totalMin: 30, activeMin: 10, servings: 4, thumb: null, sourceUrlCanonical: null, fingerprint: id, createdAtMs: 0,
});

describe("recipe search (R4.1)", () => {
  const docs = toSearchDocs(
    [r("a", "Baked Feta Pasta", ["dinner", "pasta"], ["cherry tomatoes", "feta cheese"]), r("b", "Greek Salad", ["lunch"], ["cucumber", "feta"]), r("c", "Pumpkin Muffins", ["breakfast"], ["canned pumpkin"])],
    new Map([["c", "Grandma's favourite, double the cinnamon"]]),
  );
  const ms = buildIndex(docs);
  it("matches title, ingredients, tags, and household notes", () => {
    expect([...runQuery(ms, "feta")!.keys()].sort()).toEqual(["a", "b"]);
    expect([...runQuery(ms, "tomato")!.keys()]).toEqual(["a"]);
    expect([...runQuery(ms, "breakfast")!.keys()]).toEqual(["c"]);
    expect([...runQuery(ms, "grandma")!.keys()]).toEqual(["c"]);
  });
  it("prefix and typo tolerant; title outranks ingredients", () => {
    expect([...runQuery(ms, "muff")!.keys()]).toEqual(["c"]);
    expect([...runQuery(ms, "pumpkn")!.keys()]).toEqual(["c"]);
    expect([...runQuery(ms, "salad")!.keys()][0]).toBe("b");
  });
  it("empty query means no text filter", () => {
    expect(runQuery(ms, "  ")).toBeNull();
  });
});
