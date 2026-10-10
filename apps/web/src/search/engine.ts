// Full-text recipe search (TECHNICAL_SPECS §9 "Search", PRD R4.1): MiniSearch over title, tags, ingredient names, and
// the household's notes. Shared by the in-page path and the Web Worker (used above WORKER_THRESHOLD recipes).
import MiniSearch from "minisearch";
import type { RecipeSummary } from "@solving-food/core";

export const WORKER_THRESHOLD = 1000;

export interface SearchDoc {
  id: string;
  title: string;
  tags: string;
  ingredients: string;
  cuisine: string;
  notes: string;
}

export function toSearchDocs(summaries: readonly RecipeSummary[], notes: ReadonlyMap<string, string>): SearchDoc[] {
  return summaries.map((r) => ({
    id: r.id,
    title: r.title,
    tags: r.tags.join(" "),
    ingredients: r.ingredientNames.join(" "),
    cuisine: r.cuisine.replace(/-/g, " "),
    notes: notes.get(r.id) ?? "",
  }));
}

export function buildIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    fields: ["title", "tags", "ingredients", "cuisine", "notes"],
    storeFields: [],
    searchOptions: { boost: { title: 3, tags: 1.5, ingredients: 1.2 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
  });
  ms.addAll(docs);
  return ms;
}

/** IDs matching `q` with relevance scores; null for an empty query (no text filter). */
export function runQuery(ms: MiniSearch<SearchDoc>, q: string): Map<string, number> | null {
  const t = q.trim();
  if (!t) return null;
  return new Map(ms.search(t).map((r) => [String(r.id), r.score]));
}
