// Fixed taxonomies (TECHNICAL_SPECS §4.3). The single source for the recipe editor dropdowns, the drop-folder
// validator, and the Claude skill (which embeds the same lists). Extend here only.

export const CUISINES = [
  "american",
  "british",
  "canadian",
  "caribbean",
  "chinese",
  "french",
  "greek",
  "indian",
  "italian",
  "japanese",
  "korean",
  "mediterranean",
  "mexican",
  "middle-eastern",
  "nordic",
  "spanish",
  "thai",
  "vietnamese",
  "other",
] as const;

export const MAIN_PROTEINS = [
  "beef",
  "pork",
  "chicken",
  "turkey",
  "lamb",
  "fish",
  "seafood",
  "eggs",
  "tofu",
  "legumes",
  "dairy",
  "none",
] as const;

export type Cuisine = (typeof CUISINES)[number];
export type MainProtein = (typeof MAIN_PROTEINS)[number];

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** Meal types a household can choose to plan (R11.13). Snacks are always available and never planned in the strip. */
export const PLANNABLE_MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
export type PlannableMealType = (typeof PLANNABLE_MEAL_TYPES)[number];

export const STORAGE_LOCATIONS = ["pantry", "cupboard", "fridge", "freezer"] as const;
export type StorageLocation = (typeof STORAGE_LOCATIONS)[number];

export const MEASURES = ["weight", "volume", "count"] as const;
export type Measure = (typeof MEASURES)[number];
