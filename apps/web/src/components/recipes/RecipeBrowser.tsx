// The Recipes library list: <CollectionView> over the search index, the duplicate-review banner, Add recipe, and the
// card grid. Rendered by /recipes, and beside the open recipe on wide screens (the prototype's list + detail panes).
import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  applyCollection,
  optionCount,
  SORT_LABELS,
  tagCounts,
  toSearchParams,
  type CollectionSearch,
} from "@solving-food/core";
import { CollectionView } from "@/components/CollectionView";
import { EmptyState } from "@/components/AppShell";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useActiveHousehold } from "@/data/households";
import { setFavourite, useHouseholdFacts, useNotes } from "@/data/householdRecipes";
import { useRecipesWithStatus } from "@/data/recipes";
import { useRecipeIndex, useRecipeSearch } from "@/search/useRecipeSearch";
import { useNotify } from "@/components/notifications-context";
import { cn } from "@/lib/utils";
import { RecipeCard } from "./RecipeCard";
import { usePlanModel } from "@/data/planModel";
import { DuplicateReviewSheet } from "./DuplicateReview";
import { useCreateMeal } from "@/components/plan/plan-sheet-context";
import { useSuggestions } from "@/data/suggestions";

export function RecipeBrowser({
  search,
  selectedId,
  compact,
  reviewOpen,
}: {
  search: CollectionSearch;
  selectedId?: string;
  /** Beside an open recipe: fewer columns. */
  compact?: boolean;
  reviewOpen?: boolean;
}) {
  const navigate = useNavigate();
  const notify = useNotify();
  const hh = useActiveHousehold();
  const summaries = useRecipeIndex();
  const notes = useNotes(hh.id);
  const plan = usePlanModel();
  const suggestions = useSuggestions();
  const factsOf = useHouseholdFacts(hh.id, summaries, plan.supply.loading ? undefined : plan.projected, suggestions.byId);
  const pending = useRecipesWithStatus("pendingDuplicateReview");
  const openCreateMeal = useCreateMeal();
  const all = React.useMemo(() => summaries ?? [], [summaries]);
  const matches = useRecipeSearch(all, notes, search.q ?? "");
  const result = React.useMemo(() => applyCollection(all, search, factsOf, matches), [all, search, factsOf, matches]);
  const tags = React.useMemo(() => tagCounts(all), [all]);
  const params = toSearchParams(search);

  const onSearchChange = React.useCallback(
    (next: CollectionSearch, opts?: { replace?: boolean }) => {
      void navigate({
        to: selectedId ? "/recipes/$id" : "/recipes",
        params: selectedId ? { id: selectedId } : undefined,
        search: toSearchParams(next) as never,
        replace: opts?.replace ?? false,
      } as never);
    },
    [navigate, selectedId],
  );

  const setReview = (open: boolean) => {
    void navigate({ to: "/recipes", search: { ...params, ...(open ? { review: 1 } : {}) } as never, replace: true });
  };

  const fav = (id: string, title: string, on: boolean) => {
    setFavourite(hh.id, id, on).catch(() => notify({ kind: "error", message: `Couldn't update favourite for ${title}` }));
  };

  const pendingCount = pending.docs?.length ?? 0;
  const sortLabel = SORT_LABELS[search.sort ?? "suggested"].toUpperCase();

  return (
    <CollectionView
      search={search}
      onSearchChange={onSearchChange}
      placeholder="Search recipes, ingredients, tags…"
      noun="recipes"
      countFor={(s) => applyCollection(all, s, factsOf, s.q === search.q ? matches : null).items.length}
      optionCount={(key, value) => optionCount(all, search, factsOf, matches, key, value)}
      tags={tags}
      header={
        <div className="grid grid-cols-2 overflow-hidden rounded-ui border-2 border-line bg-base md:hidden" role="navigation" aria-label="Library">
          <Link to="/recipes" aria-current="page" className="bg-acc py-2.5 text-center text-[0.8125rem] font-extrabold text-onc no-underline">
            Recipes
          </Link>
          <Link to="/meals" className="py-2.5 text-center text-[0.8125rem] font-extrabold text-ink no-underline">
            Meals
          </Link>
        </div>
      }
    >
      {pendingCount > 0 ? (
        <button
          type="button"
          data-testid="duplicate-banner"
          onClick={() => setReview(true)}
          className="flex max-w-[60rem] cursor-pointer items-center gap-2.5 rounded-ui border-2 border-dashed border-line bg-base px-3 py-[0.5625rem] text-left text-[0.8125rem] font-bold text-ink"
        >
          <span className="rounded border-2 border-line bg-yellow px-1.5 py-0.5 font-mono text-[0.625rem] font-extrabold text-onc">{pendingCount}</span>
          <span className="flex-1">
            {pendingCount === 1 ? "Possible duplicate from the drop folder. Review it." : `${pendingCount} possible duplicates from the drop folder. Review them.`}
          </span>
          <span aria-hidden className="font-extrabold">
            →
          </span>
        </button>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-col gap-[0.1875rem]">
          <h1 className="m-0 font-display text-[1.75rem] leading-none font-normal md:text-[2.25rem]">Recipes</h1>
          <span className="font-mono text-[0.65625rem] font-bold" data-testid="recipe-count">
            {summaries ? `${result.items.length} OF ${result.total} · ${sortLabel}` : "LOADING…"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/recipes/trash"
            className="rounded-ui px-1 py-2 text-[0.8125rem] font-extrabold text-ink underline underline-offset-2"
          >
            Trash
          </Link>
          <AddRecipeSheet />
        </div>
      </div>

      {summaries && result.total === 0 ? (
        <EmptyState>
          No recipes yet.{" "}
          <Link to="/recipes/new" className="underline">
            Add one
          </Link>{" "}
          or{" "}
          <Link to="/drop" className="underline">
            drop .cook files
          </Link>
          .
        </EmptyState>
      ) : summaries && result.items.length === 0 ? (
        <EmptyState>
          No recipes match.{" "}
          <button type="button" className="cursor-pointer bg-transparent font-bold text-ink underline" onClick={() => onSearchChange({})}>
            Clear search and filters
          </button>
        </EmptyState>
      ) : (
        <ul
          className={cn(
            "m-0 grid list-none gap-x-3 gap-y-3.5 p-0",
            compact ? "grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))]" : "grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))]",
          )}
          aria-label="Recipes"
        >
          {result.items.map((r) => (
            <li key={r.id} className="min-w-0">
              <RecipeCard recipe={r} facts={factsOf(r.id)} selected={r.id === selectedId} search={params} onFavourite={(on) => fav(r.id, r.title, on)} onPlan={openCreateMeal ? () => openCreateMeal({ recipeIds: [r.id] }) : undefined} />
            </li>
          ))}
        </ul>
      )}
      <DuplicateReviewSheet open={!!reviewOpen} onOpenChange={setReview} />
    </CollectionView>
  );
}

function AddRecipeSheet() {
  return (
    <Sheet>
      <SheetTrigger className="cursor-pointer rounded-ui border-2 border-line bg-base px-3 py-2.5 text-[0.8125rem] font-extrabold text-ink shadow-[3px_3px_0_var(--line)]">
        + Add recipe
      </SheetTrigger>
      <SheetContent title="Add recipe">
        <SheetClose asChild>
          <Link to="/recipes/new" className="flex items-center justify-between rounded-ui border-bw bg-base p-3.5 text-ink no-underline shadow-hard">
            <span className="flex flex-col gap-1">
              <span className="text-lg font-extrabold">Manual entry</span>
              <span className="text-xs font-semibold text-sub">Title, ingredients, steps, photo. Every edit is versioned.</span>
            </span>
            <span aria-hidden className="text-lg font-extrabold">
              →
            </span>
          </Link>
        </SheetClose>
        <SheetClose asChild>
          <Link to="/drop" className="flex items-center justify-between rounded-ui border-bw bg-base p-3.5 text-ink no-underline shadow-hard">
            <span className="flex flex-col gap-1">
              <span className="text-lg font-extrabold">Drop folder</span>
              <span className="text-xs font-semibold text-sub">
                Give your LLM a link or photo with the Solving Food skill. It writes a Cooklang file; drop it here and we import it.
              </span>
            </span>
            <span aria-hidden className="text-lg font-extrabold">
              →
            </span>
          </Link>
        </SheetClose>
        <p className="m-0 text-xs font-semibold text-sub">The library is shared. Anyone can edit; every edit is versioned.</p>
      </SheetContent>
    </Sheet>
  );
}
