// Use it up · before you order (PRD R6.25, M9; TECHNICAL_SPECS §7 "Use it up before ordering"). The next grocery order
// will bring more of something than the plan uses (pack rounding, or a bigger pack), and it won't keep until the next
// order: this card names it, how much will be spare and when it's expected to go off, and proposes recipes that use it,
// so meals can be added before the list is ordered. Same rule as "Use it or lose it" (ExpiryAlerts), applied to Supply
// as it will be when the order arrives; it disappears once the list is ordered (the arriving lots are then that alert's).
// Not in the prototype: built in the expiry card's language (accent kicker strip instead of peach, as it's advice, not
// a warning about food already in the kitchen).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { formatCanonical, recipesUsing, orderDismissKey, type OrderSpare, type RecipeSummary, type ScoreResult } from "@solving-food/core";
import type { AlertIngredient } from "./ExpiryAlerts";

function keepsPhrase(days: number): string {
  if (days <= 0) return "goes off the day it arrives";
  if (days === 1) return "keeps about a day";
  return `keeps about ${days} days`;
}

export function UseItUp({
  items,
  dismissed,
  ingredient,
  summaries,
  scores,
  plannedIds,
  servings,
  onAdd,
  onDismiss,
}: {
  items: readonly OrderSpare[];
  dismissed: ReadonlySet<string>;
  ingredient: (id: string) => AlertIngredient | undefined;
  summaries: readonly RecipeSummary[];
  scores: ReadonlyMap<string, ScoreResult>;
  plannedIds: ReadonlySet<string>;
  servings: number;
  onAdd: (recipeId: string) => void;
  onDismiss: (key: string) => void;
}) {
  const [all, setAll] = React.useState(false);
  const list = items.filter((i) => !dismissed.has(orderDismissKey(i.ingredientId)));
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 3);
  // Side dishes are never proposed as a meal (R4.28): blocked recipes are left out like in the other suggestions.
  const candidates = summaries.filter((r) => !plannedIds.has(r.id) && !scores.get(r.id)?.blocked);
  return (
    <section aria-label="Use it up before you order" data-testid="use-it-up" className="flex flex-col overflow-hidden rounded-ui border-bw bg-base text-ink shadow-hard">
      <div className="flex items-baseline justify-between gap-2 border-b-2 border-line bg-acc px-3 py-1.5 font-mono text-[0.65625rem] font-extrabold tracking-[0.09rem] text-onc">
        <span>USE IT UP · BEFORE YOU ORDER</span>
        <span>{list.length}</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <span className="text-[0.75rem] font-semibold text-sub">The next order brings more than the plan uses, and it won&apos;t keep. Add a meal that uses it before you order.</span>
        {shown.map((a) => {
          const ing = ingredient(a.ingredientId);
          const name = ing?.name ?? a.ingredientId.replace(/-/g, " ");
          const Name = name.charAt(0).toUpperCase() + name.slice(1);
          const amount = (n: number) => formatCanonical(n, ing?.canonicalUnit ?? "g", ing?.unitWeightG);
          const using = recipesUsing(a.ingredientId, a.amount, candidates, servings, (id) => scores.get(id)?.raw ?? 0).slice(0, 2);
          return (
            <div key={a.ingredientId} className="flex flex-col gap-1.5" data-testid="use-it-up-item">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[1rem] leading-tight font-extrabold">
                    {Name}: {amount(a.amount)} spare
                  </span>
                  <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                    Buying {amount(a.bought)} · {keepsPhrase(a.daysLeft)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onDismiss(orderDismissKey(a.ingredientId))}
                  aria-label={`Dismiss use it up for ${name}`}
                  className="flex-none cursor-pointer rounded-ui border-2 border-line bg-base px-2.5 py-1.5 text-[0.75rem] font-extrabold text-ink"
                >
                  Dismiss
                </button>
              </div>
              {using.length ? (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={`Recipes that use up ${name}`}>
                  {using.map(({ recipe, uses }) => (
                    <li key={recipe.id} className="flex gap-1.5">
                      <Link
                        to="/recipes/$id"
                        params={{ id: recipe.id }}
                        className="flex min-w-0 flex-1 justify-between gap-2 rounded-ui border-2 border-line bg-base px-2.5 py-2 text-[0.8125rem] font-bold text-ink no-underline"
                      >
                        <span className="min-w-0">{recipe.title}</span>
                        <span className="flex-none font-mono text-[0.65625rem] font-bold">uses {amount(uses)}</span>
                      </Link>
                      <button type="button" onClick={() => onAdd(recipe.id)} aria-label={`Add ${recipe.title} to plan`} className="w-11 flex-none cursor-pointer rounded-ui border-2 border-line bg-acc text-[1rem] font-extrabold text-onc">
                        +
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[0.75rem] font-semibold">No other recipe in the library uses it. Freeze what&apos;s spare when it arrives, or buy less.</span>
              )}
            </div>
          );
        })}
        {list.length > shown.length ? (
          <button type="button" onClick={() => setAll(true)} className="cursor-pointer self-start bg-transparent p-0 text-[0.8125rem] font-extrabold text-ink underline">
            {list.length - shown.length} more
          </button>
        ) : null}
      </div>
    </section>
  );
}
