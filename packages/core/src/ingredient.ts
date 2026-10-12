// Ingredients (TECHNICAL_SPECS §4.1, §5): review flags, defaults for new ingredients, and name matching.

import { ingredientSchema, type IngredientDoc } from "./types";
import { normalizeName } from "./names";
import { cleanIngredientName, newIngredientId } from "./ingredientMatch";
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
 * A new ingredient from just a name (cleaned of preparation words by `cleanIngredientName`, its ID from the spelling-
 * variant key, so "diced green chilies", "mild green chiles" and "green chili" all create `green-chile`) (and optionally a category): defaults inferred from the category, no
 * conversions or protein, so it is flagged `needsReview` (§5, §9 "Unknown ingredients").
 */
export function newIngredient(
  name: string,
  opts: { category?: string; allowedMeasures?: Measure[] } = {},
): { id: string; doc: IngredientDoc } {
  const clean = cleanIngredientName(name);
  const category = opts.category ?? guessCategory(clean);
  const d = categoryDefaults(category);
  const allowedMeasures = opts.allowedMeasures?.length ? opts.allowedMeasures : d.allowedMeasures;
  const wording = name.trim().toLowerCase();
  const base = {
    name: clean,
    // The recipe's own wording stays findable when the name was cleaned ("diced green chilies" → "green chilies").
    aliases: normalizeName(wording) !== normalizeName(clean) ? [wording] : [],
    category,
    defaultLocation: d.defaultLocation,
    allowedMeasures,
    canonicalUnit: "g" as const,
    shelfLifeDays: d.shelfLifeDays,
    freezable: d.freezable,
    isStaple: false,
    freeUse: false,
  };
  return { id: newIngredientId(clean), doc: { ...base, needsReview: needsReview(base) } };
}

export {
  buildIngredientIndex,
  cleanIngredientName,
  matchIngredient,
  newIngredientId,
  resolveIngredientName,
  suggestIngredients,
  variantKey,
  INGREDIENT_VARIANTS,
  SPELLING_VARIANTS,
  PREP_WORDS,
  STATE_WORDS,
  type IngredientIndex,
  type IndexEntry,
  type IngredientMatch,
  type IngredientSuggestion,
  type MatchConfidence,
} from "./ingredientMatch";
