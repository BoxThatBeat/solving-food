// Settings → Nutrition goals (PRD R11.4, R6.14, R6.26, R6.27, R11.16; TECHNICAL_SPECS §4.2 `settings.proteinGoals`,
// `settings.fibreGoals`, `settings.nutrition`). M9: a "Track protein and fibre" switch above a protein and a fibre goal
// card (hidden while off; the goals are kept), a goal per serving for each meal type, each with an on/off switch.
// M20: moved here from Settings → Preferences.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MEAL_TYPES, type MealType } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";
import { useNotify } from "@/components/notifications-context";
import { MEAL_LABEL } from "@/components/plan/plan-sheet-context";
import { useActiveHousehold } from "@/data/households";
import { saveFibreGoals, saveNutrition, saveProteinGoals } from "@/data/plan";
import { nutritionOf } from "@/data/nutrition";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/nutrition")({
  component: NutritionPage,
});

/** Default grams when a goal is switched on (the prototype's defaults). */
const GOAL_DEFAULTS: Record<MealType, number> = { breakfast: 20, lunch: 25, dinner: 35, snack: 10 };
/** Fibre defaults when a goal is switched on (M9): roughly a third of 25–30 g a day across meals. */
const FIBRE_DEFAULTS: Record<MealType, number> = { breakfast: 6, lunch: 8, dinner: 8, snack: 3 };

function NutritionPage() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const nutrition = nutritionOf(hh.data?.settings);
  const goals = nutrition.proteinGoals;
  const fibreGoals = nutrition.fibreGoals;
  const planned = hh.data?.plannedMealTypes ?? ["breakfast", "lunch", "dinner"];
  const fail = (what: string) => (e: unknown) => notify({ kind: "error", message: `Couldn't save ${what}: ${(e as Error).message}` });

  return (
    <SettingsPage title="Nutrition goals">
      {/* M9 (R6.27): one switch for protein and fibre; off hides them everywhere and keeps the goals. */}
      <Card className="gap-3">
        <div className="flex items-center gap-2.5">
          <CardTitle className="flex-1">Protein and fibre</CardTitle>
          <button
            type="button"
            role="switch"
            aria-checked={nutrition.on}
            aria-label="Track protein and fibre"
            disabled={!hh.data}
            onClick={() => void saveNutrition(hh.id, !nutrition.on).catch(fail("nutrition tracking"))}
            className={cn("box-border flex h-[1.875rem] w-[3.25rem] flex-none cursor-pointer rounded-full border-2 border-line p-0.5", nutrition.on ? "justify-end bg-acc" : "justify-start bg-s0")}
          >
            <span className="box-border size-[1.375rem] rounded-full border-2 border-line bg-base" />
          </button>
        </div>
        <p className="m-0 text-[0.8125rem] font-semibold" data-testid="nutrition-note">
          {nutrition.on
            ? "Tracked: recipes show protein and fibre per serving, the Plan page shows each meal type's average next to its goal, and suggestions favour meals that meet the goals."
            : "Not tracked: protein and fibre are hidden everywhere. The goals below are kept for when you turn it back on."}
        </p>
      </Card>

      {nutrition.on ? (
        <>
          <GoalsCard
            title="Protein goal per serving"
            what="protein"
            goals={goals}
            defaults={GOAL_DEFAULTS}
            planned={planned}
            range={{ min: 5, max: 120, step: 5 }}
            onSave={(next) => void saveProteinGoals(hh.id, next).catch(fail("protein goals"))}
            intro="Suggestions favour recipes that meet the goal, and the optimiser can be told to only use them. The Plan page shows each meal type's average next to its goal."
          />
          <GoalsCard
            title="Fibre goal per serving"
            what="fibre"
            goals={fibreGoals}
            defaults={FIBRE_DEFAULTS}
            planned={planned}
            range={{ min: 1, max: 40, step: 1 }}
            onSave={(next) => void saveFibreGoals(hh.id, next).catch(fail("fibre goals"))}
            intro="The same for fibre: suggestions favour recipes that meet it, the optimiser's goal filter includes it, and the Plan page shows the average."
          />
        </>
      ) : null}
    </SettingsPage>
  );
}

/** One goal per meal type with an on/off switch each (R6.14 protein, R6.26 fibre). Off keeps the last value here. */
function GoalsCard({
  title,
  what,
  goals,
  defaults,
  planned,
  range,
  onSave,
  intro,
}: {
  title: string;
  what: "protein" | "fibre";
  goals: Partial<Record<MealType, number>>;
  defaults: Record<MealType, number>;
  planned: readonly string[];
  range: { min: number; max: number; step: number };
  onSave: (next: Partial<Record<MealType, number>>) => void;
  intro: string;
}) {
  const [last, setLast] = React.useState<Partial<Record<MealType, number>>>({});
  const setGoal = (t: MealType, g: number | undefined) => {
    const next = { ...goals };
    if (g === undefined) {
      setLast((l) => ({ ...l, [t]: goals[t] }));
      delete next[t];
    } else next[t] = g;
    onSave(next);
  };
  const Title = what === "protein" ? "Protein" : "Fibre";
  return (
    <Card className="gap-3">
      <CardTitle>{title}</CardTitle>
      <p className="m-0 text-[0.8125rem] font-semibold">{intro}</p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={`${Title} goals`}>
        {MEAL_TYPES.filter((t) => t === "snack" || planned.includes(t)).map((t) => {
          const on = typeof goals[t] === "number";
          const g = goals[t] ?? last[t] ?? defaults[t];
          const meal = MEAL_LABEL[t];
          const lower = meal.toLowerCase();
          return (
            <li key={t} className={cn("flex items-center gap-2.5", !on && "opacity-70")} data-testid={what === "protein" ? `goal-${t}` : `fibre-goal-${t}`}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${meal} ${what} goal`}
                onClick={() => setGoal(t, on ? undefined : g)}
                className={cn("box-border flex h-[1.875rem] w-[3.25rem] flex-none cursor-pointer rounded-full border-2 border-line p-0.5", on ? "justify-end bg-acc" : "justify-start bg-s0")}
              >
                <span className="box-border size-[1.375rem] rounded-full border-2 border-line bg-base" />
              </button>
              <span className="flex-1 text-[0.875rem] font-extrabold">{meal}</span>
              <Stepper
                value={g}
                onChange={(v) => setGoal(t, v)}
                min={range.min}
                max={range.max}
                step={range.step}
                format={(v) => `${v} g`}
                label={`${meal} ${what} goal in grams`}
                decLabel={what === "protein" ? `Lower the ${lower} goal` : `Lower the ${lower} fibre goal`}
                incLabel={what === "protein" ? `Raise the ${lower} goal` : `Raise the ${lower} fibre goal`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
