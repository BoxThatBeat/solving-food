// Saved meals (PRD R5.2, R4.7; spec §12): <CollectionView> over the meals collection, combined client-side with the
// recipe index (no function at this scale). Meals are born in Create meal (R5.8); there's no "new meal" page.
import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { applyCollection, collectionSearchSchema, mealRow, optionCount, SORT_LABELS, tagCounts, toSearchParams, type CollectionSearch } from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CollectionView } from "@/components/CollectionView";
import { MealCard } from "@/components/meals/MealCard";
import { useCreateMeal } from "@/components/plan/plan-sheet-context";
import { useNotify } from "@/components/notifications-context";
import { Button } from "@/components/ui/button";
import { useActiveHousehold } from "@/data/households";
import { useMealFacts } from "@/data/meals";
import { setMealFavourite, useMeals, usePlanItems } from "@/data/plan";
import { useRecipeIndex } from "@/search/useRecipeSearch";

export const Route = createFileRoute("/_app/meals/")({
  validateSearch: (s) => collectionSearchSchema.parse(s),
  component: MealsPage,
});

function MealsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const notify = useNotify();
  const openCreateMeal = useCreateMeal()!;
  const hh = useActiveHousehold();
  const meals = useMeals();
  const summaries = useRecipeIndex();
  const byId = React.useMemo(() => new Map((summaries ?? []).map((r) => [r.id, r])), [summaries]);
  const rows = React.useMemo(() => (meals.docs ?? []).map((m) => mealRow(m.id, m.data, (id) => byId.get(id))), [meals.docs, byId]);
  const factsOf = useMealFacts(hh.id, rows);
  const planItems = usePlanItems(hh.id, hh.data?.currentPeriodId);
  const inPlan = new Set((planItems.docs ?? []).filter((p) => p.data.status === "planned" && p.data.savedMealId).map((p) => p.data.savedMealId!));

  const matches = React.useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    if (!q) return null;
    return new Map(rows.filter((r) => [r.title, ...r.ingredientNames, ...r.tags, ...r.recipeIds.map((id) => byId.get(id)?.title ?? "")].some((t) => t.toLowerCase().includes(q))).map((r) => [r.id, 1]));
  }, [rows, search.q, byId]);
  const result = React.useMemo(() => applyCollection(rows, search, factsOf, matches), [rows, search, factsOf, matches]);
  const tags = React.useMemo(() => tagCounts(rows), [rows]);
  const onSearchChange = React.useCallback(
    (next: CollectionSearch, opts?: { replace?: boolean }) => void navigate({ to: "/meals", search: toSearchParams(next) as never, replace: opts?.replace ?? false }),
    [navigate],
  );
  const copyLink = async (id: string) => {
    const url = `${location.origin}/meals/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify({ kind: "success", message: "Link copied · opens without an account" });
    } catch {
      notify({ kind: "info", message: `Copy this link: ${url}` });
    }
  };

  return (
    <PageBody className="max-w-[112.5rem]">
      <CollectionView
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Search meals…"
        noun="meals"
        countFor={(x) => applyCollection(rows, x, factsOf, x.q === search.q ? matches : null).items.length}
        optionCount={(key, value) => optionCount(rows, search, factsOf, matches, key, value)}
        tags={tags}
        header={
          <div className="grid grid-cols-2 overflow-hidden rounded-ui border-2 border-line bg-base md:hidden" role="navigation" aria-label="Library">
            <Link to="/recipes" className="py-2.5 text-center text-[0.8125rem] font-extrabold text-ink no-underline">
              Recipes
            </Link>
            <Link to="/meals" aria-current="page" className="bg-acc py-2.5 text-center text-[0.8125rem] font-extrabold text-onc no-underline">
              Meals
            </Link>
          </div>
        }
      >
        <div className="flex flex-col gap-[0.1875rem]">
          <h1 className="m-0 font-display text-[1.75rem] leading-none font-normal md:text-[2.25rem]">Meals</h1>
          <span className="font-mono text-[0.65625rem] font-bold" data-testid="meal-count">
            {meals.docs ? `${result.items.length} OF ${rows.length} SAVED · ${SORT_LABELS[search.sort ?? "suggested"].toUpperCase()}` : "LOADING…"}
          </span>
        </div>
        {meals.docs && rows.length === 0 ? (
          <EmptyState>
            <p className="m-0 mb-3">No saved meals yet. Meals are saved from Create meal on the Plan page: pick recipes, then turn on “Save as meal”.</p>
            <Button onClick={() => openCreateMeal()}>+ Create meal</Button>
          </EmptyState>
        ) : meals.docs && result.items.length === 0 ? (
          <EmptyState>No meals match.</EmptyState>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]" aria-label="Saved meals">
            {result.items.map((r) => (
              <li key={r.id} className="min-w-0">
                <MealCard
                  row={rows.find((x) => x.id === r.id)!}
                  facts={factsOf(r.id)}
                  recipes={(id) => byId.get(id)}
                  inPlan={inPlan.has(r.id)}
                  onFavourite={(on) => setMealFavourite(hh.id, r.id, on).catch(() => notify({ kind: "error", message: "Couldn't update the favourite" }))}
                  onCopyLink={() => void copyLink(r.id)}
                  onPlan={() => openCreateMeal({ savedMealId: r.id })}
                />
              </li>
            ))}
          </ul>
        )}
      </CollectionView>
    </PageBody>
  );
}
