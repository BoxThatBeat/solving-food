import { describe, expect, it } from "vitest";
import { describeMatch, findDuplicates, jaccard, titleSimilarity } from "./dedupe";

const tikka = {
  id: "r1",
  title: "Chicken tikka traybake",
  ingredientIds: ["chicken-thigh", "yogurt", "garam-masala", "onion", "pepper", "garlic", "ginger", "lemon", "rice", "cilantro"],
  sourceUrlCanonical: "https://example.com/tikka",
  fingerprint: "fp1",
};
const salmon = {
  id: "r2",
  title: "Roasted Salmon With Tomatoes",
  ingredientIds: ["salmon", "tomato", "olive-oil", "salt"],
  sourceUrlCanonical: null,
  fingerprint: "fp2",
};

describe("dedupe (§9, R4.20)", () => {
  it("title similarity is 1 for equal titles modulo case and punctuation", () => {
    expect(titleSimilarity("Baked Feta Pasta", "baked feta-pasta!")).toBe(1);
    expect(titleSimilarity("Baked Feta Pasta", "Greek Salad")).toBeLessThan(0.2);
  });

  it("same canonical source URL is a duplicate whatever the title", () => {
    const m = findDuplicates({ title: "Totally different", ingredientIds: [], sourceUrlCanonical: "https://example.com/tikka", fingerprint: "x" }, [tikka, salmon]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: "r1", reasons: ["sourceUrl"] });
  });

  it("near-identical title and ingredient set is a duplicate", () => {
    const m = findDuplicates(
      { title: "Chicken Tikka Traybake!", ingredientIds: [...tikka.ingredientIds.slice(0, 9), "salt"], fingerprint: "z" },
      [tikka, salmon],
    );
    expect(m[0]).toMatchObject({ id: "r1", reasons: ["similar"] });
  });

  it("near miss: same title, different ingredients is not", () => {
    expect(findDuplicates({ title: "Chicken tikka traybake", ingredientIds: ["tofu", "rice", "pepper"], fingerprint: "q" }, [tikka])).toEqual([]);
  });

  it("near miss: similar ingredients, different title is not", () => {
    expect(findDuplicates({ title: "Sheet-pan curry chicken", ingredientIds: tikka.ingredientIds, fingerprint: "q" }, [tikka])).toEqual([]);
  });

  it("near miss: one word changed in a short title stays under the threshold", () => {
    expect(titleSimilarity("Pumpkin Muffins", "Oatmeal Muffins")).toBeLessThan(0.8);
  });

  it("same fingerprint is a duplicate", () => {
    const m = findDuplicates({ title: "Fish", ingredientIds: salmon.ingredientIds, fingerprint: "fp2" }, [tikka, salmon]);
    expect(m[0]!.reasons).toContain("fingerprint");
  });

  it("never matches itself", () => {
    expect(findDuplicates(tikka, [tikka])).toEqual([]);
  });

  it("describes the match for the review list", () => {
    const [m] = findDuplicates({ title: "Chicken Tikka Sheet-Pan", ingredientIds: tikka.ingredientIds.slice(0, 9), sourceUrlCanonical: tikka.sourceUrlCanonical, fingerprint: "n" }, [tikka]);
    expect(describeMatch(m!)).toBe("Same source URL and 90% the same ingredients as Chicken tikka traybake.");
  });

  it("jaccard of empty sets is 1", () => {
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(["a"], ["b"])).toBe(0);
  });
});
