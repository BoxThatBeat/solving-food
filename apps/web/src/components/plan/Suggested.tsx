// The Plan page's Suggested section (PRD R6.11, R6.12, R6.16; TECHNICAL_SPECS §7): the best-scoring recipes not yet
// planned, each with its score, time · protein · what it adds to the order, and "why" chips (the top two raising
// factors and the strongest lowering one), one tap from Create meal. The header links to the weights (prototype:
// "WEIGHTS: BALANCED"); "See more" (M7) opens Recipes sorted by Suggested. M24 (R6.30): meal-type tabs (All and the
// household's meal types, Snack always) filter the list; it opens on the meal type with the most open cells in the
// coverage strip, and See more keeps the tab as a Meal type filter. M27 (R6.33): a Deal chip when its main protein or
// its most expensive ingredient to buy is on sale.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { formatCents, formatMinutes, plannedMealTypesOf, presetOf, resolveWeights, type MealType, type Reason, type RecipeSummary, type ScoreResult } from "@solving-food/core";
import { MealTypeTabs } from "./MealTypePicker";
import { MEAL_LABEL } from "./plan-sheet-context";
import { EmptyState } from "@/components/AppShell";
import { RecipeThumb } from "@/components/recipes/RecipeThumb";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/chip";
import { NutritionText } from "@/components/NutritionText";

function WhyChips({ reasons, className }: { reasons: readonly Reason[]; className?: string }) {
  if (!reasons.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)} aria-label="Why">
      {reasons.map((r) => (
        <span
          key={r.key + r.label}
          data-tone={r.tone}
          className={cn(
            "rounded-[0.1875rem] border-[1.5px] border-line px-1 py-px tabular-nums text-[0.625rem] leading-[1.3] font-bold",
            r.tone === "expiry" ? "bg-peach text-onc" : r.tone === "good" ? "bg-acc text-onc" : "bg-s0 text-ink",
          )}
        >
          {r.label}
        </span>
      ))}
    </span>
  );
}

export function SuggestedSection({
  ranked,
  summaries,
  plannedIds,
  weights,
  wide,
  mealTypes,
  defaultMealType,
  onAdd,
}: {
  ranked: readonly ScoreResult[] | null;
  summaries: ReadonlyMap<string, RecipeSummary>;
  plannedIds: ReadonlySet<string>;
  weights: Record<string, number> | undefined;
  wide: boolean;
  /** The tabs after All: the household's planned meal types and snacks. */
  mealTypes: readonly MealType[];
  /** The tab it opens on (the emptiest strip row), null for All. */
  defaultMealType: MealType | null;
  onAdd: (id: string) => void;
}) {
  // The household's pick, until it leaves the page; until then the tab follows the strip as meals are added.
  const [picked, setPicked] = React.useState<{ t: MealType | null } | null>(null);
  const tab = picked ? picked.t : defaultMealType;
  const list = (ranked ?? [])
    .filter((r) => !r.blocked && !plannedIds.has(r.id) && summaries.has(r.id))
    .filter((r) => !tab || plannedMealTypesOf(summaries.get(r.id)!).includes(tab))
    .slice(0, wide ? 6 : 4);
  const preset = presetOf(resolveWeights(weights));
  return (
    <section aria-labelledby="suggested-h" className="flex flex-col gap-3" data-testid="suggested">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="suggested-h" className="m-0 font-display text-[1.3125rem] font-extrabold">
          Suggested
        </h2>
        <Link to="/settings/weights" className="inline-flex min-h-11 items-center tabular-nums text-[0.65625rem] font-bold text-ink underline">
          Weights: {preset}
        </Link>
      </div>
      <MealTypeTabs types={mealTypes} value={tab} onChange={(t) => setPicked({ t })} label="Suggested meal type" />
      {ranked === null ? <EmptyState>Scoring recipes…</EmptyState> : null}
      {list.map((x) => {
        const r = summaries.get(x.id)!;
        return (
          <div key={x.id} data-testid="suggestion" className="flex items-stretch gap-2.5 rounded-ui border-bw bg-base p-2 shadow-hard">
            <Link to="/recipes/$id" params={{ id: r.id }} className="flex min-w-0 flex-1 items-stretch gap-2.5 text-ink no-underline">
              <RecipeThumb base={r.thumb} cuisine={r.cuisine}>
                <span className="absolute bottom-[0.1875rem] left-[0.1875rem] rounded-[0.1875rem] bg-ink px-1 py-px tabular-nums text-[0.625rem] font-extrabold text-base" aria-label={`Score ${x.score}`}>
                  {x.score}
                </span>
              </RecipeThumb>
              <span className="flex min-w-0 flex-col gap-[0.3125rem] py-0.5">
                <span className="text-[0.90625rem] leading-tight font-extrabold">{r.title}</span>
                <span className="tabular-nums text-[0.625rem] font-semibold text-sub">
                  {formatMinutes(r.totalMin)}
                  <NutritionText r={r} />
                  {x.costCents !== null ? ` · +${formatCents(x.costCents)}` : ""}
                </span>
                {x.deal ? (
                  <Badge className="w-fit bg-acc whitespace-normal text-onc" data-testid="deal-chip">
                    Deal{x.reasons.some((rr) => rr.key === "onSale") ? "" : ` · ${x.deal.label}`}
                  </Badge>
                ) : null}
                <WhyChips reasons={x.reasons} />
              </span>
            </Link>
            <button type="button" onClick={() => onAdd(r.id)} aria-label={`Add ${r.title} to plan`} className="press w-11 flex-none cursor-pointer rounded-ui border-2 border-line bg-acc text-xl font-extrabold text-onc shadow-hard-sm">
              +
            </button>
          </div>
        );
      })}
      {ranked && !list.length ? (
        <EmptyState>
          {tab ? `No ${MEAL_LABEL[tab].toLowerCase()} suggestions: every ${MEAL_LABEL[tab].toLowerCase()} recipe is planned or filtered out by your preferences and tools.` : "No suggestions: every recipe is planned or filtered out by your preferences and tools."}
        </EmptyState>
      ) : null}
      <Link to="/recipes" search={(tab ? { sort: "suggested", meal: tab } : { sort: "suggested" }) as never} aria-label="See more suggested recipes" className="inline-flex min-h-11 items-center self-end text-[0.8125rem] font-bold text-ink underline underline-offset-2">
        See more →
      </Link>
    </section>
  );
}
