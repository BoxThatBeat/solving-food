// /plan/:itemId/cook: cook a planned meal (PRD R5.6, R9.1–R9.3). The plan item's recipes, servings, and saved meal feed
// <CookSession>; Done cooking marks the item cooked through `finishCooking`.
import { createFileRoute } from "@tanstack/react-router";
import { doc } from "firebase/firestore";
import { planItemTitle } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc } from "@/data/live";
import { useActiveHousehold } from "@/data/households";
import { useRecipeDocs, type StoredPlanItem } from "@/data/plan";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CookSession } from "@/components/cook/CookSession";
import { cookSearchSchema, initialStepOf } from "@/components/cook/cookSearch";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/plan_/$itemId/cook")({
  validateSearch: (s) => cookSearchSchema.parse(s),
  component: CookPlanItem,
});

function CookPlanItem() {
  const { itemId } = Route.useParams();
  const search = Route.useSearch();
  const s = useReadySession();
  const hh = useActiveHousehold();
  const item = useLiveDoc<StoredPlanItem>(doc(db, "households", hh.id, "planItems", itemId), `households/${hh.id}/planItems/${itemId}`);
  const recipes = useRecipeDocs(item.data?.recipes.map((r) => r.recipeId) ?? []);
  if (item.data === undefined) return null;
  if (!item.data || !item.data.recipes.length)
    return (
      <PageBody>
        <EmptyState>This meal isn't in the plan any more.</EmptyState>
      </PageBody>
    );
  const it = item.data;
  // The title names the meal in history: wait for the recipes rather than call it "Recipe".
  if (it.recipes.some((r) => !recipes.has(r.recipeId)) && !it.name) return null;
  const title = planItemTitle(it, (id) => recipes.get(id)?.title);
  return (
    <CookSession
      target={{
        key: `plan-${itemId}`,
        title,
        kicker: "Meal",
        recipes: it.recipes,
        servings: it.servings,
        planItemId: itemId,
        savedMealId: it.savedMealId,
        mealType: it.mealType,
        exitTo: "/plan",
        path: `/plan/${itemId}/cook`,
      }}
      hid={hh.id}
      uid={s.user.uid}
      tools={hh.data?.settings?.tools ?? []}
      initialStep={initialStepOf(search)}
    />
  );
}
