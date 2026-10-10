// <SupplyBadge> (PRD R4.9; TECHNICAL_SPECS §12): how much of an ingredient is in supply, next to what the recipe needs.
// Accent when supply covers it, peach when there's some but not enough, red when there's none; free-use ingredients
// say "staple" (R8.14). Expired lots aren't counted (R8.15): the caller passes unexpired supply.
import { formatGrams, formatQuantity } from "@solving-food/core";
import type { IngredientEntry } from "@/data/ingredients";
import { cn } from "@/lib/utils";

export function SupplyBadge({ need, have, ingredient, name }: { need: number; have: number; ingredient: IngredientEntry | undefined; name: string }) {
  let text: string;
  let cls: string;
  let label: string;
  if (ingredient?.freeUse) {
    text = "staple";
    cls = "bg-s0 text-ink";
    label = `${name}: staple, not tracked`;
  } else {
    const amt = ingredient?.canonicalUnit === "count" ? formatQuantity(Math.max(0, have)) : formatGrams(have);
    const enough = have > 0 && have + 1e-6 >= need;
    text = have > 0 ? `have ${amt}${enough || need <= 0 ? "" : " ⚠"}` : "none";
    cls = enough || (need <= 0 && have > 0) ? "bg-acc text-onc" : have > 0 ? "bg-peach text-onc" : "bg-red text-onc";
    label = have > 0 ? `${name}: ${amt} in supply${enough ? "" : need > 0 ? ", not enough" : ""}` : `${name}: none in supply`;
  }
  return (
    <span className={cn("min-w-[5.25rem] flex-none rounded-[calc(var(--r)*0.5)] border-2 border-line px-1 py-[0.1875rem] text-center font-mono text-[0.65625rem] font-bold", cls)} aria-label={label} data-testid="supply-badge">
      {text}
    </span>
  );
}
