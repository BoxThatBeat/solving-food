// Ingredients list: search the shared ingredient set and find the ones flagged for review (new ingredients from drop
// imports or the picker, missing conversions or protein).
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { taxonomyLabel } from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/chip";
import { searchIngredients, useAllIngredients } from "@/data/ingredients";

export const Route = createFileRoute("/_app/ingredients/")({
  component: IngredientsPage,
});

function IngredientsPage() {
  const ing = useAllIngredients();
  const [q, setQ] = React.useState("");
  const [review, setReview] = React.useState(false);
  const list = React.useMemo(() => {
    const base = ing.list ?? [];
    const found = q.trim() ? searchIngredients(base, q, 300) : [...base].sort((a, b) => a.name.localeCompare(b.name));
    return review ? found.filter((i) => i.needsReview) : found;
  }, [ing.list, q, review]);
  const reviewCount = (ing.list ?? []).filter((i) => i.needsReview).length;
  return (
    <PageBody className="max-w-[60rem]">
      <Link to="/recipes" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Recipes
      </Link>
      <PageHeader title="Ingredients" kicker={`${ing.list?.length ?? "…"} shared ingredients`} />
      <div className="flex flex-wrap items-center gap-2.5">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ingredients…" aria-label="Search ingredients" className="max-w-[30rem] flex-1" />
        <ToggleChip pressed={review} onClick={() => setReview((v) => !v)} count={reviewCount}>
          Needs review
        </ToggleChip>
      </div>
      {ing.list && list.length === 0 ? <EmptyState>No ingredients match.</EmptyState> : null}
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
    </PageBody>
  );
}
