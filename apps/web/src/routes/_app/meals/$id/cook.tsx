// /meals/:id/cook: cook a saved meal straight from the Meals list (PRD R5.6): choose the order, cook each recipe, then
// review. Servings default to the household's (R11.12). M29 (R9.7): when the current period has this meal planned (made
// from it, or the same recipes), the cook is that planned meal, so Done cooking marks it cooked.
import { createFileRoute } from "@tanstack/react-router";
import { planItemTitle } from "@solving-food/core";
import { useActiveHousehold } from "@/data/households";
import { useMeal, useRecipeDocs } from "@/data/plan";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CookSession } from "@/components/cook/CookSession";
import { cookSearchSchema, initialStepOf } from "@/components/cook/cookSearch";
import { planCookTarget } from "@/components/cook/planTarget";
import { usePlannedMeal } from "@/components/cook/usePlannedMeal";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/meals/$id/cook")({
  validateSearch: (s) => cookSearchSchema.parse(s),
  component: CookMeal,
});

function CookMeal() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const s = useReadySession();
  const hh = useActiveHousehold();
  const meal = useMeal(id);
  const planned = usePlannedMeal(meal.data ? { savedMealId: id, recipeIds: meal.data.recipes.map((r) => r.recipeId) } : null);
  const plannedRecipes = useRecipeDocs(planned?.data.recipes.map((x) => x.recipeId) ?? []);
  if (meal.data === undefined || hh.data === undefined || (meal.data && planned === undefined)) return null;
  if (!meal.data)
    return (
      <PageBody>
        <EmptyState>This meal doesn't exist.</EmptyState>
      </PageBody>
    );
  const common = { hid: hh.id, uid: s.user.uid, tools: hh.data?.settings?.tools ?? [], initialStep: initialStepOf(search) };
  if (planned) {
    if (planned.data.recipes.some((x) => !plannedRecipes.has(x.recipeId)) && !planned.data.name) return null;
    const title = planItemTitle(planned.data, (rid) => plannedRecipes.get(rid)?.title);
    return <CookSession target={planCookTarget(planned.id, planned.data, title, { exitTo: `/meals/${id}`, path: `/meals/${id}/cook` })} {...common} />;
  }
  const servings = search.servings ?? hh.data?.defaultServings ?? 4;
  return (
    <CookSession
      target={{ key: `meal-${id}-${servings}`, title: meal.data.name, kicker: "Meal", recipes: meal.data.recipes, sides: meal.data.sides, servings, savedMealId: id, exitTo: `/meals/${id}`, path: `/meals/${id}/cook` }}
      {...common}
    />
  );
}
