// Server-side recipe helpers: ingredient lookups and derived-field recomputation (TECHNICAL_SPECS §5 "Protein per
// serving … recomputed whenever a recipe or one of its ingredients changes").
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { deriveRecipe, lookupFrom, type IngredientDoc, type RecipeContent, type RecipeDoc, type RecipeIngredientInfo } from "@solving-food/core";
import { db } from "./admin";

export async function loadIngredients(ids: Iterable<string>): Promise<Map<string, IngredientDoc>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, IngredientDoc>();
  for (let i = 0; i < unique.length; i += 300) {
    const snaps = await db.getAll(...unique.slice(i, i + 300).map((id) => db.collection("ingredients").doc(id)));
    for (const s of snaps) if (s.exists) out.set(s.id, s.data() as IngredientDoc);
  }
  return out;
}

export function lookupOf(map: Map<string, IngredientDoc>) {
  return lookupFrom(map as Map<string, RecipeIngredientInfo>);
}

/** The content part of a stored recipe (what deriveRecipe needs). */
export function contentOf(r: RecipeDoc | DocumentData): RecipeContent {
  const c: RecipeContent = {
    title: r.title,
    servings: r.servings,
    prepMin: r.prepMin,
    cookMin: r.cookMin,
    cuisine: r.cuisine,
    mainProtein: r.mainProtein,
    tags: r.tags ?? [],
    tools: r.tools ?? [],
    ingredients: r.ingredients ?? [],
    steps: r.steps ?? [],
    prepTasks: r.prepTasks ?? [],
    defaultLeftoverPortions: r.defaultLeftoverPortions ?? 0,
    imagePaths: r.imagePaths ?? [],
  };
  if (r.leftoverMealType) c.leftoverMealType = r.leftoverMealType;
  if (r.notes) c.notes = r.notes;
  if (r.sourceUrl) c.sourceUrl = r.sourceUrl;
  return c;
}

const DERIVED_KEYS = ["ingredients", "ingredientIds", "fingerprint", "proteinPerServingG", "proteinApproximate", "slug", "sourceUrlCanonical"] as const;

/** The derived-field update for a recipe whose content (or an ingredient's conversions) changed; empty when nothing did. */
export function derivedUpdate(r: RecipeDoc | DocumentData, content: RecipeContent, lookup: ReturnType<typeof lookupOf>): Record<string, unknown> {
  const derived = deriveRecipe(content, lookup) as unknown as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  for (const k of DERIVED_KEYS) {
    const next = derived[k] ?? null;
    const cur = (r as Record<string, unknown>)[k] ?? null;
    if (JSON.stringify(next) !== JSON.stringify(cur)) update[k] = derived[k] === undefined ? FieldValue.delete() : next;
  }
  return update;
}

/**
 * Recomputes canonical amounts, protein, and fingerprint for every recipe that uses an ingredient whose conversions or
 * protein changed. Writes only the derived fields, without a version bump (the content didn't change).
 */
export async function recomputeRecipesUsing(ingredientId: string): Promise<number> {
  const snap = await db.collection("recipes").where("ingredientIds", "array-contains", ingredientId).get();
  let changed = 0;
  for (const d of snap.docs) {
    const r = d.data() as RecipeDoc;
    const lookup = lookupOf(await loadIngredients(r.ingredientIds));
    const update = derivedUpdate(r, contentOf(r), lookup);
    if (Object.keys(update).length) {
      await d.ref.update(update);
      changed++;
    }
  }
  return changed;
}

/** Fields of an ingredient that change recipe numbers. */
export function conversionChanged(before: DocumentData | undefined, after: DocumentData | undefined): boolean {
  const keys = ["densityGPerMl", "unitWeightG", "proteinPer100g", "canonicalUnit", "allowedMeasures"];
  if (!before || !after) return !!after !== !!before;
  return keys.some((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}
