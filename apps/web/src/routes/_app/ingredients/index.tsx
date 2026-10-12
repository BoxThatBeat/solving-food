// Ingredients (PRD R4.27, Planning/M8 item 4): the shared catalogue, opening on the ones that need review when there
// are any (new names from imports, missing conversions). Each review card shows the recipes that use it and what it
// looks like ("Looks like: tater tots"), with Merge into… (the mergeIngredient function) and Keep as new (the editor).
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { reviewReasons, taxonomyLabel, type RecipeSummary } from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/chip";
import { MergeSheet } from "@/components/ingredients/MergeSheet";
import { useSuggestions } from "@/components/ingredients/merge";
import { searchIngredients, useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import type { IngredientIndex } from "@solving-food/core";

const searchSchema = z.object({ view: z.enum(["review", "all"]).optional().catch(undefined) });

export const Route = createFileRoute("/_app/ingredients/")({
  validateSearch: searchSchema,
  component: IngredientsPage,
});

const REASON_TEXT = { missingDensity: "density", missingUnitWeight: "weight per piece", missingProtein: "protein" } as const;

function IngredientsPage() {
  const ing = useAllIngredients();
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const recipes = useRecipeIndex();
  const [q, setQ] = React.useState("");
  const all = React.useMemo(() => ing.list ?? [], [ing.list]);
  const toReview = React.useMemo(() => all.filter((i) => i.needsReview).sort((a, b) => a.name.localeCompare(b.name)), [all]);
  // Opens on the review list while anything needs review (R4.27); the choice is kept in the URL.
  const mode = view ?? (ing.list && toReview.length === 0 ? "all" : "review");
  const usedBy = React.useMemo(() => {
    const m = new Map<string, RecipeSummary[]>();
    for (const r of recipes ?? []) for (const id of new Set(r.ingredientIds)) m.set(id, [...(m.get(id) ?? []), r]);
    return m;
  }, [recipes]);
  const list = React.useMemo(() => {
    const base = mode === "review" ? toReview : all;
    return q.trim() ? searchIngredients(base, q, 300) : mode === "review" ? base : [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, toReview, q, mode]);

  return (
    <PageBody className="max-w-[75rem]">
      <PageHeader title="Ingredients" kicker={`${ing.list ? all.length : "…"} shared ingredients${toReview.length ? ` · ${toReview.length} need review` : ""}`} />
      <p className="m-0 max-w-[70ch] text-sm leading-normal font-semibold">
        One list for every household. Recipes, Supply and grocery lines use these, so a duplicate name (an import&apos;s “diced green chilies” next to
        “green chiles”) splits them: <strong>merge</strong> it into the ingredient it means, or <strong>keep it as new</strong> and fill in its conversions.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex gap-2" role="group" aria-label="Show">
          <ToggleChip pressed={mode === "review"} onClick={() => void navigate({ search: { view: "review" }, replace: true })} count={ing.list ? toReview.length : undefined}>
            Needs review
          </ToggleChip>
          <ToggleChip pressed={mode === "all"} onClick={() => void navigate({ search: { view: "all" }, replace: true })} count={ing.list ? all.length : undefined}>
            All
          </ToggleChip>
        </div>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ingredients…" aria-label="Search ingredients" className="max-w-[30rem] min-w-[12rem] flex-1" />
      </div>
      {!ing.list ? <p className="m-0 text-sm font-semibold">Loading…</p> : null}
      {ing.list && list.length === 0 ? <EmptyState>{mode === "review" && !q.trim() ? "Nothing needs review. Every ingredient is complete." : "No ingredients match."}</EmptyState> : null}
      {mode === "review" ? (
        <ul className="m-0 grid list-none grid-cols-1 items-start gap-3 p-0 lg:grid-cols-2 3xl:grid-cols-3" aria-label="Ingredients to review">
          {list.map((i) => (
            <li key={i.id}>
              <ReviewCard ing={i} recipes={usedBy.get(i.id) ?? []} all={all} byId={ing.byId} index={ing.index} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3" aria-label="Ingredients">
          {list.slice(0, 300).map((i) => (
            <li key={i.id}>
              <Link to="/ingredients/$id" params={{ id: i.id }} className="flex items-center justify-between gap-2 rounded-ui border-2 border-line bg-base px-3 py-2.5 text-ink no-underline shadow-hard-sm">
                <span className="text-sm font-extrabold first-letter:uppercase">{i.name}</span>
                <span className="font-mono text-[0.625rem] font-semibold uppercase">
                  {taxonomyLabel(i.category)}
                  {i.needsReview ? " · review" : ""}
                  {i.freeUse ? " · staple" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}

function ReviewCard({
  ing,
  recipes,
  all,
  byId,
  index,
}: {
  ing: IngredientEntry;
  recipes: RecipeSummary[];
  all: readonly IngredientEntry[];
  byId: ReadonlyMap<string, IngredientEntry>;
  index: IngredientIndex;
}) {
  const suggestions = useSuggestions(ing, index, 3);
  const [merging, setMerging] = React.useState<{ target?: string } | null>(null);
  const reasons = reviewReasons(ing);
  const headingId = React.useId();
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-2.5 rounded-ui border-bw bg-base p-3.5 shadow-hard">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="m-0 text-[1.0625rem] font-extrabold first-letter:uppercase">
          {ing.name}
        </h2>
        <span className="font-mono text-[0.625rem] font-bold uppercase">
          {taxonomyLabel(ing.category)}
          {reasons.length ? ` · needs ${reasons.map((r) => REASON_TEXT[r]).join(", ")}` : ""}
        </span>
      </div>
      <p className="m-0 text-[0.8125rem] leading-snug font-semibold">
        {recipes.length ? (
          <>
            Used in{" "}
            {recipes.slice(0, 3).map((r, k) => (
              <React.Fragment key={r.id}>
                {k ? ", " : ""}
                <Link to="/recipes/$id" params={{ id: r.id }} className="font-extrabold text-ink underline">
                  {r.title}
                </Link>
              </React.Fragment>
            ))}
            {recipes.length > 3 ? ` +${recipes.length - 3} more` : ""}
          </>
        ) : (
          <span className="text-sub">Not used in any recipe in the library.</span>
        )}
      </p>
      {suggestions.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-bold" data-testid="looks-like">
          <span className="font-mono text-[0.6875rem] font-bold tracking-[0.06rem] uppercase">Looks like:</span>
          {suggestions.map((sug, k) => {
            const t = byId.get(sug.id);
            if (!t) return null;
            return (
              <React.Fragment key={sug.id}>
                {k ? <span aria-hidden>·</span> : null}
                <button
                  type="button"
                  onClick={() => setMerging({ target: sug.id })}
                  aria-label={`Merge ${ing.name} into ${t.name}`}
                  className="inline-flex min-h-6 cursor-pointer items-center bg-transparent p-0 text-[0.8125rem] font-extrabold text-ink underline underline-offset-2"
                >
                  {t.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        <p className="m-0 text-[0.8125rem] font-semibold text-sub">Nothing in the catalogue looks like it.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setMerging({})}>
          Merge into…
        </Button>
        <Button size="sm" variant="secondary" asChild>
          <Link to="/ingredients/$id" params={{ id: ing.id }} aria-label={`Keep ${ing.name} as new`}>
            Keep as new
          </Link>
        </Button>
      </div>
      {merging ? (
        <MergeSheet open onOpenChange={(o) => !o && setMerging(null)} from={ing} all={all} byId={byId} index={index} initialTarget={merging.target} />
      ) : null}
    </article>
  );
}
