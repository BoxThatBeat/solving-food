// <TrashList> (TECHNICAL_SPECS §4.4, §12; PRD R4.26): trashed recipes with the days left before the weekly purge and
// a Restore button.
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { taxonomyLabel } from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { restoreRecipe, useRecipesWithStatus } from "@/data/recipes";
import { lookupFromMap, useAllIngredients } from "@/data/ingredients";
import { useReadySession } from "@/session/useSession";
import { RecipeImage } from "@/components/recipes/RecipeImage";

export const Route = createFileRoute("/_app/recipes/trash")({
  component: TrashPage,
});

const DAY = 86_400_000;

function TrashPage() {
  const s = useReadySession();
  const notify = useNotify();
  const trashed = useRecipesWithStatus("trashed");
  const ing = useAllIngredients();
  const [now] = React.useState(() => Date.now());
  const list = [...(trashed.docs ?? [])].sort((a, b) => (b.data.trashedAt?.toMillis?.() ?? 0) - (a.data.trashedAt?.toMillis?.() ?? 0));
  const restore = async (id: string, title: string) => {
    try {
      await restoreRecipe(id, s.user.uid, lookupFromMap(ing.byId));
      notify({ kind: "success", message: `“${title}” restored`, link: { to: `/recipes/${id}`, label: "Open recipe" } });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't restore: ${(e as Error).message}` });
    }
  };
  return (
    <PageBody className="max-w-[60rem]">
      <Link to="/recipes" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Recipes
      </Link>
      <PageHeader title="Trash" kicker="Recipes · kept 30 days" />
      <p className="m-0 max-w-[70ch] text-sm font-semibold text-sub">
        Deleted recipes are hidden for everyone, in every household. Restore one to bring it back; after 30 days it&apos;s deleted for good.
      </p>
      {trashed.docs === undefined ? (
        <p className="m-0 text-sm font-semibold" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <EmptyState>Trash is empty.</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Trashed recipes">
          {list.map(({ id, data: r }) => {
            const at = r.trashedAt?.toMillis?.() ?? now;
            const left = Math.max(0, 30 - Math.floor((now - at) / DAY));
            return (
              <li key={id} className="flex items-center gap-3 rounded-ui border-bw bg-base p-2.5 shadow-hard">
                <div className="size-16 flex-none overflow-hidden rounded-ui border-2 border-line">
                  <RecipeImage base={r.imagePaths[0]} cuisine={r.cuisine} alt="" sizes="4rem" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link to="/recipes/$id" params={{ id }} className="text-[0.9375rem] font-extrabold text-ink no-underline">
                    {r.title}
                  </Link>
                  <span className="font-mono text-[0.625rem] font-semibold uppercase">
                    {taxonomyLabel(r.cuisine)} · {left} day{left === 1 ? "" : "s"} left
                  </span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => restore(id, r.title)} aria-label={`Restore ${r.title}`}>
                  Restore
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
