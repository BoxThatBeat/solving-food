// /recipes/:id/cook: cook one recipe that isn't on the plan (PRD R4.10–R4.12). Done cooking still deducts supply and
// records a cook event with no plan item.
import { createFileRoute } from "@tanstack/react-router";
import { useActiveHousehold } from "@/data/households";
import { useRecipe } from "@/data/recipes";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CookSession } from "@/components/cook/CookSession";
import { cookSearchSchema, initialStepOf } from "@/components/cook/cookSearch";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/recipes/$id/cook")({
  validateSearch: (s) => cookSearchSchema.parse(s),
  component: CookRecipe,
});

function CookRecipe() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const s = useReadySession();
  const hh = useActiveHousehold();
  const r = useRecipe(id);
  if (r.data === undefined) return null;
  if (!r.data)
    return (
      <PageBody>
        <EmptyState>This recipe doesn't exist.</EmptyState>
      </PageBody>
    );
  const servings = search.servings ?? r.data.servings;
  return (
    <CookSession
      target={{ key: `recipe-${id}-${servings}`, title: r.data.title, kicker: "Recipe", recipes: [{ recipeId: id, servingsMultiplier: 1 }], servings, exitTo: `/recipes/${id}`, path: `/recipes/${id}/cook` }}
      hid={hh.id}
      uid={s.user.uid}
      tools={hh.data?.settings?.tools ?? []}
      initialStep={initialStepOf(search)}
    />
  );
}
