// <RecipeCard> (Planning/M1 §3, PRD R4.5, R6.15): image, title, time, cuisine, protein per serving ("~" when an
// ingredient lacks protein data), favourite toggle, and the household's cook stats ("made n times", M3 fills them).
// The card is a link; the favourite toggle sits beside it, not inside (no nested interactive elements).
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { formatProtein, taxonomyLabel, type HouseholdFacts, type RecipeSummary } from "@solving-food/core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/chip";
import { RecipeImage } from "./RecipeImage";
import { madeLine } from "./helpers";

export function RecipeCard({
  recipe: r,
  facts,
  onFavourite,
  selected,
  search,
}: {
  recipe: RecipeSummary;
  facts: HouseholdFacts;
  onFavourite: (on: boolean) => void;
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
            {/* Lavender lightened toward white: the prototype's #c6a0f6 with ink text is 3.7:1. */}
            {family ? <Badge className="bg-[color-mix(in_srgb,#c6a0f6_55%,white)] text-[#4c4f69] shadow-hard-sm">FAMILY</Badge> : null}
          </div>
          <span className="absolute right-[0.4375rem] bottom-[0.4375rem] rounded-[calc(var(--r)*0.5)] bg-ink px-[0.3125rem] py-[0.1875rem] font-mono text-[0.6875rem] font-extrabold text-base">
            {facts.rating ? `★ ${facts.rating.toFixed(1)}` : "NEW"}
          </span>
        </div>
        <div className="flex flex-col gap-[0.3125rem] px-2.5 pt-[0.5625rem] pb-[0.6875rem]">
          <span className="font-mono text-[0.625rem] leading-[1.35] font-semibold text-sub uppercase">
            {r.totalMin} MIN · {taxonomyLabel(r.cuisine)} · {protein === "—" ? "PROTEIN —" : `${protein} PROTEIN`}
          </span>
          <h3 className="m-0 text-[0.9375rem] leading-[1.15] font-extrabold text-pretty @[16rem]:text-[1.0625rem]">{r.title}</h3>
          <span className="font-mono text-[0.625rem] font-semibold">{madeLine(facts)}</span>
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
    </article>
  );
}
