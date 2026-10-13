// The recipe page's Nutrition Facts panel (M10, PRD R4.30; TECHNICAL_SPECS §5 "Nutrition facts"): a disclosure, closed by
// default, holding a Canadian-style Nutrition Facts table per serving (Health Canada rounding and % daily values from
// core `nutritionFacts()`). It's a fact sheet, not tracking, so it shows whatever the "Track protein and fibre" switch
// says (R6.27) and on signed-out share pages. Native <details>: keyboard and screen-reader support for free.
import { ChevronDown } from "lucide-react";
import { nutritionFacts, type NutritionFactsInput } from "@solving-food/core";
import { cn } from "@/lib/utils";

export function NutritionFactsPanel({ recipe, servings, className }: { recipe: NutritionFactsInput; servings: number; className?: string }) {
  const facts = nutritionFacts(recipe);
  return (
    <details className={cn("group rounded-ui border-2 border-line bg-base", className)} data-testid="nutrition-facts">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-[1.0625rem] leading-none uppercase">Nutrition facts</span>
          <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
            {facts?.calories ? `${facts.calories} calories · per serving` : "Per serving"}
          </span>
        </span>
        <ChevronDown aria-hidden className="size-5 flex-none transition-transform group-open:rotate-180" strokeWidth={3} />
      </summary>
      <div className="border-t-2 border-line px-3 pt-2 pb-3">
        {!facts ? (
          <p className="m-0 text-sm font-semibold text-sub">No nutrition data for these ingredients yet.</p>
        ) : (
          <div className="flex max-w-[26rem] flex-col">
            <span className="text-[0.8125rem] font-bold">Per serving (1 of {servings})</span>
            <div className="flex items-end justify-between border-b-[6px] border-line pb-1">
              <span className="font-display text-[1.375rem] leading-none">Calories {facts.calories ?? "—"}</span>
              <span className="text-right font-mono text-[0.625rem] leading-tight font-bold">% Daily Value*</span>
            </div>
            <dl className="m-0" aria-label="Nutrition facts per serving">
              {facts.rows.map((r) => (
                <div key={r.key} className={cn("flex items-baseline justify-between gap-2 border-b border-line py-1 text-[0.875rem]", r.sub && "pl-4")} data-testid={`nf-${r.key}`}>
                  <dt className={cn(r.sub ? "font-semibold" : "font-extrabold")}>
                    {r.label} <span className="font-mono font-semibold">{r.amount}</span>
                  </dt>
                  <dd className="m-0 font-mono font-extrabold">{r.dv ?? ""}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 mt-2 text-[0.6875rem] leading-snug font-semibold text-sub">*5% or less is a little, 15% or more is a lot</p>
            <p className="m-0 mt-1 text-[0.6875rem] leading-snug font-semibold text-sub">
              Worked out from the ingredient list with the Canadian Nutrient File (Health Canada).
              {facts.approximate ? " ~ Some ingredients have no data for a value, so it's approximate." : ""}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
