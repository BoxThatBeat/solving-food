// /meals/:id/cook: cook a saved meal straight from the Meals list (PRD R5.6): choose the order, cook each recipe, then
// review. Servings default to the household's (R11.12).
import { createFileRoute } from "@tanstack/react-router";
import { useActiveHousehold } from "@/data/households";
import { useMeal } from "@/data/plan";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CookSession } from "@/components/cook/CookSession";
import { cookSearchSchema, initialStepOf } from "@/components/cook/cookSearch";
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
  if (meal.data === undefined || hh.data === undefined) return null;
  if (!meal.data)
    return (
      <PageBody>
        <EmptyState>This meal doesn't exist.</EmptyState>
      </PageBody>
    );
  const servings = search.servings ?? hh.data?.defaultServings ?? 4;
  return (
    <CookSession
      target={{ key: `meal-${id}-${servings}`, title: meal.data.name, kicker: "Meal", recipes: meal.data.recipes, servings, savedMealId: id, exitTo: `/meals/${id}`, path: `/meals/${id}/cook` }}
      hid={hh.id}
      uid={s.user.uid}
      tools={hh.data?.settings?.tools ?? []}
      initialStep={initialStepOf(search)}
    />
  );
}
