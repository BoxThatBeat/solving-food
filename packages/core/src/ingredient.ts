// Ingredients (TECHNICAL_SPECS §4.1, §5): review flags, defaults for new ingredients, and name matching.

import { ingredientSchema, type IngredientDoc } from "./types";
import { ingredientSlug, normalizeName } from "./names";
import type { Measure, StorageLocation } from "./taxonomy";

export { ingredientSchema, type IngredientDoc };

/** Categories used by the seed data (one file per category in data/ingredients/). */
export const INGREDIENT_CATEGORIES = [
  "produce",
  "meat",
  "fish",
  "dairy",
  "grains",
  "pantry",
  "baking",
  "spices",
  "condiments",
  "bakery",
  "frozen",
  "beverages",
] as const;
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export type ReviewReason = "missingDensity" | "missingUnitWeight" | "missingProtein";

/**
 * Why an ingredient needs review: volume allowed without a density, count allowed (on a gram-canonical ingredient)
 * without a unit weight, or no protein value. `needsReview` is true when this is non-empty.
 */
export function reviewReasons(
  i: Pick<IngredientDoc, "allowedMeasures" | "canonicalUnit" | "densityGPerMl" | "unitWeightG" | "proteinPer100g">,
): ReviewReason[] {
  const out: ReviewReason[] = [];
  if (i.allowedMeasures.includes("volume") && !i.densityGPerMl) out.push("missingDensity");
  if (i.allowedMeasures.includes("count") && i.canonicalUnit === "g" && !i.unitWeightG) out.push("missingUnitWeight");
  if (i.proteinPer100g === undefined || i.proteinPer100g === null) out.push("missingProtein");
  return out;
}

export function needsReview(i: Parameters<typeof reviewReasons>[0]): boolean {
  return reviewReasons(i).length > 0;
}

interface CategoryDefaults {
  defaultLocation: StorageLocation;
  allowedMeasures: Measure[];
  shelfLifeDays: IngredientDoc["shelfLifeDays"];
  freezable: boolean;
}

const DEFAULTS: Record<IngredientCategory, CategoryDefaults> = {
  produce: { defaultLocation: "fridge", allowedMeasures: ["weight", "count", "volume"], shelfLifeDays: { fridge: 7 }, freezable: false },
  meat: { defaultLocation: "fridge", allowedMeasures: ["weight"], shelfLifeDays: { fridge: 2, freezer: 180 }, freezable: true },
  fish: { defaultLocation: "fridge", allowedMeasures: ["weight"], shelfLifeDays: { fridge: 2, freezer: 120 }, freezable: true },
  dairy: { defaultLocation: "fridge", allowedMeasures: ["weight", "volume"], shelfLifeDays: { fridge: 10 }, freezable: false },
  grains: { defaultLocation: "pantry", allowedMeasures: ["weight", "volume"], shelfLifeDays: { pantry: 365 }, freezable: false },
  pantry: { defaultLocation: "pantry", allowedMeasures: ["weight", "volume"], shelfLifeDays: { pantry: 365 }, freezable: false },
  baking: { defaultLocation: "pantry", allowedMeasures: ["weight", "volume"], shelfLifeDays: { pantry: 365 }, freezable: false },
  spices: { defaultLocation: "cupboard", allowedMeasures: ["weight", "volume"], shelfLifeDays: { cupboard: 1095 }, freezable: false },
  condiments: { defaultLocation: "cupboard", allowedMeasures: ["weight", "volume"], shelfLifeDays: { cupboard: 365, fridge: 180 }, freezable: false },
  bakery: { defaultLocation: "pantry", allowedMeasures: ["weight", "count"], shelfLifeDays: { pantry: 5, freezer: 90 }, freezable: true },
  frozen: { defaultLocation: "freezer", allowedMeasures: ["weight"], shelfLifeDays: { freezer: 240 }, freezable: true },
  beverages: { defaultLocation: "pantry", allowedMeasures: ["volume", "weight"], shelfLifeDays: { pantry: 365 }, freezable: false },
};

export function categoryDefaults(category: string): CategoryDefaults {
  return DEFAULTS[(INGREDIENT_CATEGORIES as readonly string[]).includes(category) ? (category as IngredientCategory) : "pantry"];
}

const GUESSES: Array<[RegExp, IngredientCategory]> = [
  [/\b(frozen)\b/, "frozen"],
  [/\b(chicken|beef|pork|turkey|lamb|veal|bacon|ham|sausage|steak|rib|mince|prosciutto|chorizo|salami)\b/, "meat"],
  [/\b(salmon|tuna|cod|shrimp|prawn|fish|tilapia|halibut|trout|scallop|crab|lobster|mussel|clam|anchovy|sardine)\b/, "fish"],
  [/\b(milk|cheese|yogurt|yoghurt|cream|butter|feta|parmesan|mozzarella|cheddar|ricotta|kefir)\b/, "dairy"],
  [/\b(flour|sugar|baking|yeast|cocoa|chocolate|vanilla|sprinkle)\b/, "baking"],
  [/\b(ground|dried|powder|spice|seasoning|flake|paprika|cumin|cinnamon|oregano|thyme|nutmeg|clove)\b/, "spices"],
  [/\b(sauce|ketchup|mustard|mayo|mayonnaise|vinegar|dressing|relish|salsa|oil)\b/, "condiments"],
  [/\b(rice|pasta|noodle|oat|quinoa|couscous|barley|macaroni|spaghetti|penne)\b/, "grains"],
  [/\b(bread|bun|roll|bagel|tortilla|pita|naan|croissant)\b/, "bakery"],
  [/\b(juice|soda|coffee|tea|wine|beer)\b/, "beverages"],
  [/\b(fresh|lettuce|onion|garlic|tomato|pepper|carrot|potato|apple|banana|lemon|lime|herb|basil|parsley|cilantro|spinach|kale|cucumber|zucchini|squash|mushroom|berry)\b/, "produce"],
];

/** Best guess of a category for an unknown ingredient name (drop-folder imports, §9). */
export function guessCategory(name: string): IngredientCategory {
  const n = normalizeName(name);
  for (const [re, cat] of GUESSES) if (re.test(n)) return cat;
  return "pantry";
}

/**
 * A new ingredient from just a name (and optionally a category): defaults inferred from the category, no
 * conversions or protein, so it is flagged `needsReview` (§5, §9 "Unknown ingredients").
 */
export function newIngredient(
  name: string,
  opts: { category?: string; allowedMeasures?: Measure[] } = {},
): { id: string; doc: IngredientDoc } {
  const category = opts.category ?? guessCategory(name);
  const d = categoryDefaults(category);
  const allowedMeasures = opts.allowedMeasures?.length ? opts.allowedMeasures : d.allowedMeasures;
  const base = {
    name: name.trim().toLowerCase(),
    aliases: [],
    category,
    defaultLocation: d.defaultLocation,
    allowedMeasures,
    canonicalUnit: "g" as const,
    shelfLifeDays: d.shelfLifeDays,
    freezable: d.freezable,
    isStaple: false,
    freeUse: false,
  };
  return { id: ingredientSlug(name), doc: { ...base, needsReview: needsReview(base) } };
}

/** Lookup from every normalised name and alias to an ingredient ID. */
export type IngredientIndex = Map<string, string>;

export function buildIngredientIndex(list: Iterable<{ id: string; name: string; aliases: readonly string[] }>): IngredientIndex {
  const idx: IngredientIndex = new Map();
  for (const i of list) {
    for (const n of [i.name, ...i.aliases]) {
      const k = normalizeName(n);
      if (k && !idx.has(k)) idx.set(k, i.id);
    }
  }
  return idx;
}

/** Strips words that describe preparation or freshness, for a second matching attempt ("fresh basil" → "basil"). */
const SOFT_WORDS = new Set(["fresh", "large", "small", "medium", "chopped", "minced", "diced", "sliced", "organic", "whole", "raw"]);

/** Resolves a recipe's wording to an ingredient ID: exact normalised match, then without soft words. */
export function resolveIngredientName(name: string, index: IngredientIndex): string | null {
  const n = normalizeName(name);
  const exact = index.get(n);
  if (exact) return exact;
  const soft = n
    .split(" ")
    .filter((w) => !SOFT_WORDS.has(w))
    .join(" ");
  return (soft && index.get(soft)) || null;
}
