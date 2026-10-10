// Filtering and sorting for <CollectionView> (TECHNICAL_SPECS §12, PRD R4.2, R4.7). Pure: the web app supplies the
// recipe summaries (from the search index), the household's facts about each (favourite, cook stats), and the IDs a
// text search matched; this decides what shows and in which order. Filter state round-trips through the URL.

import { z } from "zod";
import { CUISINES, MAIN_PROTEINS, MEAL_TYPES } from "./taxonomy";
import type { RecipeSummary } from "./recipe";

export const SORTS = ["suggested", "newest", "name", "quickest", "protein", "cheapest", "rating", "made", "recent"] as const;
export type CollectionSort = (typeof SORTS)[number];

/** Sorts that need data from later milestones; shown greyed with the reason. */
export const UNAVAILABLE_SORTS = [{ key: "expiry", label: "Expiring first", reason: "Needs Supply (M3)" }] as const;

export const SORT_LABELS: Record<CollectionSort, string> = {
  suggested: "Suggested",
  newest: "Newest",
  name: "Name",
  quickest: "Quickest",
  protein: "Most protein",
  cheapest: "Cheapest",
  rating: "Top rated",
  made: "Most made",
  recent: "Recently cooked",
};

export const TOTAL_TIME_STEPS = [20, 30, 45, 60] as const;
export const ACTIVE_TIME_STEPS = [10, 15, 20, 30] as const;
export const PROTEIN_STEPS = [15, 25, 35] as const;
export const RATING_STEPS = [8, 9] as const;
/** Cost per serving steps, in cents ("≤ $2", "≤ $4", "≤ $6"). */
export const COST_STEPS = [200, 400, 600] as const;

const csv = <T extends string>(values?: readonly T[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      const list = (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
      const out = values ? list.filter((s): s is T => (values as readonly string[]).includes(s)) : (list as T[]);
      return out.length ? [...new Set(out)] : undefined;
    });

const num = z.coerce.number().int().positive().catch(undefined as never).optional();

/** URL search params of a collection page. Everything optional; unknown values are dropped. */
export const collectionSearchSchema = z.object({
  q: z.string().catch("").optional(),
  sort: z.enum(SORTS).catch(undefined as never).optional(),
  cuisine: csv(CUISINES).catch(undefined).optional(),
  protein: csv(MAIN_PROTEINS).catch(undefined).optional(),
  meal: csv(MEAL_TYPES).catch(undefined).optional(),
  tags: csv().catch(undefined).optional(),
  minProtein: num,
  maxTotal: num,
  maxActive: num,
  minRating: num,
  cooked: z.enum(["before", "never"]).catch(undefined as never).optional(),
  fav: z.coerce.boolean().catch(false).optional(),
  /** Only recipes whose tools the household owns (R11.1). */
  tools: z.coerce.boolean().catch(false).optional(),
  /** Max estimated cost per serving, cents (R4.2). */
  maxCost: num,
});
export type CollectionSearch = z.infer<typeof collectionSearchSchema>;

/** Back to URL form: lists as comma strings, empty values dropped. */
export function toSearchParams(s: CollectionSearch): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    out[k] = Array.isArray(v) ? v.join(",") : (v as string | number | boolean);
  }
  return out;
}

/** What the household knows about a recipe. */
export interface HouseholdFacts {
  favourite: boolean;
  timesCooked: number;
  lastCookedAtMs: number | null;
  /** Household average rating (1–10), null when unrated. */
  rating: number | null;
  /** Does the household own every tool the recipe needs? True when no tools are configured (nothing to flag). */
  hasAllTools?: boolean;
  /** Estimated cost per serving in cents, null when a price is unknown. */
  costPerServingCents?: number | null;
}

export const NO_FACTS: HouseholdFacts = { favourite: false, timesCooked: 0, lastCookedAtMs: null, rating: null };

/** Tools a recipe needs that the household doesn't list (case-insensitive). */
export function missingTools(recipeTools: readonly string[], householdTools: readonly string[]): string[] {
  const have = new Set(householdTools.map((t) => t.trim().toLowerCase()));
  return recipeTools.filter((t) => !have.has(t.trim().toLowerCase()));
}

export type FactsOf = (id: string) => HouseholdFacts;

export type FilterKey = "cuisine" | "protein" | "meal" | "tags" | "minProtein" | "maxTotal" | "maxActive" | "minRating" | "cooked" | "fav" | "tools" | "maxCost";

const MEAL_SET = new Set<string>(MEAL_TYPES);

/** Meal types a recipe is tagged with (tags carry the course: breakfast, lunch, dinner, snack). */
export function mealTypesOf(r: Pick<RecipeSummary, "tags">): string[] {
  return r.tags.map((t) => t.toLowerCase()).filter((t) => MEAL_SET.has(t));
}

/** Does a recipe pass every filter except `skip` (used for the per-option counts in the filter sheet)? */
export function passes(r: RecipeSummary, s: CollectionSearch, facts: HouseholdFacts, skip?: FilterKey): boolean {
  if (skip !== "cuisine" && s.cuisine && !s.cuisine.includes(r.cuisine)) return false;
  if (skip !== "protein" && s.protein && !s.protein.includes(r.mainProtein)) return false;
  if (skip !== "meal" && s.meal && !mealTypesOf(r).some((m) => s.meal!.includes(m as never))) return false;
  if (skip !== "tags" && s.tags) {
    const tags = new Set(r.tags.map((t) => t.toLowerCase()));
    if (!s.tags.every((t) => tags.has(t.toLowerCase()))) return false;
  }
  if (skip !== "minProtein" && s.minProtein && (r.proteinPerServingG ?? 0) < s.minProtein) return false;
  if (skip !== "maxTotal" && s.maxTotal && r.totalMin > s.maxTotal) return false;
  if (skip !== "maxActive" && s.maxActive && r.activeMin > s.maxActive) return false;
  if (skip !== "minRating" && s.minRating && (facts.rating ?? 0) < s.minRating) return false;
  if (skip !== "cooked" && s.cooked === "before" && facts.timesCooked === 0) return false;
  if (skip !== "cooked" && s.cooked === "never" && facts.timesCooked > 0) return false;
  if (skip !== "fav" && s.fav && !facts.favourite) return false;
  if (skip !== "tools" && s.tools && facts.hasAllTools === false) return false;
  if (skip !== "maxCost" && s.maxCost && (facts.costPerServingCents === null || facts.costPerServingCents === undefined || facts.costPerServingCents > s.maxCost)) return false;
  return true;
}

function compare(sort: CollectionSort, a: RecipeSummary, b: RecipeSummary, fa: HouseholdFacts, fb: HouseholdFacts): number {
  switch (sort) {
    case "name":
      return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    case "quickest":
      return a.totalMin - b.totalMin;
    case "protein":
      return (b.proteinPerServingG ?? -1) - (a.proteinPerServingG ?? -1);
    case "cheapest":
      return (fa.costPerServingCents ?? Number.MAX_SAFE_INTEGER) - (fb.costPerServingCents ?? Number.MAX_SAFE_INTEGER);
    case "rating":
      return (fb.rating ?? -1) - (fa.rating ?? -1);
    case "made":
      return fb.timesCooked - fa.timesCooked;
    case "recent":
      return (fb.lastCookedAtMs ?? -1) - (fa.lastCookedAtMs ?? -1);
    case "suggested": // M5 adds the suggestion score; until then Suggested is Newest (Planning/M1).
    case "newest":
      return b.createdAtMs - a.createdAtMs;
  }
}

export interface CollectionResult {
  items: RecipeSummary[];
  total: number;
}

/**
 * Applies filters and sort. `matches` is the set of IDs a text search found (null = no query) with optional
 * relevance scores; with a query and the default sort, results are ordered by relevance.
 */
export function applyCollection(
  all: readonly RecipeSummary[],
  s: CollectionSearch,
  factsOf: FactsOf,
  matches: Map<string, number> | null = null,
): CollectionResult {
  const items = all.filter((r) => (!matches || matches.has(r.id)) && passes(r, s, factsOf(r.id)));
  const sort = s.sort ?? "suggested";
  const byRelevance = matches && !s.sort;
  items.sort((a, b) => {
    if (byRelevance) {
      const d = (matches.get(b.id) ?? 0) - (matches.get(a.id) ?? 0);
      if (d) return d;
    }
    return compare(sort, a, b, factsOf(a.id), factsOf(b.id)) || a.title.localeCompare(b.title);
  });
  return { items, total: all.length };
}

/** How many recipes each option of a group would show, given the other filters (the numbers in the filter sheet). */
export function optionCount(
  all: readonly RecipeSummary[],
  s: CollectionSearch,
  factsOf: FactsOf,
  matches: Map<string, number> | null,
  key: FilterKey,
  value: unknown,
): number {
  const list = key === "cuisine" || key === "protein" || key === "meal" || key === "tags";
  const next = { ...s, [key]: list ? [value] : value } as CollectionSearch;
  return all.filter((r) => (!matches || matches.has(r.id)) && passes(r, next, factsOf(r.id))).length;
}

/** Number of active filters (the badge on the filter button). Sort and query don't count. */
export function activeFilterCount(s: CollectionSearch): number {
  let n = 0;
  for (const k of ["cuisine", "protein", "meal", "tags"] as const) n += s[k]?.length ?? 0;
  for (const k of ["minProtein", "maxTotal", "maxActive", "minRating", "cooked", "fav", "tools", "maxCost"] as const) if (s[k]) n++;
  return n;
}

/** All tags in use with their counts, most common first (meal types excluded; they have their own group). */
export function tagCounts(all: readonly RecipeSummary[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of all) for (const t of r.tags) if (!MEAL_SET.has(t.toLowerCase())) m.set(t.toLowerCase(), (m.get(t.toLowerCase()) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "Middle Eastern" for "middle-eastern". */
export function taxonomyLabel(v: string): string {
  return v
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
