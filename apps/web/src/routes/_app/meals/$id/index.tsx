// A saved meal (PRD R5.2, R4.21; spec §12 `/meals/:id`): its recipes with servings multipliers and times, favourite,
// copy link, Add to plan (opens Create meal with this meal selected), rename, change recipes, delete. Renders for
// signed-out visitors too (share link): then only the meal and its recipes show.
import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Star, X } from "lucide-react";
import { formatProtein, MEAL_RECIPES_MAX, taxonomyLabel, type RecipeRef } from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { useNotify } from "@/components/notifications-context";
import { useCreateMeal } from "@/components/plan/plan-sheet-context";
import { RecipeImage } from "@/components/recipes/RecipeImage";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/chip";
import { Stepper } from "@/components/ui/stepper";
import { useSession } from "@/session/useSession";
import { deleteMeal, setMealFavourite, updateMeal, useMeal, useMealFavourites, useRecipeDocs } from "@/data/plan";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/meals/$id/")({
  component: MealPage,
});

function MealPage() {
  const { id } = Route.useParams();
  const session = useSession();
  const ready = session.status === "ready" ? session : null;
  const meal = useMeal(id);
  const notify = useNotify();
  const navigate = useNavigate();
  const openCreateMeal = useCreateMeal();
  const data = meal.data;
  const recipes = useRecipeDocs(data?.recipes.map((r) => r.recipeId) ?? []);
  const favs = useMealFavourites(ready?.activeHouseholdId ?? null);
  const fav = favs.has(id);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  if (meal.data === undefined) return <PageBody>Loading…</PageBody>;
  if (!data)
    return (
      <PageBody>
        <EmptyState>This meal doesn't exist (it may have been deleted).</EmptyState>
      </PageBody>
    );

  const uid = ready?.user.uid;
  const save = (patch: { name?: string; recipes?: RecipeRef[] }) =>
    uid ? updateMeal(id, patch, uid).catch((e) => notify({ kind: "error", message: `Couldn't save: ${(e as Error).message}` })) : undefined;
  const total = data.recipes.reduce((a, r) => {
    const rec = recipes.get(r.recipeId);
    return a + (rec ? rec.prepMin + rec.cookMin : 0);
  }, 0);
  const active = data.recipes.reduce((a, r) => a + (recipes.get(r.recipeId)?.prepMin ?? 0), 0);
  const copyLink = async () => {
    const url = `${location.origin}/meals/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify({ kind: "success", message: "Link copied · opens without an account" });
    } catch {
      notify({ kind: "info", message: `Copy this link: ${url}` });
    }
  };

  return (
    <PageBody className="max-w-[60rem]">
      {ready ? (
        <Link to="/meals" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
          Meals
        </Link>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="kicker">Saved meal · {data.recipes.length} recipe{data.recipes.length === 1 ? "" : "s"}</span>
        {renaming !== null ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming.trim()) return;
              void save({ name: renaming.trim() });
              setRenaming(null);
            }}
          >
            <Input aria-label="Meal name" value={renaming} maxLength={80} onChange={(e) => setRenaming(e.target.value)} autoFocus className="flex-1" />
            <Button type="submit">Save</Button>
            <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
          </form>
        ) : (
          <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">{data.name}</h1>
        )}
        <span className="font-mono text-[0.6875rem] font-bold uppercase" data-testid="meal-times">
          {total} min total · {active} min active
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {ready && openCreateMeal ? <Button onClick={() => openCreateMeal({ savedMealId: id })}>+ Add to plan</Button> : null}
        {ready ? (
          <Button variant="secondary" aria-pressed={fav} onClick={() => setMealFavourite(ready.activeHouseholdId, id, !fav).catch(() => notify({ kind: "error", message: "Couldn't update the favourite" }))} className={cn(fav && "bg-yellow text-onc")}>
            <Star aria-hidden strokeWidth={2.5} fill={fav ? "currentColor" : "none"} />
            {fav ? "Favourite" : "Favourite"}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={copyLink}>
          Copy link
        </Button>
        {ready ? (
          <>
            <Button variant="secondary" onClick={() => setRenaming(data.name)}>
              Rename
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete meal
            </Button>
          </>
        ) : null}
      </div>

      <section aria-label="Recipes in this meal" className="flex flex-col gap-2.5">
        <SectionLabel hint={ready ? "Servings multiplier" : undefined}>Recipes</SectionLabel>
        {data.recipes.map((r) => {
          const rec = recipes.get(r.recipeId);
          return (
            <div key={r.recipeId} className="flex flex-wrap items-center gap-3 rounded-ui border-bw bg-base p-2.5 shadow-hard">
              <Link to="/recipes/$id" params={{ id: r.recipeId }} className="flex min-w-0 flex-1 items-center gap-3 text-ink no-underline">
                <span className="relative block size-14 flex-none overflow-hidden rounded-[calc(var(--r)*0.67)] border-2 border-line">
                  <RecipeImage base={rec?.imagePaths[0]} cuisine={rec?.cuisine ?? "other"} alt="" sizes="3.5rem" className="absolute inset-0" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[0.9375rem] font-extrabold">
                    {rec?.title ?? "Loading…"}
                    {rec?.status === "trashed" ? " (in Trash)" : ""}
                  </span>
                  {rec ? (
                    <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                      {rec.prepMin + rec.cookMin} min total · {rec.prepMin} active · {taxonomyLabel(rec.cuisine)} · {formatProtein(rec.proteinPerServingG, rec.proteinApproximate)}
                    </span>
                  ) : null}
                </span>
              </Link>
              {ready ? (
                <div className="flex items-center gap-2">
                  <Stepper
                    label={`Multiplier for ${rec?.title ?? "recipe"}`}
                    value={r.servingsMultiplier}
                    min={0.5}
                    max={4}
                    step={0.5}
                    format={(v) => `×${v}`}
                    onChange={(v) => void save({ recipes: data.recipes.map((x) => (x.recipeId === r.recipeId ? { ...x, servingsMultiplier: v } : x)) })}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${rec?.title ?? "recipe"} from this meal`}
                    disabled={data.recipes.length <= 1}
                    onClick={() => void save({ recipes: data.recipes.filter((x) => x.recipeId !== r.recipeId) })}
                    className="grid size-10 cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X aria-hidden className="size-4" strokeWidth={3} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {ready && data.recipes.length < MEAL_RECIPES_MAX ? (
          adding ? (
            <AddRecipe exclude={data.recipes.map((r) => r.recipeId)} onPick={(rid) => { void save({ recipes: [...data.recipes, { recipeId: rid, servingsMultiplier: 1 }] }); setAdding(false); }} onCancel={() => setAdding(false)} />
          ) : (
            <Button variant="secondary" className="self-start" onClick={() => setAdding(true)}>
              + Add a recipe
            </Button>
          )
        ) : null}
      </section>
      {!ready ? (
        <p className="m-0 text-sm font-semibold">
          Shared from Solving Food. <Link to="/sign-in" className="font-extrabold text-ink">Sign in</Link> to plan it.
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this meal?"
        confirmLabel="Delete meal"
        destructive
        onConfirm={async () => {
          await deleteMeal(id);
          setConfirmDelete(false);
          notify({ kind: "success", message: `Deleted “${data.name}”. Its recipes stay in the library; planned meals keep their recipes.` });
          void navigate({ to: "/meals" });
        }}
      >
        Saved meals are shared by everyone. Its recipes stay in the library, and meals already planned keep their recipes.
      </ConfirmDialog>
    </PageBody>
  );
}

function AddRecipe({ exclude, onPick, onCancel }: { exclude: string[]; onPick: (id: string) => void; onCancel: () => void }) {
  const summaries = useRecipeIndex();
  const [q, setQ] = React.useState("");
  const list = (summaries ?? []).filter((r) => !exclude.includes(r.id) && (!q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 8);
  return (
    <div className="flex flex-col gap-2 rounded-ui border-2 border-line bg-base p-3">
      <div className="flex gap-2">
        <Input aria-label="Find a recipe to add" placeholder="Find a recipe…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus className="flex-1" />
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Recipes to add">
        {list.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onPick(r.id)} className="w-full cursor-pointer rounded-ui border-2 border-line bg-base px-3 py-2 text-left text-sm font-bold text-ink">
              {r.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
