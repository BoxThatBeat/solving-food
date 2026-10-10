import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cooklangToRecipe, CooklangError, parseAmount, parseCooklang, parseDuration, recipeToCooklang, validateFrontMatter, cooklangFilename } from "./index";
import { buildIngredientIndex, resolveIngredientName } from "../ingredient";
import { ingredientSlug } from "../names";
import type { RecipeContent } from "../recipe";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const recipesDir = join(root, "data/recipes/cooklang");
const files = readdirSync(recipesDir).filter((f) => f.endsWith(".cook")).sort();
const read = (f: string) => readFileSync(join(recipesDir, f), "utf8");
const bySlug = { resolve: (n: string) => ingredientSlug(n) };

const SPEC_EXAMPLE = `---
title: Sheet-Pan Salmon with Potatoes
servings: 4
cuisine: nordic
main_protein: fish
leftover_portions: 2
prep_time: 15 minutes
cook_time: 30 minutes
source: https://example.com/salmon
image: https://example.com/salmon.jpg
tags: [weeknight, one-pan]
---

Preheat the #oven to 220°C.

Toss @baby potatoes{600%g} with @olive oil{2%tbsp} and @salt{} on a #sheet pan{}. Roast ~{15%minutes}.

Add @salmon fillet{600%g} and @lemon{1}, sliced. Roast ~{12%minutes} more.
`;

describe("parser", () => {
  it("reads the spec's example (§9)", () => {
    const r = cooklangToRecipe(SPEC_EXAMPLE, bySlug);
    expect(r.content).toMatchObject({
      title: "Sheet-Pan Salmon with Potatoes",
      servings: 4,
      cuisine: "nordic",
      mainProtein: "fish",
      prepMin: 15,
      cookMin: 30,
      tags: ["weeknight", "one-pan"],
      tools: ["oven", "sheet pan"],
      defaultLeftoverPortions: 2,
      leftoverMealType: "lunch",
      sourceUrl: "https://example.com/salmon",
    });
    expect(r.frontMatter.image).toBe("https://example.com/salmon.jpg");
    expect(r.content.ingredients.map((l) => [l.displayText, l.amount, l.measure, l.optional])).toEqual([
      ["baby potatoes", 600, "g", false],
      ["olive oil", 2, "tbsp", false],
      ["salt", 0, "count", true],
      ["salmon fillet", 600, "g", false],
      ["lemon", 1, "count", false],
    ]);
    expect(r.content.steps.map((s) => [s.text, s.timerSeconds])).toEqual([
      ["Preheat the oven to 220°C.", undefined],
      ["Toss {{ing:l1}} with {{ing:l2}} and {{ing:l3}} on a sheet pan. Roast 15 minutes.", 900],
      ["Add {{ing:l4}} and {{ing:l5}}, sliced. Roast 12 minutes more.", 720],
    ]);
  });

  it("amounts: fractions, mixed, unicode, ranges", () => {
    expect(parseAmount("1/2")).toBe(0.5);
    expect(parseAmount("1 1/2")).toBe(1.5);
    expect(parseAmount("1½")).toBe(1.5);
    expect(parseAmount("¾")).toBe(0.75);
    expect(parseAmount("2-3")).toBe(2.5);
    expect(parseAmount("0.25")).toBe(0.25);
    expect(parseAmount("a few")).toBeNull();
  });

  it("durations", () => {
    expect(parseDuration("5 minutes")).toBe(5);
    expect(parseDuration("1 hour 30 minutes")).toBe(90);
    expect(parseDuration("2 hours")).toBe(120);
    expect(parseDuration("1h30m")).toBe(90);
    expect(parseDuration("PT45M")).toBe(45);
    expect(parseDuration(20)).toBe(20);
    expect(parseDuration("soon")).toBeNull();
  });

  it("single-word ingredients, optional modifier, notes, comments, sections, legacy metadata", () => {
    const doc = parseCooklang(`>> title: X
= Dough
Mix @flour{2%cups} with @?salt and @egg{1}(beaten). -- trailing note
[- block
comment -]
-- line comment
> a note`);
    expect(doc.frontMatter).toEqual({ title: "X" });
    expect(doc.comments).toEqual(["block\ncomment", "trailing note", "line comment", "a note"]);
    expect(doc.steps[0]!.section).toBe("Dough");
    const ings = doc.steps[0]!.items.filter((i) => i.type === "ingredient");
    expect(ings).toEqual([
      { type: "ingredient", name: "flour", quantity: { amount: 2, text: "2", unit: "cups" }, optional: false },
      { type: "ingredient", name: "salt", quantity: { amount: null, text: "", unit: "" }, optional: true },
      { type: "ingredient", name: "egg", quantity: { amount: 1, text: "1", unit: "" }, optional: false, note: "beaten" },
    ]);
  });

  it("sums an ingredient listed twice and keeps each mention's amount", () => {
    const r = cooklangToRecipe(
      `---\ntitle: T\nservings: 2\ncuisine: other\nmain_protein: none\nprep_time: 1 minutes\ncook_time: 1 minutes\ntags: [snack]\n---\nAdd @water{1%cup}.\n\nAdd @water{2%tbsp} and @water{} again.`,
      bySlug,
    );
    expect(r.content.ingredients).toHaveLength(1);
    expect(r.content.ingredients[0]!.amount).toBeCloseTo(1.125);
    expect(r.content.ingredients[0]!.measure).toBe("cup");
    expect(r.content.steps.map((s) => s.text)).toEqual(["Add {{ing:l1|1|cup}}.", "Add {{ing:l1|2|tbsp}} and {{ing:l1|0|}} again."]);
  });

  it("rejects bad files with a readable reason", () => {
    expect(() => cooklangToRecipe("no front matter, @egg{1}", bySlug)).toThrow(/Front matter: missing title/);
    expect(() => cooklangToRecipe(SPEC_EXAMPLE.replace("nordic", "martian"), bySlug)).toThrow(/cuisine must be one of/);
    expect(() => cooklangToRecipe(SPEC_EXAMPLE.replace("@lemon{1}", "@lemon{1"), bySlug)).toThrow(CooklangError);
    expect(() => cooklangToRecipe("---\ntitle: [unclosed\n---\n", bySlug)).toThrow(/valid YAML/);
    const noIng = SPEC_EXAMPLE.split("---\n").slice(0, 2).join("---\n") + "---\nJust stir.";
    expect(() => cooklangToRecipe(noIng, bySlug)).toThrow(/no @ingredients/);
  });

  it("front matter validation names every problem", () => {
    const r = validateFrontMatter({ title: "x", servings: "lots", cuisine: "Italian", main_protein: "chicken", prep_time: "5 minutes", tags: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("servings");
      expect(r.error).toContain("missing cook_time");
      expect(r.error).not.toContain("cuisine");
    }
  });

  it("filenames are kebab-case of the title", () => {
    expect(cooklangFilename("Grandma's Egg Fried Rice!")).toBe("grandma-s-egg-fried-rice.cook");
  });
});

describe("the 28 household recipes (data/recipes)", () => {
  it("there are 28", () => expect(files).toHaveLength(28));

  it.each(files)("%s imports", (f) => {
    const r = cooklangToRecipe(read(f), bySlug);
    expect(r.content.ingredients.length).toBeGreaterThan(0);
    expect(r.content.steps.length).toBeGreaterThan(0);
    for (const s of r.content.steps) expect(s.text).not.toMatch(/[@#~]\{|\{[^{]*%/);
  });

  it("quirks: salt and pepper are two tokens; images with spaces survive; comments become notes", () => {
    const tandoori = cooklangToRecipe(read("grilled-tandoori-chicken-skewers.cook"), bySlug).content;
    expect(tandoori.ingredients.find((l) => l.ingredientId === "plain-yogurt")).toMatchObject({ amount: 2.5, measure: "cup" });
    expect(tandoori.steps[0]!.section).toBe("Tandoori Chicken");
    expect(tandoori.steps.at(-2)!.section).toBe("Tzatziki Sauce");
    const brownies = cooklangToRecipe(read("chocolate-peppermint-kiss-cookies.cook"), bySlug);
    expect(brownies.content.notes).toContain("peppermint extract");
    const spaced = files.map((f) => cooklangToRecipe(read(f), bySlug).frontMatter.image).filter((i) => i?.includes(" "));
    expect(spaced.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files)("%s: export ∘ import is stable", (f) => {
    const a = cooklangToRecipe(read(f), bySlug).content;
    const b = cooklangToRecipe(recipeToCooklang(a), bySlug).content;
    expect(b).toEqual(a);
  });

  const ingredientsDir = join(root, "data/ingredients");
  const seed = existsSync(ingredientsDir)
    ? readdirSync(ingredientsDir)
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => JSON.parse(readFileSync(join(ingredientsDir, f), "utf8")) as Array<{ id: string; name: string; aliases: string[] }>)
    : [];
  it.skipIf(seed.length === 0)("every ingredient they mention exists in data/ingredients", () => {
    const idx = buildIngredientIndex(seed);
    const missing = new Set<string>();
    for (const f of files) {
      const r = cooklangToRecipe(read(f), { resolve: (n) => resolveIngredientName(n, idx) });
      for (const n of r.newIngredients) missing.add(`${f}: ${n.doc.name}`);
    }
    expect([...missing]).toEqual([]);
  });
});

describe("property: recipeToCooklang ∘ cooklangToRecipe is stable", () => {
  const word = fc.stringMatching(/^[a-z]{3,8}$/);
  const line = fc.record({
    name: word,
    amount: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 40 }).map((n) => n / 4)),
    unit: fc.constantFrom("", "g", "cup", "tbsp", "tsp", "oz", "clove", "ml"),
  });
  it("for generated recipes", () => {
    fc.assert(
      fc.property(fc.uniqueArray(line, { minLength: 1, maxLength: 6, selector: (l) => l.name }), fc.integer({ min: 1, max: 12 }), (lines, servings) => {
        const body = lines.map((l) => `Add @${l.name}{${l.amount > 0 ? `${l.amount}${l.unit ? `%${l.unit}` : ""}` : ""}} and stir ~{5%minutes}.`).join("\n\n");
        const src = `---\ntitle: Generated\nservings: ${servings}\ncuisine: other\nmain_protein: none\nprep_time: 5 minutes\ncook_time: 10 minutes\ntags: [dinner]\n---\n${body}\n`;
        const a: RecipeContent = cooklangToRecipe(src, bySlug).content;
        const b = cooklangToRecipe(recipeToCooklang(a), bySlug).content;
        expect(b).toEqual(a);
      }),
      { numRuns: 60 },
    );
  });
});
