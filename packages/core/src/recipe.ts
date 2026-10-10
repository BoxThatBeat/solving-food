// Recipes (TECHNICAL_SPECS §4.1, §5, §9): derived fields, protein per serving, scaling, step rendering, fingerprints,
// canonical URLs, and the compact summary the search index stores.

import { z } from "zod";
import { CUISINES, MAIN_PROTEINS, MEAL_TYPES } from "./taxonomy";
import { recipeIngredientSchema, recipeStepSchema, prepTaskSchema, type RecipeDoc } from "./types";
import {
  formatAmount,
  formatOriginal,
  toCanonical,
  unitDef,
  type ConvertibleIngredient,
} from "./units";
import { slugify } from "./names";

export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type PrepTask = z.infer<typeof prepTaskSchema>;

/** What an ingredient needs to contribute to a recipe's numbers and display. */
export interface RecipeIngredientInfo extends ConvertibleIngredient {
  name: string;
  proteinPer100g?: number | undefined;
  freeUse?: boolean;
}
export type IngredientLookup = (ingredientId: string) => RecipeIngredientInfo | undefined;

export function lookupFrom(map: Map<string, RecipeIngredientInfo> | Record<string, RecipeIngredientInfo>): IngredientLookup {
  return map instanceof Map ? (id) => map.get(id) : (id) => map[id];
}

/**
 * The editable content of a recipe: what the editor and the Cooklang importer produce. Everything else on the
 * document (slug, fingerprint, canonical amounts, protein, status, versioning) is derived or set by the save path.
 */
export const recipeContentSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  servings: z.number().int().min(1).max(100),
  prepMin: z.number().int().min(0).max(10_000),
  cookMin: z.number().int().min(0).max(10_000),
  cuisine: z.enum(CUISINES),
  mainProtein: z.enum(MAIN_PROTEINS),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  tools: z.array(z.string().trim().min(1).max(60)).max(30),
  ingredients: z.array(recipeIngredientSchema).max(100),
  steps: z.array(recipeStepSchema).max(100),
  prepTasks: z.array(prepTaskSchema).max(50),
  defaultLeftoverPortions: z.number().int().min(0).max(50),
  leftoverMealType: z.enum(MEAL_TYPES).optional(),
  notes: z.string().max(5000).optional(),
  sourceUrl: z.url().optional(),
  imagePaths: z.array(z.string()).max(10),
});
export type RecipeContent = z.infer<typeof recipeContentSchema>;

export interface DerivedFields {
  slug: string;
  ingredients: RecipeIngredient[];
  ingredientIds: string[];
  fingerprint: string;
  proteinPerServingG?: number;
  proteinApproximate: boolean;
  sourceUrlCanonical?: string;
}

/** Recomputes canonical amounts and every derived field from content + ingredient data. */
export function deriveRecipe(content: RecipeContent, lookup: IngredientLookup): DerivedFields {
  const ingredients = content.ingredients.map((l) => ({ ...l, canonicalAmount: lineCanonical(l, lookup) }));
  const withCanon = { ...content, ingredients };
  const protein = proteinPerServing(withCanon, lookup);
  const out: DerivedFields = {
    slug: slugify(content.title),
    ingredients,
    ingredientIds: [...new Set(ingredients.map((l) => l.ingredientId))].sort(),
    fingerprint: fingerprint(withCanon),
    proteinApproximate: protein.approximate,
  };
  if (protein.grams !== null) out.proteinPerServingG = Math.round(protein.grams * 10) / 10;
  if (content.sourceUrl) out.sourceUrlCanonical = canonicalUrl(content.sourceUrl);
  return out;
}

/** Canonical amount of one line with the current ingredient data; 0 when vague or not convertible. */
export function lineCanonical(line: Pick<RecipeIngredient, "amount" | "measure" | "ingredientId">, lookup: IngredientLookup): number {
  const ing = lookup(line.ingredientId);
  if (!ing || line.amount <= 0) return 0;
  const r = toCanonical(line.amount, line.measure, ing);
  return r.ok ? round3(r.canonicalAmount) : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface ProteinResult {
  /** Grams per serving from the lines that could be counted; null when nothing could be counted. */
  grams: number | null;
  /** A non-optional line lacks a protein value or a conversion (§5: shown as "~32 g"). */
  approximate: boolean;
  /** Ingredient IDs that made it approximate (to flag `needsReview`). */
  missing: string[];
}

/**
 * `proteinPerServing(recipe, ingredients)` = Σ(canonical g × proteinPer100g / 100) ÷ servings (§5). Count-canonical
 * ingredients use their unit weight. Optional and vague lines are skipped without making the result approximate.
 */
export function proteinPerServing(
  recipe: Pick<RecipeContent, "servings" | "ingredients">,
  lookup: IngredientLookup,
): ProteinResult {
  let total = 0;
  let counted = 0;
  const missing = new Set<string>();
  for (const l of recipe.ingredients) {
    const ing = lookup(l.ingredientId);
    const vague = unitDef(l.measure).kind === "vague" || l.amount <= 0;
    if (l.optional || vague) continue;
    if (!ing || ing.proteinPer100g === undefined || ing.proteinPer100g === null) {
      missing.add(l.ingredientId);
      continue;
    }
    const r = toCanonical(l.amount, l.measure, ing);
    if (!r.ok) {
      missing.add(l.ingredientId);
      continue;
    }
    const grams = r.canonicalUnit === "g" ? r.canonicalAmount : ing.unitWeightG ? r.canonicalAmount * ing.unitWeightG : null;
    if (grams === null) {
      missing.add(l.ingredientId);
      continue;
    }
    total += (grams * ing.proteinPer100g) / 100;
    counted++;
  }
  const servings = Math.max(1, recipe.servings);
  return {
    grams: counted > 0 || missing.size === 0 ? total / servings : null,
    approximate: missing.size > 0,
    missing: [...missing],
  };
}

/** "32 g" or "~32 g" (approximate), "—" when unknown. */
export function formatProtein(grams: number | undefined | null, approximate?: boolean): string {
  if (grams === undefined || grams === null) return "—";
  return `${approximate ? "~" : ""}${Math.round(grams)} g`;
}

// ---------- scaling

/** Multiplier from the recipe's servings to `servings`. */
export function scaleFactor(recipe: Pick<RecipeContent, "servings">, servings: number): number {
  return Math.max(0.01, servings) / Math.max(1, recipe.servings);
}

/** `scale(recipe, servings)`: amounts and canonical amounts multiplied; step partial amounts too (R4.13). */
export function scale<T extends Pick<RecipeContent, "servings" | "ingredients" | "steps" | "prepTasks">>(recipe: T, servings: number): T {
  const f = scaleFactor(recipe, servings);
  const mul = (n: number) => round3(n * f);
  return {
    ...recipe,
    servings,
    ingredients: recipe.ingredients.map((l) => ({ ...l, amount: mul(l.amount), canonicalAmount: mul(l.canonicalAmount) })),
    steps: recipe.steps.map((s) => ({ ...s, text: scalePlaceholders(s.text, f) })),
    prepTasks: recipe.prepTasks.map((p) => ({ ...p, text: scalePlaceholders(p.text, f) })),
  };
}

function scalePlaceholders(text: string, f: number): string {
  return text.replace(PLACEHOLDER, (all, id: string, amt?: string, measure?: string) =>
    amt === undefined ? all : `{{ing:${id}|${round3(Number(amt) * f)}|${measure ?? ""}}}`,
  );
}

// ---------- steps

/** `{{ing:l1}}` or `{{ing:l1|0.5|cup}}`. */
export const PLACEHOLDER = /\{\{ing:([A-Za-z0-9_-]+)(?:\|([0-9.]+)\|([^}]*))?\}\}/g;

export function placeholder(lineId: string, part?: { amount: number; measure: string }): string {
  return part ? `{{ing:${lineId}|${round3(part.amount)}|${part.measure}}}` : `{{ing:${lineId}}}`;
}

/** Line IDs a text refers to, in order, without repeats. */
export function refsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

export type StepSegment =
  | { kind: "text"; text: string }
  | {
      kind: "ingredient";
      lineId: string;
      /** The recipe's wording of the ingredient ("the butter"). */
      name: string;
      /** Inline amount, original wording plus metric · imperial: "30 g · 1.1 oz", "½ cup (120 g · 4.2 oz)". Empty when none. */
      amount: string;
    };

/**
 * `renderStep()`: splits a step into text and ingredient segments, each ingredient with its inline amount (R4.11).
 * `factor` scales the amounts (servings scaler). Unknown line IDs render as plain text.
 */
export function renderStep(
  text: string,
  lines: readonly RecipeIngredient[],
  lookup: IngredientLookup,
  factor = 1,
): StepSegment[] {
  const out: StepSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    last = at + m[0].length;
    const line = lines.find((l) => l.id === m[1]);
    if (!line) continue;
    const amount = m[2] === undefined ? line.amount : Number(m[2]);
    const measure = m[2] === undefined ? line.measure : m[3] || line.measure;
    out.push({
      kind: "ingredient",
      lineId: line.id,
      name: line.displayText,
      amount: amount > 0 ? amountText(amount * factor, measure, line.ingredientId, lookup) : "",
    });
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Plain-text step with inline amounts: "Add the butter (30 g · 1.1 oz) and stir." */
export function renderStepText(text: string, lines: readonly RecipeIngredient[], lookup: IngredientLookup, factor = 1): string {
  return renderStep(text, lines, lookup, factor)
    .map((s) => (s.kind === "text" ? s.text : s.amount ? `${s.name} (${s.amount})` : s.name))
    .join("");
}

/**
 * An amount as shown everywhere (R8.13): original wording plus metric and imperial. Weights show the original and
 * the other system ("8 oz (230 g · 8 oz)" would repeat, so weights become "230 g · 8 oz"); vague amounts show as is.
 */
export function amountText(amount: number, measure: string, ingredientId: string, lookup: IngredientLookup): string {
  const def = unitDef(measure);
  const original = formatOriginal(amount, measure);
  if (def.kind === "vague") return original;
  const ing = lookup(ingredientId);
  if (!ing) return original;
  const r = toCanonical(amount, measure, ing);
  if (!r.ok) return original;
  if (def.kind === "weight") return formatAmount(r.canonicalAmount, { canonicalUnit: r.canonicalUnit, unitWeightG: ing.unitWeightG });
  return formatAmount(r.canonicalAmount, { canonicalUnit: r.canonicalUnit, unitWeightG: ing.unitWeightG }, { original });
}

/** An ingredient line for the list: { amount: "1 cup (125 g · 4.4 oz)", name: "flour" }. */
export function lineText(line: RecipeIngredient, lookup: IngredientLookup, factor = 1): { amount: string; name: string } {
  return {
    amount: line.amount > 0 || unitDef(line.measure).kind === "vague" ? amountText(line.amount * factor, line.measure, line.ingredientId, lookup) : "",
    name: line.displayText,
  };
}

// ---------- identity: canonical URL and fingerprint

const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|source|share|s|si|_ga|yclid|spm|cmp|campaign)$/i;

/**
 * `canonicalUrl(url)`: lower-case host without `www.`, https, no hash, tracking parameters removed, remaining
 * parameters sorted, no trailing slash. Returns the input trimmed when it isn't a URL.
 */
export function canonicalUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim().toLowerCase();
  }
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "") || "";
  const qs = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `https://${host}${path}${qs}`;
}

/** cyrb53: a small, fast 53-bit string hash (public domain). Deterministic across platforms. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * `fingerprint(recipe)`: hash of the sorted ingredient IDs with their canonical amount per serving rounded to the
 * nearest 5 (g or count×5). Two copies of a recipe scaled to different servings get the same fingerprint (§9).
 */
export function fingerprint(recipe: Pick<RecipeContent, "servings" | "ingredients">): string {
  const per = new Map<string, number>();
  for (const l of recipe.ingredients) per.set(l.ingredientId, (per.get(l.ingredientId) ?? 0) + l.canonicalAmount);
  const servings = Math.max(1, recipe.servings);
  const key = [...per.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, c]) => `${id}:${Math.round(c / servings / 5) * 5}`)
    .join("|");
  return hash53(key);
}

// ---------- the search index summary (§9)

export interface RecipeSummary {
  id: string;
  title: string;
  tags: string[];
  cuisine: RecipeDoc["cuisine"];
  mainProtein: RecipeDoc["mainProtein"];
  proteinPerServingG: number | null;
  proteinApproximate: boolean;
  ingredientIds: string[];
  /** The recipe's own wording of each ingredient, for full-text search without loading ingredient docs. */
  ingredientNames: string[];
  totalMin: number;
  /** Active (hands-on) time: the prep time. */
  activeMin: number;
  servings: number;
  /** Base path of the hero image (`…/480.webp` is the thumbnail), or null. */
  thumb: string | null;
  sourceUrlCanonical: string | null;
  fingerprint: string;
  /** Milliseconds since epoch, for the Newest sort. */
  createdAtMs: number;
  /** Tools the recipe needs ("has all tools" filter, R11.1). Absent on summaries written before M2. */
  tools?: string[];
  /** Canonical amount per serving by ingredient ID, non-optional lines (cost per serving, R4.2). Absent before M2. A map,
   *  not pairs: Firestore can't store nested arrays. */
  lines?: Record<string, number>;
}

/** Canonical amount per serving of each non-optional, non-vague line, summed per ingredient, rounded to 0.1. */
export function summaryLines(r: Pick<RecipeDoc, "ingredients" | "servings">): Record<string, number> {
  const m: Record<string, number> = {};
  for (const l of r.ingredients) if (!l.optional && l.canonicalAmount > 0) m[l.ingredientId] = (m[l.ingredientId] ?? 0) + l.canonicalAmount / Math.max(1, r.servings);
  for (const k of Object.keys(m)) m[k] = Math.round(m[k]! * 10) / 10;
  return m;
}

/** Recipes that appear in the index (§9): trashed and pending-duplicate recipes are left out. */
export function isIndexed(status: RecipeDoc["status"]): boolean {
  return status === "active";
}

export function recipeSummary(id: string, r: RecipeDoc): RecipeSummary {
  const created = r.createdAt;
  return {
    id,
    title: r.title,
    tags: r.tags,
    cuisine: r.cuisine,
    mainProtein: r.mainProtein,
    proteinPerServingG: r.proteinPerServingG ?? null,
    proteinApproximate: r.proteinApproximate ?? false,
    ingredientIds: r.ingredientIds,
    ingredientNames: [...new Set(r.ingredients.map((l) => l.displayText.toLowerCase()))],
    totalMin: r.prepMin + r.cookMin,
    activeMin: r.prepMin,
    servings: r.servings,
    thumb: r.imagePaths[0] ?? null,
    sourceUrlCanonical: r.sourceUrlCanonical ?? null,
    fingerprint: r.fingerprint,
    createdAtMs: created instanceof Date ? created.getTime() : (created?.toMillis?.() ?? 0),
    tools: r.tools,
    lines: summaryLines(r),
  };
}

/** Leftover meal type default: breakfast bakes feed breakfasts, snacks feed snacks, everything else lunches. */
export function defaultLeftoverMealType(tags: readonly string[]): (typeof MEAL_TYPES)[number] {
  const t = tags.map((x) => x.toLowerCase());
  if (t.includes("breakfast")) return "breakfast";
  if (t.includes("snack") || t.includes("dessert")) return "snack";
  return "lunch";
}

/** Next free line ID ("l7") for an editor adding lines. */
export function nextLineId(lines: readonly { id: string }[]): string {
  let max = 0;
  for (const l of lines) {
    const n = Number(/^l(\d+)$/.exec(l.id)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return `l${max + 1}`;
}

/** Image size variants stored for every recipe image (§2). */
export const IMAGE_SIZES = [480, 960, 1920] as const;
export function imageVariant(base: string, size: (typeof IMAGE_SIZES)[number]): string {
  return `${base}/${size}.webp`;
}
