// Loading and validating data/ingredients/*.json (Planning/M1 §1). Shared by validate.ts, upload.ts, and the e2e seed.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildIngredientIndex,
  CORE_NUTRITION_KEYS,
  cooklangToRecipe,
  ingredientSchema,
  ingredientSlug,
  INGREDIENT_CATEGORIES,
  normalizeName,
  resolveIngredientName,
  reviewReasons,
  variantKey,
  type IngredientDoc,
} from "../../packages/core/src/index";

export const DATA_DIR = fileURLToPath(new URL("..", import.meta.url));
export const INGREDIENTS_DIR = join(DATA_DIR, "ingredients");
export const RECIPES_DIR = join(DATA_DIR, "recipes", "cooklang");
export const MIN_INGREDIENTS = 250;

export interface SeedIngredient extends IngredientDoc {
  id: string;
}

export function loadIngredients(): { items: SeedIngredient[]; files: Record<string, number> } {
  const items: SeedIngredient[] = [];
  const files: Record<string, number> = {};
  for (const f of readdirSync(INGREDIENTS_DIR).filter((x) => x.endsWith(".json")).sort()) {
    const list = JSON.parse(readFileSync(join(INGREDIENTS_DIR, f), "utf8")) as SeedIngredient[];
    files[f] = list.length;
    items.push(...list);
  }
  return { items, files };
}

/** Every problem with the seed set; empty when it's valid. */
export function validateIngredients(items: SeedIngredient[]): string[] {
  const problems: string[] = [];
  const names = new Map<string, string>();
  const variants = new Map<string, string>();
  const ids = new Set<string>();
  for (const i of items) {
    const where = `${i.category}/${i.id}`;
    const { id, ...doc } = i;
    const parsed = ingredientSchema.safeParse(doc);
    if (!parsed.success) problems.push(`${where}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    if (id !== ingredientSlug(i.name)) problems.push(`${where}: id should be ${ingredientSlug(i.name)}`);
    if (ids.has(id)) problems.push(`${where}: duplicate id`);
    ids.add(id);
    if (!(INGREDIENT_CATEGORIES as readonly string[]).includes(i.category)) problems.push(`${where}: unknown category ${i.category}`);
    for (const n of [i.name, ...i.aliases]) {
      const k = normalizeName(n);
      const other = names.get(k);
      if (other && other !== id) problems.push(`${where}: "${n}" also names ${other}`);
      names.set(k, id);
      // Spelling variants fold together when matching (M8): "chilli powder" and "chili powder" must be one ingredient.
      const v = variantKey(k);
      const vOther = variants.get(v);
      if (vOther && vOther !== id) problems.push(`${where}: "${n}" is a spelling variant of a name of ${vOther}`);
      variants.set(v, id);
    }
    const reasons = reviewReasons(i);
    if (reasons.length) problems.push(`${where}: incomplete (${reasons.join(", ")})`);
    if (i.needsReview !== reasons.length > 0) problems.push(`${where}: needsReview should be ${reasons.length > 0}`);
    // M9 (R6.26): every shipped ingredient carries fibre (a missing value only makes recipes "~", so it isn't a review reason).
    if (i.fibrePer100g === undefined) problems.push(`${where}: fibrePer100g missing`);
    // M10 (R4.30): nutrition facts from the Canadian Nutrient File (pnpm nutrition:write), the core label values at least.
    if (!i.nutrients || !i.nutrientSource) problems.push(`${where}: nutrients missing (pnpm nutrition:write)`);
    else for (const k of CORE_NUTRITION_KEYS) if (i.nutrients[k] === undefined) problems.push(`${where}: nutrients.${k} missing`);
    if (i.freeUse && !i.isStaple && id !== "water") problems.push(`${where}: free-use items are staples`);
    if (i.isStaple && !i.defaultCadenceDays) problems.push(`${where}: staples need defaultCadenceDays`);
    if (i.defaultPackMeasure && !i.allowedMeasures.includes(i.defaultPackMeasure)) problems.push(`${where}: pack measure not allowed`);
    if ((i.defaultPackAmount === undefined) !== (i.defaultPackMeasure === undefined)) problems.push(`${where}: pack amount and measure go together`);
    // Sides (R5.9, R5.10): bought in packs, tracked (so never free-use), a positive per-person portion.
    if (i.side) {
      if (!(i.side.portion > 0)) problems.push(`${where}: side portion must be positive`);
      if (!i.defaultPackAmount) problems.push(`${where}: a side needs a default pack`);
      if (i.freeUse) problems.push(`${where}: a free-use ingredient can't be a side`);
    }
  }
  if (items.length < MIN_INGREDIENTS) problems.push(`only ${items.length} ingredients; M1 ships at least ${MIN_INGREDIENTS}`);
  return problems;
}

/** Recipe ingredient names (from the 28 household recipes) that don't resolve to a seed ingredient. */
export function unresolvedRecipeNames(items: SeedIngredient[]): string[] {
  const idx = buildIngredientIndex(items);
  const out: string[] = [];
  for (const f of readdirSync(RECIPES_DIR).filter((x) => x.endsWith(".cook")).sort()) {
    const r = cooklangToRecipe(readFileSync(join(RECIPES_DIR, f), "utf8"), { resolve: (n) => resolveIngredientName(n, idx) });
    for (const n of r.newIngredients) out.push(`${f}: ${n.doc.name}`);
  }
  return out;
}
