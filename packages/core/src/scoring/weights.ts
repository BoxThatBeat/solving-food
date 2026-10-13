// Suggestion weights and presets (PRD R6.11, R6.12, R11.3; TECHNICAL_SPECS §7 "Suggestion score"). Stored in
// `households/{hid}.settings.scoreWeights` as { factorKey: 0..5 }; missing keys fall back to Balanced. Missing kitchen
// tools, dislikes, and diets are hard filters, not weights.

export const FACTOR_KEYS = [
  "expiryUrgency",
  "supplyUtilisation",
  "rating",
  "historicalPref",
  "variety",
  "preferences",
  "proteinGoal",
  "fibreGoal",
  "missingIngredients",
  "cost",
  "sameProtein",
  "sameCuisine",
  "recentlyCooked",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

export interface FactorInfo {
  key: FactorKey;
  label: string;
  /** +1 raises a suggestion, −1 lowers it. */
  sign: 1 | -1;
  /** One line for the Settings page. */
  hint: string;
}

export const FACTORS: readonly FactorInfo[] = [
  { key: "expiryUrgency", label: "Expiry urgency", sign: 1, hint: "Uses supply that expires soon" },
  { key: "supplyUtilisation", label: "Uses what's on hand", sign: 1, hint: "Share of the recipe already in supply" },
  { key: "rating", label: "Household rating", sign: 1, hint: "Your average score, 1–10" },
  { key: "historicalPref", label: "Historical preference", sign: 1, hint: "Made often and lately; favourites" },
  { key: "variety", label: "Variety", sign: 1, hint: "Not cooked lately; a cuisine and protein you haven't had much" },
  { key: "preferences", label: "Food preferences", sign: 1, hint: "Matches your likes" },
  { key: "proteinGoal", label: "Meets protein goal", sign: 1, hint: "Protein per serving at or above the goal" },
  { key: "fibreGoal", label: "Meets fibre goal", sign: 1, hint: "Fibre per serving at or above the goal" },
  { key: "missingIngredients", label: "Missing ingredients", sign: -1, hint: "Share of ingredients supply doesn't cover" },
  { key: "cost", label: "Cost", sign: -1, hint: "What it adds to the next order" },
  { key: "sameProtein", label: "Same protein as plan", sign: -1, hint: "Main protein already planned this period" },
  { key: "sameCuisine", label: "Same cuisine as plan", sign: -1, hint: "Cuisine already planned this period" },
  { key: "recentlyCooked", label: "Recently cooked", sign: -1, hint: "Cooked in the last three weeks" },
];

export const WEIGHT_MAX = 5;

export type Weights = Record<FactorKey, number>;

export const PRESET_NAMES = ["Balanced", "Use it up", "Cheap week", "Adventurous"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

/** From the prototype's PRESETS table (its "tools" weight is a hard filter here). */
export const PRESETS: Readonly<Record<PresetName, Weights>> = {
  Balanced: { expiryUrgency: 4, supplyUtilisation: 3, rating: 3, historicalPref: 2, variety: 3, preferences: 2, proteinGoal: 3, fibreGoal: 2, missingIngredients: 3, cost: 2, sameProtein: 2, sameCuisine: 2, recentlyCooked: 2 },
  "Use it up": { expiryUrgency: 5, supplyUtilisation: 5, rating: 2, historicalPref: 1, variety: 1, preferences: 1, proteinGoal: 2, fibreGoal: 1, missingIngredients: 4, cost: 2, sameProtein: 1, sameCuisine: 1, recentlyCooked: 1 },
  "Cheap week": { expiryUrgency: 3, supplyUtilisation: 4, rating: 2, historicalPref: 2, variety: 1, preferences: 1, proteinGoal: 2, fibreGoal: 1, missingIngredients: 4, cost: 5, sameProtein: 1, sameCuisine: 1, recentlyCooked: 1 },
  Adventurous: { expiryUrgency: 2, supplyUtilisation: 1, rating: 2, historicalPref: 0, variety: 5, preferences: 2, proteinGoal: 2, fibreGoal: 1, missingIngredients: 1, cost: 1, sameProtein: 4, sameCuisine: 5, recentlyCooked: 5 },
};

export const DEFAULT_WEIGHTS: Weights = PRESETS.Balanced;

function clampWeight(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(WEIGHT_MAX, Math.round(v)));
}

/** Stored weights → a full set: unknown keys dropped, values clamped to 0..5, missing ones from Balanced. */
export function resolveWeights(stored: Readonly<Record<string, unknown>> | undefined | null): Weights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of FACTOR_KEYS) {
    const v = clampWeight(stored?.[k]);
    if (v !== null) out[k] = v;
  }
  // Weights saved before M9 have no fibreGoal: take it from the preset the rest matches, so a stored "Cheap week" stays
  // Cheap week instead of turning Custom.
  if (stored && clampWeight(stored.fibreGoal) === null) {
    const match = PRESET_NAMES.find((n) => FACTOR_KEYS.every((k) => k === "fibreGoal" || PRESETS[n][k] === out[k]));
    if (match) out.fibreGoal = PRESETS[match].fibreGoal;
  }
  return out;
}

/** The preset these weights equal, or "Custom". */
export function presetOf(w: Weights): PresetName | "Custom" {
  for (const n of PRESET_NAMES) if (FACTOR_KEYS.every((k) => PRESETS[n][k] === w[k])) return n;
  return "Custom";
}
