// Nutrition facts (M10, PRD R4.30; TECHNICAL_SPECS §5 "Nutrition facts"). Ingredients carry `nutrients` per 100 g
// (Canadian Nutrient File values, data/nutrition-sources.json); recipes carry `nutrition` per serving, derived like
// protein and fibre (`nutrientPerServing` in recipe.ts). `nutritionFacts()` turns a recipe's numbers into the rows of a
// Canadian-style Nutrition Facts table: Health Canada's rounding rules and % daily values (2016 format). The app
// *displays* these; it still *tracks* only protein and fibre (goals, filters, scoring).
import { z } from "zod";

/** The nutrients beyond protein and fibre, per 100 g on ingredients and per serving on recipes. */
export const NUTRITION_KEYS = ["kcal", "fatG", "satFatG", "transFatG", "carbG", "sugarsG", "sodiumMg", "cholesterolMg", "potassiumMg", "calciumMg", "ironMg"] as const;
export type NutritionKey = (typeof NUTRITION_KEYS)[number];
/** Field labels for the ingredient forms (per 100 g). */
export const NUTRITION_LABELS: Readonly<Record<NutritionKey, string>> = {
  kcal: "Calories",
  fatG: "Fat g",
  satFatG: "Saturated fat g",
  transFatG: "Trans fat g",
  carbG: "Carbohydrate g",
  sugarsG: "Sugars g",
  sodiumMg: "Sodium mg",
  cholesterolMg: "Cholesterol mg",
  potassiumMg: "Potassium mg",
  calciumMg: "Calcium mg",
  ironMg: "Iron mg",
};
/** Every seed ingredient has these (`ingredients:validate`); the rest are shown only when known. */
export const CORE_NUTRITION_KEYS = ["kcal", "fatG", "satFatG", "carbG", "sugarsG", "sodiumMg"] as const satisfies readonly NutritionKey[];

const amount = z.number().min(0).optional();
export const nutrientsSchema = z.object(Object.fromEntries(NUTRITION_KEYS.map((k) => [k, amount])) as Record<NutritionKey, typeof amount>);
export type Nutrients = Partial<Record<NutritionKey, number>>;

/** CNF nutrient name IDs for each key (and protein 203, fibre 291). */
export const CNF_NUTRIENT_IDS: Readonly<Record<NutritionKey, number>> = {
  kcal: 208,
  fatG: 204,
  satFatG: 606,
  transFatG: 605,
  carbG: 205,
  sugarsG: 269,
  sodiumMg: 307,
  cholesterolMg: 601,
  potassiumMg: 306,
  calciumMg: 301,
  ironMg: 303,
};

/** Health Canada daily values (Food and Drug Regulations, 2016 table) used for % DV. */
export const DAILY_VALUES = { fatG: 75, satTransG: 20, fibreG: 28, sugarsG: 100, sodiumMg: 2300, potassiumMg: 3400, calciumMg: 1300, ironMg: 18 } as const;

function step(n: number, inc: number): number {
  return Math.round(n / inc) * inc;
}

/** Calories: < 5 to the nearest 1, ≤ 50 to the nearest 5, above to the nearest 10. */
export function roundCalories(n: number): number {
  return n < 5 ? Math.round(n) : n <= 50 ? step(n, 5) : step(n, 10);
}
/** Fats: < 0.5 g to the nearest 0.1 g, ≤ 5 g to the nearest 0.5 g, above to the nearest 1 g. */
export function roundFat(n: number): number {
  return n < 0.5 ? Math.round(n * 10) / 10 : n <= 5 ? step(n, 0.5) : Math.round(n);
}
/** Carbohydrate, fibre, sugars, protein: < 0.5 g reads 0 g, otherwise the nearest 1 g. */
export function roundGrams(n: number): number {
  return n < 0.5 ? 0 : Math.round(n);
}
/** Sodium and potassium: < 5 mg to the nearest 1, ≤ 140 mg to the nearest 5, above to the nearest 10. */
export function roundMilligrams(n: number): number {
  return n < 5 ? Math.round(n) : n <= 140 ? step(n, 5) : step(n, 10);
}
/** Cholesterol to the nearest 5 mg; calcium to the nearest 10 mg (≥ 50) or 5; iron to the nearest 0.1 mg. */
export function roundCholesterol(n: number): number {
  return step(n, 5);
}
export function roundCalcium(n: number): number {
  return n < 50 ? step(n, 5) : step(n, 10);
}
export function roundIron(n: number): number {
  return Math.round(n * 10) / 10;
}

function num(n: number): string {
  return Number(n.toFixed(1)).toString();
}

export interface NutritionRow {
  key: NutritionKey | "protein" | "fibre" | "satTrans";
  label: string;
  /** "12 g", "~12 g", "450 mg". */
  amount: string;
  /** "16 %" or null when the nutrient has no daily value. */
  dv: string | null;
  /** Indented under the row above (saturated, trans, fibre, sugars). */
  sub: boolean;
  approximate: boolean;
}

export interface NutritionFactsInput {
  nutrition?: Nutrients | null | undefined;
  nutritionApproximate?: readonly string[] | null | undefined;
  proteinPerServingG?: number | null | undefined;
  proteinApproximate?: boolean | undefined;
  fibrePerServingG?: number | null | undefined;
  fibreApproximate?: boolean | undefined;
}

export interface NutritionFacts {
  /** Calories per serving (rounded), or null when unknown. */
  calories: string | null;
  caloriesApproximate: boolean;
  rows: NutritionRow[];
  /** Any shown value is approximate: an ingredient lacks data for it. */
  approximate: boolean;
}

/**
 * The rows of the Nutrition Facts table, per serving, in the Canadian label order: Fat (Saturated, + Trans), Carbohydrate
 * (Fibre, Sugars), Protein, Cholesterol, Sodium, Potassium, Calcium, Iron. A nutrient with no value is left out, except
 * the core ones, which show "—". Null when the recipe has no nutrition at all (its ingredients have no data yet).
 */
export function nutritionFacts(r: NutritionFactsInput): NutritionFacts | null {
  const n = r.nutrition ?? {};
  const approx = new Set(r.nutritionApproximate ?? []);
  if (!Object.keys(n).length) return null;
  const rows: NutritionRow[] = [];
  const pct = (v: number, dv: number) => `${Math.round((v / dv) * 100)} %`;
  const g = (v: number | undefined, round: (x: number) => number, a: boolean) => (v === undefined ? "—" : `${a ? "~" : ""}${num(round(v))} g`);
  const mg = (v: number | undefined, round: (x: number) => number, a: boolean) => (v === undefined ? "—" : `${a ? "~" : ""}${num(round(v))} mg`);
  const push = (key: NutritionRow["key"], label: string, amount: string, dv: string | null, sub: boolean, approximate: boolean) => rows.push({ key, label, amount, dv, sub, approximate });

  push("fatG", "Fat", g(n.fatG, roundFat, approx.has("fatG")), n.fatG === undefined ? null : pct(n.fatG, DAILY_VALUES.fatG), false, approx.has("fatG"));
  const satTrans = n.satFatG === undefined ? undefined : n.satFatG + (n.transFatG ?? 0);
  push("satFatG", "Saturated", g(n.satFatG, roundFat, approx.has("satFatG")), satTrans === undefined ? null : pct(satTrans, DAILY_VALUES.satTransG), true, approx.has("satFatG"));
  if (n.transFatG !== undefined) push("transFatG", "+ Trans", g(n.transFatG, roundFat, approx.has("transFatG")), null, true, approx.has("transFatG"));
  push("carbG", "Carbohydrate", g(n.carbG, roundGrams, approx.has("carbG")), null, false, approx.has("carbG"));
  const fibre = r.fibrePerServingG ?? undefined;
  push("fibre", "Fibre", g(fibre, roundGrams, !!r.fibreApproximate), fibre === undefined ? null : pct(fibre, DAILY_VALUES.fibreG), true, !!r.fibreApproximate);
  push("sugarsG", "Sugars", g(n.sugarsG, roundGrams, approx.has("sugarsG")), n.sugarsG === undefined ? null : pct(n.sugarsG, DAILY_VALUES.sugarsG), true, approx.has("sugarsG"));
  const protein = r.proteinPerServingG ?? undefined;
  push("protein", "Protein", g(protein, roundGrams, !!r.proteinApproximate), null, false, !!r.proteinApproximate);
  if (n.cholesterolMg !== undefined) push("cholesterolMg", "Cholesterol", mg(n.cholesterolMg, roundCholesterol, approx.has("cholesterolMg")), null, false, approx.has("cholesterolMg"));
  push("sodiumMg", "Sodium", mg(n.sodiumMg, roundMilligrams, approx.has("sodiumMg")), n.sodiumMg === undefined ? null : pct(n.sodiumMg, DAILY_VALUES.sodiumMg), false, approx.has("sodiumMg"));
  if (n.potassiumMg !== undefined) push("potassiumMg", "Potassium", mg(n.potassiumMg, roundMilligrams, approx.has("potassiumMg")), pct(n.potassiumMg, DAILY_VALUES.potassiumMg), false, approx.has("potassiumMg"));
  if (n.calciumMg !== undefined) push("calciumMg", "Calcium", mg(n.calciumMg, roundCalcium, approx.has("calciumMg")), pct(n.calciumMg, DAILY_VALUES.calciumMg), false, approx.has("calciumMg"));
  if (n.ironMg !== undefined) push("ironMg", "Iron", mg(n.ironMg, roundIron, approx.has("ironMg")), pct(n.ironMg, DAILY_VALUES.ironMg), false, approx.has("ironMg"));

  const caloriesApproximate = approx.has("kcal");
  return {
    calories: n.kcal === undefined ? null : `${caloriesApproximate ? "~" : ""}${roundCalories(n.kcal)}`,
    caloriesApproximate,
    rows,
    approximate: caloriesApproximate || rows.some((x) => x.approximate && x.amount !== "—"),
  };
}
