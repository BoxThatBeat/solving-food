// Units & measurements (TECHNICAL_SPECS §5, PRD R8.3, R8.13).
//
// Every amount is stored canonically: grams for anything with a weight or a conversion to one, a plain count only
// when an ingredient has no unit weight. Recipes keep their original wording (amount + unit) for display; the
// canonical value is derived from the ingredient's density or unit weight. Display (R8.13 v3): recipe pages show one
// unit system per line (`formatRecipeAmount()`: imperial weights and non-kitchen volumes convert to metric only; cups,
// spoons, counts and metric amounts read as written; temperatures in Fahrenheit only), and everything else (Supply,
// grocery, History, notifications) is metric only (`formatGrams()`, `formatAmount()`). Imperial units stay accepted
// as input (recipes, packaging, the supply pickers) and cups/spoons still convert through `toCanonical()`.

import type { Measure } from "./taxonomy";
import { singularize } from "./names";

/** The subset of an ingredient that conversions need. */
export interface ConvertibleIngredient {
  allowedMeasures: readonly Measure[];
  canonicalUnit: "g" | "count";
  densityGPerMl?: number | undefined;
  unitWeightG?: number | undefined;
}

export type UnitKind = "weight" | "volume" | "count" | "vague";

export interface UnitDef {
  /** Canonical key stored on recipe lines (`measure`). */
  key: string;
  kind: UnitKind;
  /** Grams per unit (weight) or millilitres per unit (volume); 1 for count; 0 for vague. */
  factor: number;
  /** Singular and plural display labels. */
  label: [string, string];
}

const G_PER_OZ = 28.349523125;
const G_PER_LB = 453.59237;
const ML_PER_TSP = 4.92892159375;
const ML_PER_TBSP = 14.78676478125;
const ML_PER_CUP = 236.5882365;
const ML_PER_FLOZ = 29.5735295625;

const DEFS: UnitDef[] = [
  { key: "mg", kind: "weight", factor: 0.001, label: ["mg", "mg"] },
  { key: "g", kind: "weight", factor: 1, label: ["g", "g"] },
  { key: "kg", kind: "weight", factor: 1000, label: ["kg", "kg"] },
  { key: "oz", kind: "weight", factor: G_PER_OZ, label: ["oz", "oz"] },
  { key: "lb", kind: "weight", factor: G_PER_LB, label: ["lb", "lb"] },
  { key: "ml", kind: "volume", factor: 1, label: ["ml", "ml"] },
  { key: "dl", kind: "volume", factor: 100, label: ["dl", "dl"] },
  { key: "l", kind: "volume", factor: 1000, label: ["L", "L"] },
  { key: "tsp", kind: "volume", factor: ML_PER_TSP, label: ["tsp", "tsp"] },
  { key: "tbsp", kind: "volume", factor: ML_PER_TBSP, label: ["tbsp", "tbsp"] },
  { key: "cup", kind: "volume", factor: ML_PER_CUP, label: ["cup", "cups"] },
  { key: "fl oz", kind: "volume", factor: ML_PER_FLOZ, label: ["fl oz", "fl oz"] },
  { key: "pint", kind: "volume", factor: ML_PER_CUP * 2, label: ["pint", "pints"] },
  { key: "quart", kind: "volume", factor: ML_PER_CUP * 4, label: ["quart", "quarts"] },
  { key: "gallon", kind: "volume", factor: ML_PER_CUP * 16, label: ["gallon", "gallons"] },
  { key: "count", kind: "count", factor: 1, label: ["", ""] },
  { key: "pinch", kind: "vague", factor: 0, label: ["pinch", "pinches"] },
  { key: "dash", kind: "vague", factor: 0, label: ["dash", "dashes"] },
  { key: "to taste", kind: "vague", factor: 0, label: ["to taste", "to taste"] },
  { key: "splash", kind: "vague", factor: 0, label: ["splash", "splashes"] },
  { key: "handful", kind: "vague", factor: 0, label: ["handful", "handfuls"] },
];

export const UNITS: Readonly<Record<string, UnitDef>> = Object.fromEntries(DEFS.map((d) => [d.key, d]));

const SYNONYMS: Record<string, string> = {
  milligram: "mg",
  milligrams: "mg",
  gram: "g",
  grams: "g",
  gr: "g",
  kilogram: "kg",
  kilograms: "kg",
  kilo: "kg",
  kilos: "kg",
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  ml: "ml",
  deciliter: "dl",
  decilitre: "dl",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsps: "tsp",
  t: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsps: "tbsp",
  tbs: "tbsp",
  tbl: "tbsp",
  cups: "cup",
  c: "cup",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  "fl. oz": "fl oz",
  "fl. oz.": "fl oz",
  floz: "fl oz",
  pints: "pint",
  pt: "pint",
  pts: "pint",
  quarts: "quart",
  qt: "quart",
  qts: "quart",
  gallons: "gallon",
  gal: "gallon",
  pinches: "pinch",
  dashes: "dash",
  "to-taste": "to taste",
  splashes: "splash",
  handfuls: "handful",
  "": "count",
  each: "count",
  ea: "count",
  whole: "count",
  piece: "count",
  pieces: "count",
  pc: "count",
  pcs: "count",
};

export interface ParsedUnit {
  def: UnitDef;
  /**
   * The measure to store on a recipe line: the unit key ("cup", "g", "count"), or for a count noun that isn't a
   * standard unit ("cloves", "fillets", "lemons") the singular noun ("clove"), so "2 cloves garlic" still reads that
   * way. Count nouns convert with the ingredient's unit weight.
   */
  measure: string;
}

/** Recognises a unit as written in a recipe ("Tbsp", "cups", "cloves", ""). Unknown words count pieces. */
export function parseUnit(text: string | undefined | null): ParsedUnit {
  const raw = (text ?? "").trim();
  // "T" is tablespoon in American recipes; "t" teaspoon. Everything else is case-insensitive.
  if (raw === "T") return { def: UNITS.tbsp!, measure: "tbsp" };
  const t = raw.toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  const key = UNITS[t] ? t : SYNONYMS[t];
  if (key && UNITS[key]) return { def: UNITS[key], measure: key };
  return { def: UNITS.count!, measure: t.split(" ").map(singularize).join(" ") };
}

/** The unit definition behind a stored measure (count nouns are counts). */
export function unitDef(measure: string): UnitDef {
  return UNITS[measure] ?? parseUnit(measure).def;
}

/** "clove" → "cloves", "pinch" → "pinches", "leaf" → "leaves". */
export function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(leaf|loaf|half)$/.test(word)) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
}

/** Label for a unit at an amount: "cup" / "cups"; count nouns use their own wording ("clove" / "cloves"). */
export function unitLabel(measure: string, amount: number): string {
  const def = UNITS[measure];
  const one = Math.abs(amount - 1) < 1e-9 || amount < 1;
  if (!def) return one ? measure : pluralize(measure);
  if (def.kind === "count") return "";
  return one && amount > 0 ? def.label[0] : def.label[1];
}

export type CanonicalResult =
  | { ok: true; canonicalAmount: number; canonicalUnit: "g" | "count" }
  | { ok: false; reason: "vague" | "missingDensity" | "missingUnitWeight" | "measureNotAllowed" };

/**
 * `toCanonical(amount, measure, ingredient)`: grams (or a count, for count-canonical ingredients).
 * Weight converts by the static table, volume by density, count by unit weight. Vague amounts have no canonical value.
 */
export function toCanonical(amount: number, measure: string, ingredient: ConvertibleIngredient): CanonicalResult {
  const def = unitDef(measure);
  const a = Math.max(0, amount);
  if (def.kind === "vague") return { ok: false, reason: "vague" };
  if (ingredient.canonicalUnit === "count") {
    if (def.kind === "count") return { ok: true, canonicalAmount: a, canonicalUnit: "count" };
    // A count-canonical ingredient can still accept weights if it knows a unit weight.
    if (!ingredient.unitWeightG) return { ok: false, reason: "missingUnitWeight" };
    const grams = def.kind === "weight" ? a * def.factor : volumeToGrams(a * def.factor, ingredient);
    if (grams === null) return { ok: false, reason: "missingDensity" };
    return { ok: true, canonicalAmount: grams / ingredient.unitWeightG, canonicalUnit: "count" };
  }
  switch (def.kind) {
    case "weight":
      return { ok: true, canonicalAmount: a * def.factor, canonicalUnit: "g" };
    case "volume": {
      const grams = volumeToGrams(a * def.factor, ingredient);
      return grams === null
        ? { ok: false, reason: "missingDensity" }
        : { ok: true, canonicalAmount: grams, canonicalUnit: "g" };
    }
    case "count":
      return ingredient.unitWeightG
        ? { ok: true, canonicalAmount: a * ingredient.unitWeightG, canonicalUnit: "g" }
        : { ok: false, reason: "missingUnitWeight" };
  }
}

function volumeToGrams(ml: number, ingredient: ConvertibleIngredient): number | null {
  return ingredient.densityGPerMl ? ml * ingredient.densityGPerMl : null;
}

/** `fromCanonical(canonical, measure, ingredient)`: the amount in `measure`, or null when there's no conversion. */
export function fromCanonical(canonical: number, measure: string, ingredient: ConvertibleIngredient): number | null {
  const def = unitDef(measure);
  const c = Math.max(0, canonical);
  if (def.kind === "vague") return null;
  const grams = ingredient.canonicalUnit === "count" ? (ingredient.unitWeightG ? c * ingredient.unitWeightG : null) : c;
  if (ingredient.canonicalUnit === "count" && def.kind === "count") return c;
  if (grams === null) return null;
  switch (def.kind) {
    case "weight":
      return grams / def.factor;
    case "volume":
      return ingredient.densityGPerMl ? grams / ingredient.densityGPerMl / def.factor : null;
    case "count":
      return ingredient.unitWeightG ? grams / ingredient.unitWeightG : null;
  }
}

/** Which measurement kinds an ingredient can be entered in (R8.3): its allowed set, minus kinds it can't convert. */
export function enterableMeasures(ingredient: ConvertibleIngredient): Measure[] {
  return ingredient.allowedMeasures.filter((m) => {
    if (m === "volume") return !!ingredient.densityGPerMl;
    if (m === "count") return ingredient.canonicalUnit === "count" || !!ingredient.unitWeightG;
    return ingredient.canonicalUnit === "g" || !!ingredient.unitWeightG;
  });
}

/** Units offered in the editor for each measurement kind. */
export const UNITS_BY_MEASURE: Record<Measure, string[]> = {
  weight: ["g", "kg", "oz", "lb"],
  volume: ["tsp", "tbsp", "cup", "ml", "l", "fl oz"],
  count: ["count"],
};

// ---------- formatting

/** Removes float noise: 0.30000000000000004 → 0.3. */
function clean(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

/** Metric weight with rounding per magnitude: 2.5 g · 45 g · 125 g · 430 g · 1.2 kg · 12 kg. */
export function formatGrams(g: number): string {
  const v = Math.max(0, g);
  if (v === 0) return "0 g";
  if (v < 10) return `${clean(v, 1)} g`;
  if (v < 100) return `${Math.round(v)} g`;
  if (v < 250) return `${Math.round(v / 5) * 5} g`;
  if (v < 995) return `${Math.round(v / 10) * 10} g`;
  if (v < 9950) return `${(v / 1000).toFixed(1)} kg`;
  return `${Math.round(v / 1000)} kg`;
}

/** Metric volume with the same rounding as grams: 2.5 ml · 15 ml · 235 ml · 750 ml · 1.2 L · 12 L. */
export function formatMl(ml: number): string {
  const v = Math.max(0, ml);
  if (v === 0) return "0 ml";
  if (v < 10) return `${clean(v, 1)} ml`;
  if (v < 100) return `${Math.round(v)} ml`;
  if (v < 250) return `${Math.round(v / 5) * 5} ml`;
  if (v < 995) return `${Math.round(v / 10) * 10} ml`;
  if (v < 9950) return `${(v / 1000).toFixed(1)} L`;
  return `${Math.round(v / 1000)} L`;
}

const FRACTIONS: Array<[number, string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/**
 * A recipe quantity as a cook reads it: kitchen fractions for spoons, cups and pieces (1½, ⅓), decimals otherwise.
 * `measure` decides: weights and metric volumes never use fractions.
 */
export function formatQuantity(amount: number, measure = "count"): string {
  const a = Math.max(0, amount);
  const def = UNITS[measure];
  const metric = def && (def.kind === "weight" || measure === "ml" || measure === "l" || measure === "dl");
  if (metric) {
    if (a >= 100) return String(Math.round(a));
    if (a >= 10) return clean(a, 0);
    return clean(a, 2);
  }
  const whole = Math.floor(a + 1e-9);
  const frac = a - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  const near = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  if (near) return whole > 0 ? `${whole}${near[1]}` : near[1];
  return clean(a, 2);
}

export interface FormatOptions {
  /** The recipe's original wording of a count, e.g. "2 potatoes". Shown first, with the weight in brackets. */
  original?: string;
}

/**
 * A canonical amount in metric (R8.13): "430 g", "2 potatoes (430 g)" with an original count, "2" for a count
 * with no unit weight. Count-canonical amounts with no unit weight show the count (or the original) only.
 */
export function formatAmount(
  canonical: number,
  ingredient: Pick<ConvertibleIngredient, "canonicalUnit" | "unitWeightG">,
  opts: FormatOptions = {},
): string {
  const grams = ingredient.canonicalUnit === "count" ? (ingredient.unitWeightG ? canonical * ingredient.unitWeightG : null) : canonical;
  if (!opts.original) return grams === null ? formatQuantity(canonical, "count") : formatGrams(grams);
  return grams === null ? opts.original : `${opts.original} (${formatGrams(grams)})`;
}

/** Units that are already metric: shown as written. */
const METRIC = new Set(["mg", "g", "kg", "ml", "dl", "l"]);

/** Kitchen measures a cook reads as written (R8.13 v3): spoons and cups are never converted for display. */
const KITCHEN = new Set(["tsp", "tbsp", "cup"]);

/**
 * Grams converted from an imperial weight, rounded the way a cook would write them: below 250 g as `formatGrams()`,
 * 250 g to 1 kg to the nearest 25 g (2 lb → 900 g, 1 lb → 450 g), above that as `formatGrams()` (1.8 kg).
 */
function convertedGrams(g: number): string {
  if (g >= 250 && g < 987.5) return `${Math.round(g / 25) * 25} g`;
  return formatGrams(g);
}

/**
 * A recipe amount as recipe pages show it (R8.13 v3): one unit system per line, never both.
 * - Imperial weights convert to metric only: "2 lb" → "900 g", "8 oz" → "225 g".
 * - Imperial volumes that aren't kitchen measures (fl oz, pints, quarts, gallons) convert to ml / L only.
 * - Kitchen measures read as written with no conversion: "1 cup", "2 tbsp", "½ tsp".
 * - Already-metric amounts, counts ("2", "3 cloves") and vague amounts ("a pinch", "to taste") read as written.
 * The ingredient argument is unused for display now (kept for callers); Supply deduction still converts through
 * `toCanonical()`.
 */
export function formatRecipeAmount(amount: number, measure: string, _ingredient?: ConvertibleIngredient): string {
  const def = unitDef(measure);
  const original = formatOriginal(amount, measure);
  if (def.kind === "vague") return original;
  if (amount <= 0) return "";
  if (METRIC.has(def.key) || def.kind === "count" || KITCHEN.has(def.key)) return original;
  if (def.kind === "weight") return convertedGrams(amount * def.factor);
  return formatMl(amount * def.factor);
}

/** °C → °F, rounded to the nearest 5: 180 → 355, 200 → 390, 220 → 430. */
export function celsiusToFahrenheit(c: number): number {
  return Math.round(((c * 9) / 5 + 32) / 5) * 5;
}

const DEG = String.raw`(?:\s*(?:°|º|˚|degrees?|deg\.?)\s*)`;
/** A Fahrenheit temperature followed by a bracketed Celsius one: "350°F (175°C)". The bracket is dropped. */
const F_THEN_C = new RegExp(String.raw`(\d{2,3}${DEG}F(?:ahrenheit)?\b|\d{2,3}F\b)\s*[(/]\s*-?\d{2,3}${DEG}?C(?:elsius)?\b\s*\)?`, "g");
/** A Celsius temperature followed by a bracketed Fahrenheit one: "180°C (350°F)". The Fahrenheit one is kept. */
const C_THEN_F = new RegExp(String.raw`\d{2,3}${DEG}C(?:elsius)?\b\s*[(/]\s*(\d{2,3}${DEG}?F(?:ahrenheit)?)\b\s*\)?`, "g");
/** A Celsius temperature on its own: "200°C", "200 degrees C", "200C". */
const CELSIUS = new RegExp(String.raw`(\d{2,3})(?:${DEG}C(?:elsius)?|C)\b`, "g");

/**
 * Recipe text with temperatures in Fahrenheit only (R8.13 v3, no Celsius ever): "Preheat to 200°C" → "Preheat to
 * 390°F"; "350°F (175°C)" → "350°F"; "180°C (350°F)" → "350°F"; Fahrenheit reads as written.
 */
export function fahrenheitOnly(text: string): string {
  return text
    .replace(F_THEN_C, (_m: string, f: string) => f)
    .replace(C_THEN_F, (_m: string, f: string) => f)
    .replace(CELSIUS, (_m: string, c: string) => `${celsiusToFahrenheit(Number(c))}°F`);
}

/** Original wording of an amount: "1½ cups", "2 cloves", "8 oz", "2" (count), "a pinch", "" (no amount). */
export function formatOriginal(amount: number, measure: string): string {
  const def = UNITS[measure];
  if (def?.kind === "vague") {
    if (def.key === "to taste") return "to taste";
    return amount > 0 ? `${formatQuantity(amount)} ${unitLabel(measure, amount)}` : `a ${def.label[0]}`;
  }
  if (amount <= 0) return "";
  const q = formatQuantity(amount, measure);
  const label = unitLabel(measure, amount);
  return label ? `${q} ${label}` : q;
}
