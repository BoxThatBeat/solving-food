// <RecipeCard> (Planning/M1 §3, PRD R4.5, R6.15): image, title, time, cuisine, protein per serving ("~" when an
// ingredient lacks protein data), favourite toggle, the household's cook stats ("made n times", R4.5; nothing when never cooked), and the
// "can make" mark when supply left after the plan covers it (R4.3).
// The card is a link; the favourite toggle sits beside it, not inside (no nested interactive elements).
import { Link } from "@tanstack/react-router";
import { Plus, Star } from "lucide-react";
import { formatMinutes, formatProtein, taxonomyLabel, type HouseholdFacts, type RecipeSummary } from "@solving-food/core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/chip";
import { RecipeImage } from "./RecipeImage";
import { madeLine } from "./helpers";

export function RecipeCard({
  recipe: r,
  facts,
  onFavourite,
  onPlan,
  selected,
  search,
}: {
  recipe: RecipeSummary;
  facts: HouseholdFacts;
  onFavourite: (on: boolean) => void;
  /** "Add to plan" shortcut (R5.7); absent where planning isn't possible. */
  onPlan?: () => void;
  selected?: boolean;
  /** Current list search params, kept so the detail page's Back returns to the same filters. */
  search?: Record<string, unknown>;
}) {
  const family = r.tags.some((t) => /^family( recipe)?$/i.test(t));
  const protein = formatProtein(r.proteinPerServingG, r.proteinApproximate);
  return (
    <article
      className={cn(
        "@container relative flex h-full min-w-0 flex-col overflow-hidden rounded-ui border-bw bg-base text-ink",
        selected ? "border-acc" : "shadow-hard",
      )}
      data-testid="recipe-card"
    >
      <Link
        to="/recipes/$id"
        params={{ id: r.id }}
        search={search as never}
        aria-current={selected ? "page" : undefined}
        className="flex flex-col text-ink no-underline"
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden border-b-bw">
          {/* Absolutely placed so a photo's intrinsic height can't stretch the 4:5 box (aspect-ratio yields to content). */}
          <RecipeImage base={r.thumb} cuisine={r.cuisine} alt={r.title} sizes="(min-width: 768px) 18rem, 50vw" className="absolute inset-0" />
          <div className="absolute top-[0.4375rem] right-11 left-[0.4375rem] flex flex-wrap gap-1">
            {facts.favourite ? <Badge className="bg-yellow text-onc shadow-hard-sm">★ FAV</Badge> : null}
            {facts.canMake ? (
              <Badge className="bg-acc text-onc shadow-hard-sm" data-testid="can-make">
                CAN MAKE
              </Badge>
            ) : facts.supplyFraction !== undefined && facts.supplyFraction >= 0.85 ? (
              <Badge className="bg-base text-ink shadow-hard-sm">ALMOST</Badge>
            ) : null}
            {/* Lavender lightened toward white: the prototype's #c6a0f6 with ink text is 3.7:1. */}
            {family ? <Badge className="bg-[color-mix(in_srgb,#c6a0f6_55%,white)] text-[#4c4f69] shadow-hard-sm">FAMILY</Badge> : null}
          </div>
          <span className="absolute right-[0.4375rem] bottom-[0.4375rem] rounded-[calc(var(--r)*0.5)] bg-ink px-[0.3125rem] py-[0.1875rem] font-mono text-[0.6875rem] font-extrabold text-base">
            {facts.rating ? `★ ${facts.rating.toFixed(1)}` : "NEW"}
          </span>
        </div>
        <div className={cn("flex flex-col gap-[0.3125rem] px-2.5 pt-[0.5625rem] pb-[0.6875rem]", onPlan && "pr-12")}>
          <span className="font-mono text-[0.625rem] leading-[1.35] font-semibold text-sub uppercase">
            <span className="normal-case">{formatMinutes(r.totalMin)}</span> · {taxonomyLabel(r.cuisine)} · {protein === "—" ? "PROTEIN —" : `${protein} PROTEIN`}
          </span>
          <h3 className="m-0 text-[0.9375rem] leading-[1.15] font-extrabold text-pretty @[16rem]:text-[1.0625rem]">{r.title}</h3>
          {facts.timesCooked ? <span className="font-mono text-[0.625rem] font-semibold">{madeLine(facts)}</span> : null}
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onFavourite(!facts.favourite)}
        aria-pressed={facts.favourite}
        aria-label={`Favourite ${r.title}`}
        className={cn(
          "absolute top-[0.375rem] right-[0.375rem] grid size-[2.125rem] cursor-pointer place-items-center rounded-ui border-2 border-line shadow-hard-sm",
          facts.favourite ? "bg-yellow text-onc" : "bg-base text-ink",
        )}
      >
        <Star aria-hidden className="size-4" strokeWidth={2.5} fill={facts.favourite ? "currentColor" : "none"} />
      </button>
      {onPlan ? (
        <button
          type="button"
          onClick={onPlan}
          aria-label={`Add ${r.title} to plan`}
          title="Add to plan"
          className="press absolute right-[0.4375rem] bottom-[0.5rem] grid size-[2.375rem] cursor-pointer place-items-center rounded-ui border-2 border-line bg-acc text-onc shadow-hard-sm"
        >
          <Plus aria-hidden className="size-5" strokeWidth={3} />
        </button>
      ) : null}
    </article>
  );
}
