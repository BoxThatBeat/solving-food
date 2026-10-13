// Expiry alerts on the Plan page (PRD R6.13; TECHNICAL_SPECS §7 "Expiry badges & alerts"): supply expiring within the
// period that no planned meal uses, with how much isn't covered and the recipes that use the most of it (each one tap
// from Create meal). Dismiss hides an alert for the rest of the period (its lots go on the period document).
import { RecipeThumb } from "@/components/recipes/RecipeThumb";
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { expiresPhrase, expiryAlerts, formatCanonical, recipesUsing, type ExpiringSpare, type RecipeSummary, type ScoreResult } from "@solving-food/core";

export interface AlertIngredient {
  name: string;
  canonicalUnit: "g" | "count";
  unitWeightG?: number | undefined;
}

export function ExpiryAlerts({
  spare,
  dismissed,
  ingredient,
  summaries,
  scores,
  plannedIds,
  servings,
  nowMs,
  tz,
  onAdd,
  onDismiss,
}: {
  spare: ReadonlyMap<string, ExpiringSpare & { lotIds: string[] }>;
  dismissed: ReadonlySet<string>;
  ingredient: (id: string) => AlertIngredient | undefined;
  summaries: readonly RecipeSummary[];
  scores: ReadonlyMap<string, ScoreResult>;
  plannedIds: ReadonlySet<string>;
  servings: number;
  nowMs: number;
  tz: string;
  onAdd: (recipeId: string) => void;
  onDismiss: (lotIds: string[]) => void;
}) {
  const [all, setAll] = React.useState(false);
  const alerts = expiryAlerts(spare, dismissed, (id) => ingredient(id)?.canonicalUnit);
  if (!alerts.length) return null;
  const shown = all ? alerts : alerts.slice(0, 3);
  const candidates = summaries.filter((r) => !plannedIds.has(r.id) && !scores.get(r.id)?.blocked);
  return (
    <section aria-label="Expiring supply" data-testid="expiry-alerts" className="flex flex-col gap-2.5 rounded-ui border-bw bg-peach p-3 text-onc shadow-hard">
      <span className="font-mono text-[0.65625rem] font-extrabold tracking-[0.09rem]">USE IT OR LOSE IT</span>
      {shown.map((a) => {
        const ing = ingredient(a.ingredientId);
        const name = ing?.name ?? a.ingredientId.replace(/-/g, " ");
        const Name = name.charAt(0).toUpperCase() + name.slice(1);
        const amount = (n: number) => formatCanonical(n, ing?.canonicalUnit ?? "g", ing?.unitWeightG);
        const using = recipesUsing(a.ingredientId, a.amount, candidates, servings, (id) => scores.get(id)?.raw ?? 0).slice(0, 2);
        return (
          <div key={a.ingredientId} className="flex flex-col gap-1.5" data-testid="expiry-alert">
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col gap-0.5">
                <span className="text-[1rem] leading-tight font-extrabold">
                  {Name} {expiresPhrase(a.expiresMs, nowMs, tz)}
                </span>
                <span className="text-[0.75rem] font-semibold">{amount(a.amount)} isn&apos;t covered by the plan.</span>
              </span>
              <button
                type="button"
                onClick={() => onDismiss(a.lotIds)}
                aria-label={`Dismiss the alert for ${name}`}
                className="flex-none cursor-pointer rounded-ui border-2 border-line bg-base px-2.5 py-1.5 text-[0.75rem] font-extrabold text-ink"
              >
                Dismiss
              </button>
            </div>
            {using.length ? (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={`Recipes that use ${name}`}>
                {using.map(({ recipe, uses }) => (
                  <li key={recipe.id} className="flex gap-1.5">
                    <Link
                      to="/recipes/$id"
                      params={{ id: recipe.id }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-ui border-2 border-line bg-base py-1.5 pr-2.5 pl-1.5 text-[0.8125rem] font-bold text-ink no-underline"
                    >
                      <RecipeThumb base={summaries.find((x) => x.id === recipe.id)?.thumb} cuisine={recipe.cuisine} className="min-h-10" />
                        <span className="min-w-0 flex-1">{recipe.title}</span>
                      <span className="flex-none font-mono text-[0.65625rem] font-bold">uses {amount(uses)}</span>
                    </Link>
                    <button type="button" onClick={() => onAdd(recipe.id)} aria-label={`Add ${recipe.title} to plan`} className="w-11 flex-none cursor-pointer rounded-ui border-2 border-line bg-base text-[1rem] font-extrabold text-ink">
                      +
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[0.75rem] font-semibold">No recipe in the library uses it. Freeze it from Supply, or use it on the side.</span>
            )}
          </div>
        );
      })}
      {alerts.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="cursor-pointer self-start bg-transparent p-0 text-[0.8125rem] font-extrabold text-onc underline">
          {alerts.length - shown.length} more expiring
        </button>
      ) : null}
    </section>
  );
}
