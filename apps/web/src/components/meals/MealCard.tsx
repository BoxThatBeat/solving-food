// A saved meal in the Meals list (PRD R5.2, R4.6, R4.21): the prototype's meal card. Two-up image strip from its
// recipes, badges, title, meta, its recipes with times, and favourite / copy link / plan actions.
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { formatCents, formatMinutes, formatProtein, type HouseholdFacts, type MealRow, type RecipeSummary } from "@solving-food/core";
import { Badge } from "@/components/ui/chip";
import { RecipeImage } from "@/components/recipes/RecipeImage";
import { cn } from "@/lib/utils";

export function MealCard({
  row,
  facts,
  recipes,
  inPlan,
  onFavourite,
  onCopyLink,
  onPlan,
  sides,
}: {
  /** "fries, peas": the meal's sides (R5.9). */
  sides?: string;
  row: MealRow;
  facts: HouseholdFacts;
  recipes: (id: string) => RecipeSummary | undefined;
  inPlan: boolean;
  onFavourite: (on: boolean) => void;
  onCopyLink: () => void;
  onPlan: () => void;
}) {
  const parts = row.recipeIds.slice(0, 2).map((id) => recipes(id));
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-ui border-bw bg-base text-ink shadow-hard" data-testid="meal-card" aria-label={row.title}>
      <div className="relative grid h-[8.25rem] flex-none grid-cols-2 border-b-bw">
        {(parts.length ? parts : [undefined]).map((r, i) => (
          <div key={i} className={cn("relative overflow-hidden", i === 1 && "border-l-bw", parts.length < 2 && "col-span-2")}>
            <RecipeImage base={r?.thumb} cuisine={r?.cuisine ?? row.cuisine} alt="" sizes="12rem" className="absolute inset-0" />
          </div>
        ))}
        <div className="absolute top-[0.4375rem] left-[0.4375rem] flex flex-wrap gap-1">
          {facts.favourite ? <Badge className="bg-yellow text-onc shadow-hard-sm">★ FAV</Badge> : null}
          {inPlan ? <Badge className="bg-[color-mix(in_srgb,var(--blue)_55%,white)] text-[#4c4f69] shadow-hard-sm">IN PLAN</Badge> : null}
          {row.missing.length ? <Badge className="bg-red text-onc shadow-hard-sm">RECIPE IN TRASH</Badge> : null}
        </div>
        <span className="absolute right-[0.4375rem] bottom-[0.4375rem] rounded-[calc(var(--r)*0.5)] bg-ink px-[0.3125rem] py-[0.1875rem] font-mono text-[0.6875rem] font-extrabold text-base">
          {facts.rating ? `★ ${facts.rating.toFixed(1)}` : "NEW"}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <h3 className="m-0 text-[1.1875rem] leading-tight font-extrabold">
          <Link to="/meals/$id" params={{ id: row.id }} className="text-ink no-underline hover:underline">
            {row.title}
          </Link>
        </h3>
        <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
          {row.recipeIds.length} recipe{row.recipeIds.length === 1 ? "" : "s"}
          {facts.costPerServingCents != null ? ` · ${formatCents(facts.costPerServingCents)}/serv` : ""} · {formatProtein(row.proteinPerServingG, row.proteinApproximate)} protein
          {facts.timesCooked ? ` · made ${facts.timesCooked}×` : ""}
        </span>
        {sides ? (
          <span className="font-mono text-[0.625rem] font-bold uppercase" data-testid="meal-sides">
            With {sides}
          </span>
        ) : null}
      </div>
      <ul className="m-0 flex-1 list-none p-0">
        {row.recipeIds.map((id) => {
          const r = recipes(id);
          return (
            <li key={id} className="border-t-2 border-line">
              <Link to="/recipes/$id" params={{ id }} className="flex items-center justify-between gap-2 px-3.5 py-2 text-ink no-underline">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[0.875rem] font-bold">{r?.title ?? "Recipe in Trash"}</span>
                  {r ? (
                    <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                      {formatMinutes(r.totalMin)} total · {formatMinutes(r.activeMin)} active
                    </span>
                  ) : null}
                </span>
                <span aria-hidden className="text-sub">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 border-t-2 border-line px-3.5 py-2.5">
        <button
          type="button"
          aria-pressed={facts.favourite}
          aria-label={`Favourite ${row.title}`}
          onClick={() => onFavourite(!facts.favourite)}
          className={cn("grid size-10 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line shadow-hard-sm", facts.favourite ? "bg-yellow text-onc" : "bg-base text-ink")}
        >
          <Star aria-hidden className="size-4" strokeWidth={2.5} fill={facts.favourite ? "currentColor" : "none"} />
        </button>
        <button type="button" onClick={onCopyLink} className="cursor-pointer rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold text-ink shadow-hard-sm">
          Copy link
        </button>
        <button type="button" onClick={onPlan} aria-label={`Add ${row.title} to plan`} className="flex-1 cursor-pointer rounded-ui border-2 border-line bg-acc px-3 py-2 text-[0.8125rem] font-extrabold text-onc shadow-hard-sm">
          + Plan
        </button>
      </div>
    </article>
  );
}
