import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { RecipeEditor } from "@/components/recipes/RecipeEditor";
import { newRecipeId } from "@/data/recipes";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/recipes/new")({
  component: NewRecipePage,
});

function NewRecipePage() {
  const s = useReadySession();
  const [id] = React.useState(newRecipeId);
  return (
    <PageBody className="max-w-[48rem]">
      <Link to="/recipes" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Recipes
      </Link>
      <PageHeader title="New recipe" kicker="Shared library" />
      <RecipeEditor id={null} newId={id} recipe={null} uid={s.user.uid} />
    </PageBody>
  );
}
