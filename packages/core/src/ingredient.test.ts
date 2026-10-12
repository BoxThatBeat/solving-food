// Ingredient matching (Planning/M8 item 1): the tiers of `matchIngredient`, spelling variants, new-ingredient names and
// IDs, suggestions, and the 62 ingredients the live drop-folder imports created before M8 (flagged needs-review).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildIngredientIndex,
  cleanIngredientName,
  matchIngredient,
  newIngredient,
  newIngredientId,
  PREP_WORDS,
  resolveIngredientName,
  SPELLING_VARIANTS,
  STATE_WORDS,
  suggestIngredients,
  variantKey,
  type IndexEntry,
} from "./ingredient";
import { normalizeName } from "./names";

const root = join(__dirname, "../../..");
const dir = join(root, "data/ingredients");
const seed: Array<IndexEntry & { category: string }> = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<IndexEntry & { category: string }>)
  : [];
const seedIndex = buildIngredientIndex(seed);

/** The 62 needs-review ingredients in the live project (2026-10-11), as the drop folder created them. */
const LIVE_NEEDS_REVIEW: Array<[id: string, name: string]> = [
  ["brewed-coffee", "brewed coffee"],
  ["butter-bean", "butter beans"],
  ["cacao-nib", "cacao nibs"],
  ["caesar-salad", "caesar salad"],
  ["candy-cane", "candy cane"],
  ["canned-chicken", "canned chicken"],
  ["caramelized-onion", "caramelized onions"],
  ["chipotle-mayo", "chipotle mayo"],
  ["chocolate", "chocolate"],
  ["chocolate-shaving", "chocolate shavings"],
  ["ciabatta-roll", "ciabatta roll"],
  ["coconut-amino", "coconut aminos"],
  ["coconut-sugar", "coconut sugar"],
  ["colby-jack-cheese", "colby jack cheese"],
  ["comte-cheese", "comté cheese"],
  ["cranberry", "cranberries"],
  ["cranberry-sauce", "cranberry sauce"],
  ["dark-chocolate", "dark chocolate"],
  ["diced-green-chile", "diced green chiles"],
  ["diced-green-chili", "diced green chilies"],
  ["dried-mint", "dried mint"],
  ["egg-yolk", "egg yolk"],
  ["fajita-seasoning", "fajita seasoning"],
  ["fresh-berry", "fresh berries"],
  ["fresh-fruit", "fresh fruit"],
  ["frozen-tater-tot", "frozen tater tots"],
  ["garlic-sausage", "garlic sausage"],
  ["ghee", "ghee"],
  ["gouda-cheese", "gouda cheese"],
  ["graham-cracker", "graham cracker"],
  ["grilled-cheese-sandwich", "grilled cheese sandwich"],
  ["ground-fennel-seed", "ground fennel seeds"],
  ["havarti-cheese", "havarti cheese"],
  ["hawaiian-roll", "hawaiian rolls"],
  ["kalamata-olive", "kalamata olives"],
  ["kodiak-dark-chocolate-power-cake-pancake-mix", "kodiak dark chocolate power cakes pancake mix"],
  ["lettuce", "lettuce"],
  ["m-and-m-s", "m&m's"],
  ["m-and-ms", "m&ms"],
  ["mild-green-chile", "mild green chiles"],
  ["milk-chocolate", "milk chocolate"],
  ["nut-butter", "nut butter"],
  ["pasta", "pasta"],
  ["pastina", "pastina"],
  ["pickled-red-onion", "pickled red onions"],
  ["poppy-seed", "poppy seeds"],
  ["pretzel", "pretzels"],
  ["red-enchilada-sauce", "red enchilada sauce"],
  ["seasoned-salt", "seasoned salt"],
  ["shredded-cheese", "shredded cheese"],
  ["smash-sauce", "smash sauce"],
  ["sumac", "sumac"],
  ["sumac-onion", "sumac onions"],
  ["sun-dried-tomato", "sun-dried tomatoes"],
  ["sun-dried-tomato-oil", "sun-dried tomato oil"],
  ["tzatziki", "tzatziki"],
  ["unsweetened-applesauce", "unsweetened applesauce"],
  ["vanilla-bean", "vanilla beans"],
  ["vanilla-bean-paste", "vanilla bean paste"],
  ["vegan-cream-cheese", "vegan cream cheese"],
  ["whipped-cream", "whipped cream"],
  ["white-chocolate", "white chocolate"],
];

/**
 * What each resolves to against the catalogue plus the other 61 (itself excluded). Only these have a counterpart; the
 * rest are new foods (egg yolk is not egg, dark chocolate is not chocolate chips, dried mint is not fresh mint, canned
 * chicken is not a raw cut, lettuce and cranberries are ambiguous) and stay for review with suggestions.
 */
const LIVE_EXPECTED: Record<string, [id: string, confidence: "exact" | "variant" | "soft"]> = {
  "frozen tater tots": ["tater-tot", "exact"],
  "diced green chiles": ["diced-green-chili", "variant"],
  "diced green chilies": ["diced-green-chile", "variant"],
  "m&m's": ["m-and-ms", "variant"],
  "m&ms": ["m-and-m-s", "variant"],
};

describe.skipIf(seed.length === 0)("matchIngredient against the catalogue", () => {
  const cases: Array<[wording: string, id: string | null, confidence?: string]> = [
    ["chicken thigh", "chicken-thigh", "exact"],
    ["Chicken Thighs", "chicken-thigh", "exact"],
    ["chopped chicken thighs", "chicken-thigh", "soft"],
    ["chicken thighs, boneless skinless", "chicken-thigh", "soft"],
    ["chopped chicken thighs, boneless", "chicken-thigh", "soft"],
    ["boneless skinless chicken thighs", "chicken-thigh", "exact"],
    ["butter (softened)", "butter", "soft"],
    ["unsalted butter, at room temperature", "unsalted-butter", "soft"],
    ["finely chopped fresh cilantro", "fresh-cilantro", "soft"],
    ["salt, to taste", "salt", "soft"],
    ["thinly sliced red onion", "red-onion", "soft"],
    ["ripe bananas", "banana", "exact"],
    ["peeled and cubed potatoes", null],
    ["cubed potatoes", "potato", "soft"],
    ["frozen tater tots", "tater-tot", "exact"],
    ["ground beef", "lean-ground-beef", "exact"],
    ["beef mince", "lean-ground-beef", "exact"],
    ["lamb mince", "ground-lamb", "exact"],
    ["minced turkey", "ground-turkey", "exact"],
    ["veal mince", null],
    ["ground cumin", "ground-cumin", "exact"],
    ["freshly ground black pepper", "black-pepper", "exact"],
    ["courgettes", "zucchini", "exact"],
    ["aubergines", "eggplant", "exact"],
    ["spring onions", "green-onion", "exact"],
    ["scallions, thinly sliced", "green-onion", "soft"],
    ["red capsicum", "red-bell-pepper", "exact"],
    ["garbanzo beans", "canned-chickpea", "exact"],
    ["garbanzos", "canned-chickpea", "variant"],
    ["confectioners' sugar", "icing-sugar", "exact"],
    ["powdered sugar", "icing-sugar", "exact"],
    ["cornflour", "cornstarch", "exact"],
    ["rocket", "arugula", "exact"],
    ["prawns", "large-shrimp", "exact"],
    ["greek yoghurt", "greek-yogurt", "exact"],
    ["fresh coriander", "fresh-cilantro", "exact"],
    ["coriander leaves", "fresh-cilantro", "exact"],
    ["chilli powder", "chili-powder", "exact"],
    ["chillie powder", null],
    ["chilly powder", "chili-powder", "variant"],
    ["sweet chile sauce", "sweet-chili-sauce", "variant"],
    ["tomatoes", "tomato", "exact"],
    ["bay leaves", "bay-leaf", "exact"],
    ["cherry tomatoes, halved", "cherry-tomato", "soft"],
    ["frozen strawberries", "frozen-strawberry", "exact"],
    ["canned black beans, drained", "canned-black-bean", "soft"],
    ["dried oregano", "dried-oregano", "exact"],
    // No false merges.
    ["dark chocolate", null],
    ["egg yolk", null],
    ["egg yolks", null],
    ["dried mint", null],
    ["canned chicken", null],
    ["beef", null],
    ["chocolate", null],
    ["cooked rice", null],
    ["brewed coffee", null],
    ["lettuce", null],
    ["cranberries", null],
  ];
  it.each(cases)("%s → %s", (wording, id, confidence) => {
    const m = matchIngredient(wording, seedIndex);
    expect(m.id).toBe(id);
    if (id) expect(m.confidence).toBe(confidence);
    expect(resolveIngredientName(wording, seedIndex)).toBe(id);
  });

  it("every catalogue name and alias resolves to its own ingredient, exactly", () => {
    for (const i of seed) {
      for (const n of [i.name, ...i.aliases]) expect([n, matchIngredient(n, seedIndex)]).toEqual([n, { id: i.id, confidence: "exact" }]);
    }
  });

  it("no two catalogue ingredients share a spelling-variant key", () => {
    const owner = new Map<string, string>();
    for (const i of seed) {
      for (const n of [i.name, ...i.aliases]) {
        const k = variantKey(normalizeName(n));
        expect([k, owner.get(k) ?? i.id]).toEqual([k, i.id]);
        owner.set(k, i.id);
      }
    }
  });

  // Catalogue names that contain no preparation or state word, so decorating them is unambiguous.
  const plain = seed.filter((i) => {
    const words = ` ${normalizeName(i.name)} `;
    return [...PREP_WORDS, ...STATE_WORDS].every((w) => !words.includes(` ${normalizeName(w)} `));
  });
  const prepOnly = PREP_WORDS.filter((w) => !w.includes(" ") || w === "to taste" || w === "for serving");

  it("property: preparation words before a name, or a qualifier after it, resolve to the same ingredient", () => {
    fc.assert(
      fc.property(fc.constantFrom(...plain), fc.constantFrom(...prepOnly), fc.constantFrom(...prepOnly), fc.boolean(), (i, a, b, upper) => {
        const decorated = `${a} ${i.name}, ${b}`;
        const wording = upper ? decorated.toUpperCase() : decorated;
        const key = normalizeName(`${a} ${i.name}`);
        // A decorated name can itself be another catalogue name ("large shrimp", "fresh mint"); then that one wins.
        const expected = seedIndex.get(key) ?? i.id;
        expect(matchIngredient(wording, seedIndex).id).toBe(expected);
      }),
      { numRuns: 400 },
    );
  });

  it("property: matching ignores case and is the same for a name's spelling variants", () => {
    fc.assert(
      fc.property(fc.constantFrom(...seed), (i) => {
        const r = matchIngredient(i.name.toUpperCase(), seedIndex);
        expect(r.id).toBe(i.id);
        expect(matchIngredient(variantKey(normalizeName(i.name)), seedIndex).id).toBe(i.id);
      }),
      { numRuns: 300 },
    );
  });
});

describe.skipIf(seed.length === 0)("the 62 live needs-review ingredients", () => {
  const live: IndexEntry[] = LIVE_NEEDS_REVIEW.map(([id, name]) => ({ id, name, aliases: [], needsReview: true }));
  const index = buildIngredientIndex([...seed, ...live]);

  it.each(LIVE_NEEDS_REVIEW)("%s (%s)", (id, name) => {
    const m = matchIngredient(name, index, { exclude: id });
    const want = LIVE_EXPECTED[name];
    expect(m).toEqual(want ? { id: want[0], confidence: want[1] } : { id: null, confidence: null });
  });

  it("against the catalogue alone, only frozen tater tots has a counterpart", () => {
    const hits = LIVE_NEEDS_REVIEW.map(([, name]) => [name, resolveIngredientName(name, seedIndex)]).filter(([, id]) => id);
    expect(hits).toEqual([["frozen tater tots", "tater-tot"]]);
  });

  it("imported fresh, the three green chile spellings create one ingredient, and both m&m spellings another", () => {
    const ids = ["diced green chiles", "diced green chilies", "mild green chiles", "green chilli"].map((n) => newIngredient(n).id);
    expect(new Set(ids)).toEqual(new Set(["green-chile"]));
    expect(newIngredient("diced green chilies").doc).toMatchObject({ name: "green chilies", aliases: ["diced green chilies"], needsReview: true });
    expect(new Set(["m&m's", "m&ms", "M&Ms", "m and m's"].map(newIngredientId))).toEqual(new Set(["m-and-m"]));
  });

  it("suggestions put the matcher's hit first and offer near names for the rest", () => {
    const top = (name: string, id: string) => suggestIngredients(name, index, 5, { exclude: id }).map((s) => s.id);
    expect(top("diced green chilies", "diced-green-chili")[0]).toBe("diced-green-chile");
    expect(top("mild green chiles", "mild-green-chile").slice(0, 2).sort()).toEqual(["diced-green-chile", "diced-green-chili"]);
    expect(top("frozen tater tots", "frozen-tater-tot")[0]).toBe("tater-tot");
    expect(top("colby jack cheese", "colby-jack-cheese")).toEqual(expect.arrayContaining(["monterey-jack-cheese", "marble-cheese"]));
    expect(top("lettuce", "lettuce")).toEqual(expect.arrayContaining(["romaine-lettuce", "iceberg-lettuce", "green-leaf-lettuce"]));
    expect(top("cranberries", "cranberry")).toContain("dried-cranberry");
    expect(top("egg yolk", "egg-yolk")[0]).toBe("egg");
    const s = suggestIngredients("milk chocolate", index, 5, { exclude: "milk-chocolate" });
    expect(s.find((x) => x.id === "chocolate-milk")?.score).toBeLessThan(1);
  });
});

describe("spelling variants", () => {
  it.each(SPELLING_VARIANTS.flatMap(([canon, others]) => others.map((o) => [o, canon] as const)))("%s folds onto %s", (other, canon) => {
    expect(variantKey(normalizeName(other))).toBe(variantKey(normalizeName(canon)));
  });
});

describe("index rules", () => {
  it("a reviewed ingredient wins a shared name over one that needs review, whatever the order", () => {
    const idx = buildIngredientIndex([
      { id: "frozen-tater-tot", name: "frozen tater tots", aliases: [], needsReview: true },
      { id: "tater-tot", name: "tater tots", aliases: ["frozen tater tots"] },
    ]);
    expect(resolveIngredientName("frozen tater tots", idx)).toBe("tater-tot");
  });

  it("a merged ingredient's names resolve to what it was merged into, through chains", () => {
    const idx = buildIngredientIndex([
      { id: "a", name: "m&m's", aliases: [], mergedInto: "b" },
      { id: "b", name: "m&ms", aliases: ["candy buttons"], mergedInto: "c" },
      { id: "c", name: "candy coated chocolate", aliases: [] },
    ]);
    expect(resolveIngredientName("m&m's", idx)).toBe("c");
    expect(resolveIngredientName("candy buttons", idx)).toBe("c");
    expect(suggestIngredients("m&ms", idx).map((s) => s.id)).toEqual(["c"]);
  });

  it("ground and state words: never onto meat, never onto the fresh form", () => {
    const idx = buildIngredientIndex([
      { id: "pork-loin", name: "pork loin", aliases: ["pork"], category: "meat" },
      { id: "fennel-seed", name: "fennel seeds", aliases: [], category: "spices" },
      { id: "fresh-basil", name: "fresh basil", aliases: ["basil"], category: "produce" },
      { id: "peas", name: "peas", aliases: [], category: "frozen" },
    ]);
    expect(resolveIngredientName("ground pork", idx)).toBeNull();
    expect(matchIngredient("ground fennel seeds", idx)).toEqual({ id: "fennel-seed", confidence: "soft" });
    expect(resolveIngredientName("dried basil", idx)).toBeNull();
    expect(matchIngredient("frozen peas", idx)).toEqual({ id: "peas", confidence: "soft" });
    expect(matchIngredient("uncooked peas", idx)).toEqual({ id: "peas", confidence: "soft" });
  });

  it("cleans a new ingredient's name of preparation words only", () => {
    expect(cleanIngredientName("Diced Green Chilies")).toBe("green chilies");
    expect(cleanIngredientName("butter (softened)")).toBe("butter");
    expect(cleanIngredientName("chicken thighs, boneless skinless")).toBe("chicken thighs");
    expect(cleanIngredientName("frozen peas")).toBe("frozen peas");
    expect(cleanIngredientName("shredded cheese")).toBe("shredded cheese");
    expect(cleanIngredientName("minced beef")).toBe("minced beef");
    expect(cleanIngredientName("minced")).toBe("minced");
    expect(newIngredient("Smoked Gouda")).toMatchObject({ id: "smoked-gouda", doc: { name: "smoked gouda", aliases: [] } });
  });
});
