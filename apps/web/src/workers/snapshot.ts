// The data the scoring and optimiser workers need (TECHNICAL_SPECS §7), as one structured-cloneable snapshot, and the
// worker-side rebuild of the core contexts from it. The page side builds the snapshot from its listeners
// (data/suggestions.tsx); the workers turn it into a ScoreContext and a grocery BuildContext.
//
// Ingredients: the snapshot carries the ingredient docs the page has loaded (planned recipes, supply, mappings); every
// other ingredient comes from the seed bundled into the worker (data/ingredients/*.json), which has the categories,
// conversions, and pack sizes scoring and costing need without reading 475 documents.
import {
  marginalCostFn,
  needsFor,
  projectedSupply,
  buildList,
  resolveWeights,
  tally,
  type BuildContext,
  type ExpiringSpare,
  type GroceryIngredient,
  type LivePrice,
  type MappingEntry,
  type MealType,
  type PlanItemInput,
  type PriceEstimate,
  type RecipeLines,
  type RecipeStats,
  type RecipeSummary,
  type RuleEntry,
  type ScoreContext,
  type ScoreRecipe,
  type StoreEntry,
  type Weights,
} from "@solving-food/core";

export interface SnapshotIngredient extends GroceryIngredient {
  defaultCadenceDays?: number | undefined;
  isStaple?: boolean | undefined;
}

export interface ScoringSnapshot {
  nowMs: number;
  servings: number;
  periodDays: number;
  mealType: MealType | null;
  recipes: RecipeSummary[];
  /** Lines of planned recipes the index lacks (trashed, or not indexed yet). */
  extraLines: Array<[string, RecipeLines]>;
  planned: PlanItemInput[];
  /** Recipe IDs of the period's planned and cooked meals, one per meal (repeats count). */
  plannedRecipeIds: string[];
  unexpired: Array<[string, number]>;
  incoming: Array<[string, number]>;
  expiring: Array<[string, ExpiringSpare]>;
  stats: Array<[string, RecipeStats]>;
  favourites: string[];
  /** Recipe IDs of cook events in the variety window. */
  recentRecipeIds: string[];
  preferences: { likes: string[]; dislikes: string[]; diets: string[] };
  tools: string[];
  proteinGoals: Partial<Record<MealType, number>>;
  weights: Record<string, number>;
  budgetCents: number;
  ingredients: Array<[string, SnapshotIngredient]>;
  mappings: Array<[string, MappingEntry]>;
  rules: RuleEntry[];
  stores: StoreEntry[];
  defaultStoreId?: string | undefined;
  live: Array<[string, LivePrice]>;
}

export interface WorkerContexts {
  score: ScoreContext;
  build: BuildContext;
  weights: Weights;
  recipes: ScoreRecipe[];
  byId: Map<string, ScoreRecipe>;
  /** Canonical needs of one recipe at the household's servings (free-use excluded), for the optimiser. */
  needsOf: (id: string) => Map<string, number>;
  /** Marginal cost of a set of recipes added to the plan, cents (unknown prices count as $0). */
  setCost: (ids: readonly string[]) => number;
}

/** Summary lines (per serving) → the builder's recipe lines at the recipe's own servings. */
export function linesOf(r: Pick<RecipeSummary, "servings" | "lines">): RecipeLines {
  const servings = Math.max(1, r.servings);
  return { servings, ingredients: Object.entries(r.lines ?? {}).map(([ingredientId, per]) => ({ ingredientId, canonicalAmount: per * servings, optional: false })) };
}

export function buildContexts(s: ScoringSnapshot, seed: ReadonlyMap<string, SnapshotIngredient>, estimates: Readonly<Record<string, PriceEstimate>>): WorkerContexts {
  const ingredients = new Map<string, SnapshotIngredient>(seed);
  for (const [id, i] of s.ingredients) ingredients.set(id, i);
  const lines = new Map<string, RecipeLines>(s.extraLines);
  for (const r of s.recipes) if (r.lines) lines.set(r.id, linesOf(r));
  const live = new Map(s.live);
  const build: BuildContext = {
    recipes: (id) => lines.get(id),
    ingredients: (id) => ingredients.get(id),
    supply: new Map(s.unexpired),
    incoming: new Map(s.incoming),
    mappings: new Map(s.mappings),
    rules: s.rules,
    stores: s.stores,
    defaultStoreId: s.defaultStoreId,
    prices: { estimates, live: (id) => live.get(id), nowMs: s.nowMs },
  };
  const projected = projectedSupply(build.supply, s.planned, build);
  const spent = buildList(s.planned, build).totalCents;
  const marginal = marginalCostFn(s.planned, build);
  const recipes: ScoreRecipe[] = s.recipes.map((r) => ({ ...r, tools: r.tools ?? [] }));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const needsCache = new Map<string, Map<string, number>>();
  const needsOf = (id: string) => {
    let n = needsCache.get(id);
    if (!n) {
      n = needsFor([{ id, status: "planned", servings: s.servings, recipes: [{ recipeId: id, servingsMultiplier: 1 }] }], build);
      needsCache.set(id, n);
    }
    return n;
  };
  const costCache = new Map<string, number | null>();
  const planned = tally(s.plannedRecipeIds, (id) => byId.get(id));
  const recent = tally(s.recentRecipeIds, (id) => byId.get(id));
  const score: ScoreContext = {
    nowMs: s.nowMs,
    servings: s.servings,
    mealType: s.mealType,
    periodDays: s.periodDays,
    projected,
    expiring: new Map(s.expiring),
    stats: new Map(s.stats),
    favourites: new Set(s.favourites),
    plannedProteins: planned.proteins,
    plannedCuisines: planned.cuisines,
    plannedRecipeIds: new Set(s.plannedRecipeIds),
    recentCuisines: recent.cuisines,
    recentProteins: recent.proteins,
    recentTotal: recent.total,
    preferences: s.preferences,
    tools: s.tools,
    proteinGoals: s.proteinGoals,
    ingredient: (id) => {
      const i = ingredients.get(id);
      return i ? { category: i.category, name: i.name, freeUse: i.freeUse } : undefined;
    },
    costOf: (r) => {
      if (!costCache.has(r.id)) {
        const c = marginal(needsOf(r.id));
        costCache.set(r.id, c.unknown && !c.cents ? null : c.cents);
      }
      return costCache.get(r.id)!;
    },
    remainingBudgetCents: s.budgetCents - spent,
  };
  const setCost = (ids: readonly string[]) => {
    const sum = new Map<string, number>();
    for (const id of ids) for (const [k, v] of needsOf(id)) sum.set(k, (sum.get(k) ?? 0) + v);
    return marginal(sum).cents;
  };
  return { score, build, weights: resolveWeights(s.weights), recipes, byId, needsOf, setCost };
}
