import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  deriveRecipe,
  fingerprint,
  formatProtein,
  lineText,
  lookupFrom,
  nextLineId,
  proteinPerServing,
  recipeSummary,
  refsIn,
  renderStep,
  renderStepText,
  scale,
  type RecipeContent,
  type RecipeIngredientInfo,
} from "./recipe";
import { normalizeName, singularize, slugify, ingredientSlug } from "./names";
import { reviewReasons, newIngredient, buildIngredientIndex, resolveIngredientName, guessCategory } from "./ingredient";
import type { RecipeDoc } from "./types";

const ING: Record<string, RecipeIngredientInfo> = {
  butter: { name: "butter", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.96, proteinPer100g: 0.9 },
  chicken: { name: "chicken breast", allowedMeasures: ["weight", "count"], canonicalUnit: "g", unitWeightG: 175, proteinPer100g: 31 },
  rice: { name: "rice", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 0.85, proteinPer100g: 7 },
  mystery: { name: "mystery sauce", allowedMeasures: ["weight", "volume"], canonicalUnit: "g" },
  salt: { name: "salt", allowedMeasures: ["weight", "volume"], canonicalUnit: "g", densityGPerMl: 1.2, proteinPer100g: 0 },
};
const lookup = lookupFrom(ING);

function content(over: Partial<RecipeContent> = {}): RecipeContent {
  return {
    title: "Chicken & Rice",
    servings: 4,
    prepMin: 10,
    cookMin: 30,
    cuisine: "american",
    mainProtein: "chicken",
    tags: ["dinner"],
    tools: [],
    ingredients: [
      { id: "l1", ingredientId: "chicken", amount: 4, measure: "count", canonicalAmount: 0, displayText: "chicken breasts", optional: false },
      { id: "l2", ingredientId: "rice", amount: 400, measure: "g", canonicalAmount: 0, displayText: "rice", optional: false },
      { id: "l3", ingredientId: "butter", amount: 2, measure: "tbsp", canonicalAmount: 0, displayText: "the butter", optional: false },
      { id: "l4", ingredientId: "salt", amount: 0, measure: "count", canonicalAmount: 0, displayText: "salt", optional: true },
    ],
    steps: [
      { text: "Melt {{ing:l3}} and fry {{ing:l1}}.", ingredientRefs: ["l3", "l1"], timerSeconds: 600 },
      { text: "Add {{ing:l2|200|g}}, then the rest of {{ing:l2|200|g}}. Season with {{ing:l4}}.", ingredientRefs: ["l2", "l4"] },
    ],
    prepTasks: [{ text: "Measure {{ing:l2}}", ingredientRefs: ["l2"] }],
    defaultLeftoverPortions: 0,
    imagePaths: [],
    ...over,
  };
}

describe("names", () => {
  it("normalises wording for matching", () => {
    expect(normalizeName("All-Purpose Flour")).toBe("all purpose flour");
    expect(normalizeName("Eggs")).toBe("egg");
    expect(normalizeName("boneless, skinless chicken breasts")).toBe("boneless skinless chicken breast");
    expect(normalizeName("Crème fraîche")).toBe("creme fraiche");
    expect(normalizeName("cherry tomatoes")).toBe("cherry tomato");
    expect(singularize("molasses")).toBe("molasses");
    expect(singularize("radishes")).toBe("radish");
    expect(singularize("berries")).toBe("berry");
    expect(ingredientSlug("Fine Sea Salt")).toBe("fine-sea-salt");
    expect(slugify("Mac & Cheese!")).toBe("mac-and-cheese");
  });
});

describe("ingredients", () => {
  it("needsReview reasons", () => {
    expect(reviewReasons({ allowedMeasures: ["weight", "volume"], canonicalUnit: "g" })).toEqual(["missingDensity", "missingProtein"]);
    expect(reviewReasons({ allowedMeasures: ["count"], canonicalUnit: "g", proteinPer100g: 2 })).toEqual(["missingUnitWeight"]);
    expect(reviewReasons({ allowedMeasures: ["count"], canonicalUnit: "count", proteinPer100g: 0 })).toEqual([]);
  });
  it("new ingredients get category defaults and are flagged", () => {
    const { id, doc } = newIngredient("Smoked Gouda");
    expect(id).toBe("smoked-gouda");
    expect(doc.needsReview).toBe(true);
    expect(guessCategory("chicken thighs")).toBe("meat");
    expect(guessCategory("ground cumin")).toBe("spices");
    expect(guessCategory("unicorn dust")).toBe("pantry");
  });
  it("resolves names and aliases, then without soft words", () => {
    const idx = buildIngredientIndex([
      { id: "egg", name: "egg", aliases: [] },
      { id: "basil", name: "basil", aliases: ["sweet basil"] },
      { id: "salt", name: "salt", aliases: ["fine sea salt", "table salt"] },
    ]);
    expect(resolveIngredientName("Eggs", idx)).toBe("egg");
    expect(resolveIngredientName("fresh basil", idx)).toBe("basil");
    expect(resolveIngredientName("Fine sea salt", idx)).toBe("salt");
    expect(resolveIngredientName("pepper", idx)).toBeNull();
  });
});

describe("protein per serving (§5, R6.15)", () => {
  it("sums canonical grams × protein ÷ servings; count uses unit weight; optional lines skipped", () => {
    // chicken 4 × 175 g × 31% = 217 g, rice 400 g × 7% = 28 g, butter 2 tbsp ≈ 28.4 g × 0.9% ≈ 0.26 g → ÷ 4
    const p = proteinPerServing(content(), lookup);
    expect(p.approximate).toBe(false);
    expect(p.grams).toBeCloseTo((217 + 28 + 0.2555) / 4, 1);
  });
  it("is approximate when a non-optional ingredient has no protein", () => {
    const c = content();
    c.ingredients.push({ id: "l5", ingredientId: "mystery", amount: 50, measure: "g", canonicalAmount: 0, displayText: "sauce", optional: false });
    const p = proteinPerServing(c, lookup);
    expect(p.approximate).toBe(true);
    expect(p.missing).toEqual(["mystery"]);
    expect(formatProtein(p.grams, p.approximate)).toMatch(/^~\d+ g$/);
  });
  it("is approximate when a conversion is missing", () => {
    const c = content({
      ingredients: [{ id: "l1", ingredientId: "chicken", amount: 1, measure: "cup", canonicalAmount: 0, displayText: "chicken", optional: false }],
    });
    expect(proteinPerServing(c, lookup)).toMatchObject({ approximate: true, grams: null });
  });
});

describe("derived fields", () => {
  it("fills canonical amounts, ids, slug, fingerprint, canonical URL", () => {
    const d = deriveRecipe(content({ sourceUrl: "https://www.Example.com/r/1/?utm_source=x&b=2&a=1#top" }), lookup);
    expect(d.slug).toBe("chicken-and-rice");
    expect(d.ingredients.map((l) => l.canonicalAmount)).toEqual([700, 400, expect.closeTo(28.39, 1), 0]);
    expect(d.ingredientIds).toEqual(["butter", "chicken", "rice", "salt"]);
    expect(d.sourceUrlCanonical).toBe("https://example.com/r/1?a=1&b=2");
    expect(d.proteinApproximate).toBe(false);
    expect(d.proteinPerServingG).toBeGreaterThan(60);
  });
});

describe("fingerprint and canonical URL", () => {
  it("fingerprint ignores servings scaling and line order, changes with amounts", () => {
    const a = deriveRecipe(content(), lookup);
    const doubled = deriveRecipe(scale({ ...content(), ingredients: a.ingredients }, 8), lookup);
    expect(doubled.fingerprint).toBe(a.fingerprint);
    const reordered = deriveRecipe(content({ ingredients: [...content().ingredients].reverse() }), lookup);
    expect(reordered.fingerprint).toBe(a.fingerprint);
    const more = content();
    more.ingredients[1] = { ...more.ingredients[1]!, amount: 800 };
    expect(deriveRecipe(more, lookup).fingerprint).not.toBe(a.fingerprint);
  });
  it("small rounding differences keep the fingerprint", () => {
    const x = fingerprint({ servings: 4, ingredients: [{ ingredientId: "rice", canonicalAmount: 400 } as never] });
    const y = fingerprint({ servings: 4, ingredients: [{ ingredientId: "rice", canonicalAmount: 404 } as never] });
    expect(x).toBe(y);
  });
  it("canonical URLs strip tracking, www, hash, trailing slash; sort params", () => {
    expect(canonicalUrl("http://www.foo.com/a/b/?fbclid=1&utm_medium=x")).toBe("https://foo.com/a/b");
    expect(canonicalUrl("https://foo.com/a?z=1&a=2")).toBe("https://foo.com/a?a=2&z=1");
    expect(canonicalUrl("not a url")).toBe("not a url");
  });
});

describe("steps and scaling (R4.11, R4.13)", () => {
  it("renders inline amounts where each ingredient is mentioned", () => {
    const c = content();
    const segs = renderStep(c.steps[0]!.text, c.ingredients, lookup);
    expect(segs[0]).toEqual({ kind: "text", text: "Melt " });
    expect(segs[1]).toMatchObject({ kind: "ingredient", name: "the butter", amount: "2 tbsp" });
    expect(renderStepText(c.steps[0]!.text, c.ingredients, lookup)).toBe(
      "Melt the butter (2 tbsp) and fry chicken breasts (4).",
    );
  });
  it("partial mentions show their own amount; name-only mentions show none", () => {
    const c = content();
    const segs = renderStep(c.steps[1]!.text, c.ingredients, lookup).filter((s) => s.kind === "ingredient");
    expect(segs.map((s) => s.kind === "ingredient" && s.amount)).toEqual(["200 g", "200 g", ""]);
  });
  it("scale multiplies amounts and partial placeholders", () => {
    const s = scale(content(), 8);
    expect(s.servings).toBe(8);
    expect(s.ingredients[1]!.amount).toBe(800);
    expect(s.steps[1]!.text).toContain("{{ing:l2|400|g}}");
    expect(lineText(content().ingredients[2]!, lookup, 2)).toEqual({ amount: "4 tbsp", name: "the butter" });
  });
  it("refsIn and nextLineId", () => {
    expect(refsIn(content().steps[1]!.text)).toEqual(["l2", "l4"]);
    expect(nextLineId(content().ingredients)).toBe("l5");
    expect(nextLineId([])).toBe("l1");
  });
});

describe("index summary (§9)", () => {
  it("keeps what search and filters need", () => {
    const c = content();
    const d = deriveRecipe(c, lookup);
    const doc = {
      ...c,
      ...d,
      status: "active",
      createdBy: "u",
      updatedBy: "u",
      version: 1,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
      imagePaths: ["recipes/r1/img1"],
    } as RecipeDoc;
    expect(recipeSummary("r1", doc)).toMatchObject({
      id: "r1",
      totalMin: 40,
      activeMin: 10,
      thumb: "recipes/r1/img1",
      ingredientNames: ["chicken breasts", "rice", "the butter", "salt"],
      createdAtMs: 1000,
    });
  });
});
