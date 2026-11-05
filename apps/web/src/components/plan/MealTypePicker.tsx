// The "Meal type" choice in Create meal, eating out and the plan item sheet (M23: one component for the three grids).
import { SectionLabel } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { MealType } from "@solving-food/core";
import { MEAL_LABEL } from "./plan-sheet-context";

export function MealTypePicker({ types, value, onChange, disabled }: { types: readonly MealType[]; value: MealType; onChange: (t: MealType) => void; disabled?: boolean }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 p-0">
        <SectionLabel>Meal type</SectionLabel>
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={value === t}
            onClick={() => onChange(t)}
            className={cn("cursor-pointer rounded-ui border-2 border-line px-2 py-3 text-[0.9375rem] font-extrabold", value === t ? "bg-acc text-onc" : "bg-base text-ink shadow-hard")}
          >
            {MEAL_LABEL[t]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The same choice as a row of tabs with "All" first (M24, R6.30: Suggested by meal type). `null` is All. Each tab is
 * a pressed/unpressed toggle, at least 44 px tall.
 */
export function MealTypeTabs({ types, value, onChange, label }: { types: readonly MealType[]; value: MealType | null; onChange: (t: MealType | null) => void; label: string }) {
  const opts: Array<MealType | null> = [null, ...types];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5" data-testid="meal-type-tabs">
      {opts.map((t) => (
        <button
          key={t ?? "all"}
          type="button"
          aria-pressed={value === t}
          onClick={() => onChange(t)}
          className={cn(
            "min-h-11 flex-auto cursor-pointer rounded-ui border-2 border-line px-2.5 text-[0.8125rem] font-extrabold",
            value === t ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm",
          )}
        >
          {t ? MEAL_LABEL[t] : "All"}
        </button>
      ))}
    </div>
  );
}
