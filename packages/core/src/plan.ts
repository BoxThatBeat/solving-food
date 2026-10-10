// The plan (PRD §3, R5.1–R5.8, R6.1, R6.2; TECHNICAL_SPECS §4.2, §7 "Coverage & leftovers").
//
// Every plan item is a meal: one or more recipes eaten together, given a meal type and servings, never a day. Its
// `coverage` says how many slots of each plannable meal type it fills; the coverage strip fills those slots left to
// right. Pure functions only: the web app writes the documents.

import { z } from "zod";
import { MEAL_TYPES, PLANNABLE_MEAL_TYPES, type MealType, type PlannableMealType } from "./taxonomy";
import { MEAL_NAME_MAX, MEAL_RECIPES_MAX, type PlanItemDoc } from "./types";
import { SERVINGS_MAX } from "./config";

export type Coverage = Partial<Record<PlannableMealType, number>>;

export interface RecipeRef {
  recipeId: string;
  servingsMultiplier: number;
}

/** What coverage needs to know about a recipe. */
export interface CoverageRecipe {
  defaultLeftoverPortions: number;
  leftoverMealType?: MealType | undefined;
}

const PLANNABLE = new Set<string>(PLANNABLE_MEAL_TYPES);
export const isPlannable = (t: string): t is PlannableMealType => PLANNABLE.has(t);

/**
 * `coverageFor(item, recipes)`: the meal itself fills one slot of its type (snacks fill none), and each recipe's
 * leftover portions fill slots of the recipe's leftover meal type (lunch by default), summed across the item's
 * recipes. Leftover portions are the recipe's estimate as written, not scaled by servings (M3 confirms the real
 * count when the batch is cooked).
 */
export function coverageFor(
  item: { kind?: "meal" | "leftover"; mealType: MealType; recipes: readonly RecipeRef[] },
  recipes: (id: string) => CoverageRecipe | undefined,
): Coverage {
  const c: Coverage = {};
  const add = (t: MealType, n: number) => {
    if (n > 0 && isPlannable(t)) c[t] = (c[t] ?? 0) + n;
  };
  add(item.mealType, 1);
  if (item.kind === "leftover") return c;
  for (const r of item.recipes) {
    const rec = recipes(r.recipeId);
    if (!rec) continue;
    add(rec.leftoverMealType ?? "lunch", rec.defaultLeftoverPortions);
  }
  return c;
}

export type CellState = "cooked" | "planned" | "open";

export interface StripRow {
  mealType: PlannableMealType;
  cells: CellState[];
  /** Slots filled (cooked + planned), may exceed the number of days. */
  filled: number;
  cooked: number;
  days: number;
  /** filled − days when positive ("8/7, +1"). */
  overflow: number;
}

/**
 * `stripModel(items, days, plannedMealTypes)`: one row per planned meal type (R11.13), one cell per day. Cooked and
 * eaten items fill solid cells first, then planned ones outlined, left to right (R6.2). Skipped items don't count.
 */
export function stripModel(
  items: ReadonlyArray<Pick<PlanItemDoc, "coverage" | "status">>,
  days: number,
  plannedMealTypes: readonly PlannableMealType[],
): StripRow[] {
  return PLANNABLE_MEAL_TYPES.filter((t) => plannedMealTypes.includes(t)).map((mealType) => {
    let cooked = 0;
    let planned = 0;
    for (const it of items) {
      const n = it.coverage?.[mealType] ?? 0;
      if (it.status === "cooked" || it.status === "eaten") cooked += n;
      else if (it.status === "planned") planned += n;
    }
    const filled = cooked + planned;
    const cells: CellState[] = Array.from({ length: days }, (_, i) => (i < cooked ? "cooked" : i < filled ? "planned" : "open"));
    return { mealType, cells, filled, cooked, days, overflow: Math.max(0, filled - days) };
  });
}

/** "5/7", "8/7 · +1" */
export function stripCount(row: Pick<StripRow, "filled" | "days" | "overflow">): string {
  return row.overflow ? `${row.filled}/${row.days} · +${row.overflow}` : `${row.filled}/${row.days}`;
}

/** Create meal input (R5.7, R5.8), validated before anything is written. */
export const createMealInputSchema = z
  .object({
    recipes: z.array(z.object({ recipeId: z.string().min(1), servingsMultiplier: z.number().positive().max(10) })).min(1, "Pick at least one recipe").max(MEAL_RECIPES_MAX),
    savedMealId: z.string().min(1).optional(),
    mealType: z.enum(MEAL_TYPES),
    servings: z.number().int().min(1).max(SERVINGS_MAX),
    name: z.string().trim().max(MEAL_NAME_MAX).optional(),
    saveAsMeal: z.boolean(),
  })
  .refine((v) => !v.saveAsMeal || (v.name ?? "").trim().length > 0, { message: "Name the meal to save it", path: ["name"] });
export type CreateMealInput = z.infer<typeof createMealInputSchema>;

/** The plan item document for a validated Create meal input (the client adds `addedAt` and, if saving, the meal ID). */
export function buildPlanItem(
  input: CreateMealInput,
  ctx: { periodId: string; uid: string; recipes: (id: string) => CoverageRecipe | undefined; savedMealId?: string },
): Omit<PlanItemDoc, "addedAt"> {
  const v = createMealInputSchema.parse(input);
  const item: Omit<PlanItemDoc, "addedAt"> = {
    periodId: ctx.periodId,
    kind: "meal",
    mealType: v.mealType,
    servings: v.servings,
    recipes: v.recipes.map((r) => ({ recipeId: r.recipeId, servingsMultiplier: r.servingsMultiplier })),
    coverage: coverageFor({ kind: "meal", mealType: v.mealType, recipes: v.recipes }, ctx.recipes),
    status: "planned",
    addedBy: ctx.uid,
  };
  const savedMealId = ctx.savedMealId ?? v.savedMealId;
  if (savedMealId) item.savedMealId = savedMealId;
  const name = v.name?.trim();
  if (name && (savedMealId || v.recipes.length > 1 || v.saveAsMeal)) item.name = name;
  return item;
}

/** Default name offered for a multi-recipe meal: "Carnitas + Pico de gallo + Tortillas". */
export function defaultMealName(titles: readonly string[]): string {
  const s = titles.join(" + ");
  return s.length <= MEAL_NAME_MAX ? s : `${s.slice(0, MEAL_NAME_MAX - 1)}…`;
}

/** The title a plan item shows: its name, else its recipe titles. */
export function planItemTitle(item: Pick<PlanItemDoc, "name" | "recipes">, titleOf: (id: string) => string | undefined): string {
  if (item.name) return item.name;
  const titles = item.recipes.map((r) => titleOf(r.recipeId) ?? "Recipe");
  return titles.join(" + ") || "Meal";
}

/** A planned item carried into the next period at rollover (§7): same meal, fresh period, pointing back. */
export function carryOver(item: PlanItemDoc, fromId: string, periodId: string): PlanItemDoc {
  const { addedAt: _addedAt, ...rest } = item;
  void _addedAt;
  return { ...rest, periodId, carriedFromId: fromId, status: "planned" };
}

/** Deterministic ID of the carried copy, so a retried rollover can't duplicate it. */
export function carriedItemId(periodId: string, fromId: string): string {
  return `${periodId}_${fromId}`.slice(0, 200);
}

/** Grouping order on the Plan page: breakfast, lunch, dinner, snack. */
export const MEAL_TYPE_ORDER: Record<MealType, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };

/** Average protein per serving of the plan's items per meal type (R6.17's summary; goals arrive in M5). */
export function proteinSummary(
  items: ReadonlyArray<Pick<PlanItemDoc, "mealType" | "recipes" | "status">>,
  proteinOf: (recipeId: string) => number | null | undefined,
): Partial<Record<MealType, { avg: number; items: number }>> {
  const out: Partial<Record<MealType, { sum: number; n: number }>> = {};
  for (const it of items) {
    if (it.status === "skipped") continue;
    const vals = it.recipes.map((r) => proteinOf(r.recipeId)).filter((v): v is number => typeof v === "number");
    if (!vals.length) continue;
    const per = vals.reduce((a, b) => a + b, 0); // a meal's servings eat every recipe in it
    const o = (out[it.mealType] ??= { sum: 0, n: 0 });
    o.sum += per;
    o.n++;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { avg: v!.sum / v!.n, items: v!.n }]));
}
