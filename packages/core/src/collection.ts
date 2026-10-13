// Filtering and sorting for <CollectionView> (TECHNICAL_SPECS §12, PRD R4.2, R4.7). Pure: the web app supplies the
// recipe summaries (from the search index), the household's facts about each (favourite, cook stats), and the IDs a
// text search matched; this decides what shows and in which order. Filter state round-trips through the URL.

import { z } from "zod";
import { CUISINES, MAIN_PROTEINS, RECIPE_COURSES } from "./taxonomy";
import type { RecipeSummary } from "./recipe";

export const SORTS = ["suggested", "expiry", "newest", "name", "quickest", "protein", "cheapest", "rating", "made", "recent"] as const;
export type CollectionSort = (typeof SORTS)[number];

export const SORT_LABELS: Record<CollectionSort, string> = {
  suggested: "Suggested",
  expiry: "Expiring first",
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
  /** Meal type (course) tags, "side" included (R4.28). */
  meal: csv(RECIPE_COURSES).catch(undefined).optional(),
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
  /** Supply filters (R4.2, R4.3, R4.4): "can" = can make with projected supply; "useup" = Use what's left. */
  supply: z.enum(["can", "useup"]).catch(undefined as never).optional(),
  /** Uses supply that expires soon and isn't planned for (R6.13, M5). */
  exp: z.coerce.boolean().catch(false).optional(),
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
  /** Projected supply (after planned meals) covers every tracked ingredient (R4.3). */
  canMake?: boolean;
  /** Share of the recipe's tracked amounts projected supply covers, 0..1 (R4.4). */
  supplyFraction?: number;
  /** The suggestion score (M5): `raw` ranks; blocked (missing tool, dislike, diet) sorts last. Absent until scored. */
  suggestion?: { raw: number; blocked: boolean } | null;
  /** Days left on the soonest spare expiring ingredient it uses, or null (M5: "Expiring first", "Uses expiring"). */
  expiryDays?: number | null;
}

export const NO_FACTS: HouseholdFacts = { favourite: false, timesCooked: 0, lastCookedAtMs: null, rating: null };

export { missingTools } from "./tools";

export type FactsOf = (id: string) => HouseholdFacts;

export type FilterKey = "cuisine" | "protein" | "meal" | "tags" | "minProtein" | "maxTotal" | "maxActive" | "minRating" | "cooked" | "fav" | "tools" | "maxCost" | "supply" | "exp";

/** "Use what's left" (R4.4): covered fully or nearly fully by what's left after the plan. */
export const USE_WHATS_LEFT = 0.85;

const MEAL_SET = new Set<string>(RECIPE_COURSES);

/** Meal types a recipe is tagged with (tags carry the course: breakfast, lunch, dinner, snack, side). */
export function mealTypesOf(r: { tags: readonly string[] }): string[] {
  return r.tags.map((t) => t.toLowerCase()).filter((t) => MEAL_SET.has(t));
}

/**
 * A side dish only (R4.28): tagged "side" and with no other meal type. Never suggested as a meal (Suggested, the
 * optimiser, expiry and use-it-up proposals) and last in a Suggested sort; still pickable next to a main in Create meal.
 */
export function isSideOnly(r: { tags: readonly string[] }): boolean {
  const types = mealTypesOf(r);
  return types.includes("side") && types.length === 1;
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
  if (skip !== "supply" && s.supply === "can" && !facts.canMake) return false;
  if (skip !== "supply" && s.supply === "useup" && !(facts.canMake || (facts.supplyFraction ?? 0) >= USE_WHATS_LEFT)) return false;
  if (skip !== "exp" && s.exp && (facts.expiryDays === null || facts.expiryDays === undefined)) return false;
  if (skip !== "maxCost" && s.maxCost && (facts.costPerServingCents === null || facts.costPerServingCents === undefined || facts.costPerServingCents > s.maxCost)) return false;
  return true;
}

function bySuggestion(fa: HouseholdFacts, fb: HouseholdFacts): number {
  const ka = fa.suggestion ? (fa.suggestion.blocked ? -1e9 : fa.suggestion.raw) : -2e9;
  const kb = fb.suggestion ? (fb.suggestion.blocked ? -1e9 : fb.suggestion.raw) : -2e9;
  return kb - ka;
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
    case "expiry":
      return (fa.expiryDays ?? Number.MAX_SAFE_INTEGER) - (fb.expiryDays ?? Number.MAX_SAFE_INTEGER) || bySuggestion(fa, fb);
    case "suggested":
      // Blocked last, then the score; unscored (still computing) falls back to Newest.
      return bySuggestion(fa, fb) || b.createdAtMs - a.createdAtMs;
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
  for (const k of ["minProtein", "maxTotal", "maxActive", "minRating", "cooked", "fav", "tools", "maxCost", "supply", "exp"] as const) if (s[k]) n++;
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
