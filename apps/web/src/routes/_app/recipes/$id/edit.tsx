import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { RecipeEditor } from "@/components/recipes/RecipeEditor";
import { useRecipe } from "@/data/recipes";
import { useReadySession } from "@/session/useSession";
import * as React from "react";

export const Route = createFileRoute("/_app/recipes/$id/edit")({
  component: EditRecipePage,
});

function EditRecipePage() {
  const { id } = Route.useParams();
  const s = useReadySession();
  const live = useRecipe(id);
  // The editor works on a copy taken when it opens (§11); later saves elsewhere surface as "edited elsewhere".
  const [opened, setOpened] = React.useState<typeof live.data>(undefined);
  if (opened === undefined && live.data !== undefined) setOpened(live.data);
  return (
    <PageBody className="max-w-[48rem]">
      <Link to="/recipes/$id" params={{ id }} className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Back to recipe
      </Link>
      <PageHeader title="Edit recipe" kicker={opened ? `Shared library · v${opened.version}` : "Shared library"} />
      {opened === undefined ? (
        <p className="m-0 text-sm font-semibold" role="status">
          Loading…
        </p>
      ) : opened === null || opened.status === "trashed" ? (
        <EmptyState>This recipe can&apos;t be edited (it was deleted or is in Trash).</EmptyState>
      ) : (
        <RecipeEditor id={id} newId={id} recipe={opened} uid={s.user.uid} />
      )}
    </PageBody>
  );
}
