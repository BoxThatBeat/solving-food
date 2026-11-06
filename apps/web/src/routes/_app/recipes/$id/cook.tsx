// /recipes/:id/cook: cook one recipe (PRD R4.10–R4.12). M29 (R9.7): when the current period has this recipe planned,
// the cook is that planned meal (all of its recipes, at its servings), so Done cooking marks it cooked; otherwise
// Done cooking still deducts supply and records a cook event with no plan item.
import { createFileRoute } from "@tanstack/react-router";
import { planItemTitle } from "@solving-food/core";
import { useActiveHousehold } from "@/data/households";
import { useRecipe } from "@/data/recipes";
import { useRecipeDocs } from "@/data/plan";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CookSession } from "@/components/cook/CookSession";
import { cookSearchSchema, initialStepOf } from "@/components/cook/cookSearch";
import { planCookTarget } from "@/components/cook/planTarget";
import { usePlannedMeal } from "@/components/cook/usePlannedMeal";
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
  const planned = usePlannedMeal(r.data ? { recipeId: id } : null);
  const plannedRecipes = useRecipeDocs(planned?.data.recipes.map((x) => x.recipeId) ?? []);
  if (r.data === undefined || (r.data && planned === undefined)) return null;
  if (!r.data)
    return (
      <PageBody>
        <EmptyState>This recipe doesn't exist.</EmptyState>
      </PageBody>
    );
  const common = { hid: hh.id, uid: s.user.uid, tools: hh.data?.settings?.tools ?? [], initialStep: initialStepOf(search) };
  if (planned) {
    // The title names the meal in history: wait for its recipes rather than call it "Recipe".
    if (planned.data.recipes.some((x) => !plannedRecipes.has(x.recipeId)) && !planned.data.name) return null;
    const title = planItemTitle(planned.data, (rid) => plannedRecipes.get(rid)?.title);
    return <CookSession key={`plan-${planned.id}`} target={planCookTarget(planned.id, planned.data, title, { exitTo: `/recipes/${id}`, path: `/recipes/${id}/cook` })} {...common} />;
  }
  const servings = search.servings ?? r.data.servings;
  return <CookSession key={`recipe-${id}-${servings}`} target={{ key: `recipe-${id}-${servings}`, title: r.data.title, kicker: "Recipe", recipes: [{ recipeId: id, servingsMultiplier: 1 }], servings, exitTo: `/recipes/${id}`, path: `/recipes/${id}/cook` }} {...common} />;
}
