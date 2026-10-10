import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { collectionSearchSchema, toSearchParams, type CollectionSearch } from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { CollectionView } from "@/components/CollectionView";

// Saved meals arrive in M2; the page already uses the shared <CollectionView> (R4.7) so search, filters, and sort
// behave the same as on Recipes once there are meals to list.
export const Route = createFileRoute("/_app/meals/")({
  validateSearch: (s) => collectionSearchSchema.parse(s),
  component: MealsPage,
});

function MealsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const onSearchChange = React.useCallback(
    (next: CollectionSearch, opts?: { replace?: boolean }) => void navigate({ to: "/meals", search: toSearchParams(next) as never, replace: opts?.replace ?? false }),
    [navigate],
  );
  return (
    <PageBody>
      <CollectionView
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Search meals…"
        noun="meals"
        countFor={() => 0}
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
        <PageHeader title="Meals" kicker="Saved meals" />
        <EmptyState>No saved meals yet.</EmptyState>
      </CollectionView>
    </PageBody>
  );
}
