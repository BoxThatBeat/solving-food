// Settings → Suggestion weights (PRD R6.12, R11.3; TECHNICAL_SPECS §7): one 0–5 weight per factor, split into what
// raises and what lowers a suggestion, with presets (Balanced, Use it up, Cheap week, Adventurous; "Custom" once
// edited). Stored in households/{hid}.settings.scoreWeights. The prototype draws each weight as five blocks; here
// each row is a radio group of six (0 = off) so it works with a keyboard and a screen reader.
import { createFileRoute } from "@tanstack/react-router";
import { useNutrition } from "@/data/nutrition";
import { FACTORS, PRESET_NAMES, PRESETS, presetOf, resolveWeights, WEIGHT_MAX, type FactorKey, type Weights } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/components/notifications-context";
import { useActiveHousehold } from "@/data/households";
import { saveWeights } from "@/data/plan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/weights")({
  component: WeightsPage,
});

function WeightsPage() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const w = resolveWeights(hh.data?.settings?.scoreWeights);
  const preset = presetOf(w);
  const write = (next: Weights) => void saveWeights(hh.id, { ...next }).catch((e) => notify({ kind: "error", message: `Couldn't save the weights: ${(e as Error).message}` }));
  const set = (k: FactorKey, v: number) => write({ ...w, [k]: v });
  // Nutrition tracking off (M9, R6.27): the goal factors don't act, so their weights aren't shown (they're kept).
  const nutrition = useNutrition();
  const shown = (k: FactorKey) => nutrition.on || (k !== "proteinGoal" && k !== "fibreGoal");

  return (
    <SettingsPage title="Suggestion weights">
      <Card className="gap-3.5">
        <CardTitle>Suggestion weights</CardTitle>
        <p className="m-0 text-[0.8125rem] font-semibold">What raises or lowers a recipe in Suggested, the Suggested sort, and the optimiser. Recipes that need a kitchen tool you don't own, or that clash with a dislike or a dietary restriction, are never suggested.</p>
        <div role="group" aria-label="Presets" className="flex flex-wrap gap-1.5">
          {[...PRESET_NAMES, ...(preset === "Custom" ? (["Custom"] as const) : [])].map((n) => {
            const on = preset === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                disabled={n === "Custom"}
                onClick={() => n !== "Custom" && write(PRESETS[n])}
                className={cn("cursor-pointer rounded-ui border-2 border-line px-2.5 py-2 text-[0.78125rem] font-extrabold disabled:cursor-default", on ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm")}
              >
                {n}
              </button>
            );
          })}
        </div>
        {([
          ["RAISES A SUGGESTION", 1],
          ["LOWERS A SUGGESTION", -1],
        ] as const).map(([title, sign]) => (
          <div key={title} className="flex flex-col gap-[0.4375rem]">
            <span className="mt-1 font-mono text-[0.625rem] font-bold tracking-[0.09rem]">{title}</span>
            {FACTORS.filter((f) => f.sign === sign && shown(f.key)).map((f) => (
              <div key={f.key} role="radiogroup" aria-label={`${f.label} weight`} className="flex items-center gap-2.5" data-testid={`weight-${f.key}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[0.8125rem] font-bold">{f.label}</span>
                  <span className="text-[0.6875rem] font-semibold text-sub">{f.hint}</span>
                </span>
                <span className="flex gap-[0.1875rem]">
                  {Array.from({ length: WEIGHT_MAX + 1 }, (_, v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={w[f.key] === v}
                      aria-label={`${v}`}
                      onClick={() => set(f.key, v)}
                      className={cn(
                        "size-6 cursor-pointer rounded-[0.1875rem] border-2 border-line p-0",
                        v === 0 ? "border-dashed" : "",
                        v > 0 && v <= w[f.key] ? (sign > 0 ? "bg-acc" : "bg-red") : "bg-base",
                        v === 0 && w[f.key] === 0 ? "bg-s0" : "",
                      )}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </Card>
    </SettingsPage>
  );
}
