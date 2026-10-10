import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { collectionSearchSchema, toSearchParams } from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { RecipeBrowser } from "@/components/recipes/RecipeBrowser";
import { RecipeDetail, type DetailContext } from "@/components/recipes/RecipeDetail";
import { useRecipe } from "@/data/recipes";
import { useHousehold } from "@/data/households";
import { useSession } from "@/session/useSession";
import { MD, useMediaQuery } from "@/hooks/useMediaQuery";

// /recipes/:id renders for signed-out visitors too (share links, R4.21). Signed in, wide screens show the list beside
// the recipe, as the prototype's two panes (md: tablet, lg+: desktop).
export const Route = createFileRoute("/_app/recipes/$id/")({
  validateSearch: (s) => collectionSearchSchema.parse(s),
  component: RecipePage,
});

function RecipePage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const session = useSession();
  const ready = session.status === "ready" ? session : null;
  const recipe = useRecipe(id);
  const hh = useHousehold(ready?.activeHouseholdId ?? null);
  const navigate = useNavigate();
  const wide = useMediaQuery(MD);
  const ctx: DetailContext | null = ready ? { uid: ready.user.uid, hid: ready.activeHouseholdId, household: hh.data } : null;
  const close = () => void navigate({ to: "/recipes", search: toSearchParams(search) as never });

  const detail =
    recipe.data === undefined ? (
      <p className="m-0 p-4 text-sm font-semibold" role="status">
        Loading recipe…
      </p>
    ) : recipe.data === null || (!ready && recipe.data.status !== "active") ? (
      <PageBody>
        <EmptyState>
          This recipe doesn&apos;t exist (it may have been deleted).{" "}
          {ready ? (
            <Link to="/recipes" className="underline">
              Back to recipes
            </Link>
          ) : null}
        </EmptyState>
      </PageBody>
    ) : null;

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-[48rem]">
        {detail ?? <RecipeDetail id={id} recipe={recipe.data!} ctx={null} />}
      </div>
    );
  }

  return (
    <div className="flex min-h-full">
      {wide ? (
        <div className="min-w-0 flex-1">
          <PageBody className="max-w-[112.5rem]">
            <RecipeBrowser search={search} selectedId={id} compact />
          </PageBody>
        </div>
      ) : null}
      <div className="w-full flex-none md:sticky md:top-0 md:h-dvh md:w-[min(27.5rem,50%)] md:overflow-y-auto md:border-l-bw lg:w-[min(36.25rem,34%)]" data-testid="recipe-pane">
        {detail ?? <RecipeDetail id={id} recipe={recipe.data!} ctx={ctx} onClose={close} closeLabel={wide ? "Close" : "Back"} pane={wide} />}
      </div>
    </div>
  );
}
