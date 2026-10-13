// Settings → Preferences (PRD R11.2, R11.4, R6.14, R6.26, R6.27; TECHNICAL_SPECS §4.2 `settings.preferences`,
// `settings.proteinGoals`, `settings.fibreGoals`, `settings.nutrition`). M9: a "Track protein and fibre" switch above a
// protein and a fibre goal card (hidden while off; the goals are kept).
// the household's likes and dislikes (foods, cuisines, main proteins, or any word), dietary restrictions, and a protein
// goal per serving for each meal type, each with an on/off switch. Likes raise suggestions; dislikes and restrictions
// keep recipes out of suggestions and the optimiser and sort them last (prototype: "Food preferences", "prefKind").
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  addPref,
  CUISINES,
  DIETS,
  formatPref,
  MAIN_PROTEINS,
  MEAL_TYPES,
  prefLabel,
  taxonomyLabel,
  type MealType,
} from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { ToggleChip } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { MEAL_LABEL } from "@/components/plan/plan-sheet-context";
import { useActiveHousehold } from "@/data/households";
import { searchIngredients, useAllIngredients } from "@/data/ingredients";
import { saveFibreGoals, saveNutrition, savePreferences, saveProteinGoals } from "@/data/plan";
import { nutritionOf } from "@/data/nutrition";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/preferences")({
  component: PreferencesPage,
});

type Kind = "likes" | "dislikes";
const KIND_LABEL: Record<Kind, string> = { likes: "LIKE", dislikes: "DISLIKE" };
/** Default grams when a goal is switched on (the prototype's defaults). */
const GOAL_DEFAULTS: Record<MealType, number> = { breakfast: 20, lunch: 25, dinner: 35, snack: 10 };
/** Fibre defaults when a goal is switched on (M9): roughly a third of 25–30 g a day across meals. */
const FIBRE_DEFAULTS: Record<MealType, number> = { breakfast: 6, lunch: 8, dinner: 8, snack: 3 };

function PreferencesPage() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const ing = useAllIngredients();
  const prefs = hh.data?.settings?.preferences ?? { likes: [], dislikes: [], diets: [] };
  const nutrition = nutritionOf(hh.data?.settings);
  const goals = nutrition.proteinGoals;
  const fibreGoals = nutrition.fibreGoals;
  const planned = hh.data?.plannedMealTypes ?? ["breakfast", "lunch", "dinner"];
  const [text, setText] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("likes");
  const name = (id: string) => ing.byId.get(id)?.name;
  const fail = (what: string) => (e: unknown) => notify({ kind: "error", message: `Couldn't save ${what}: ${(e as Error).message}` });

  const write = (next: { likes: string[]; dislikes: string[]; diets: string[] }) => void savePreferences(hh.id, next).catch(fail("preferences"));
  const add = (entry: string) => {
    const other: Kind = kind === "likes" ? "dislikes" : "likes";
    // An entry is a like or a dislike, never both.
    write({ ...prefs, [kind]: addPref(prefs[kind], entry), [other]: prefs[other].filter((x) => x !== entry) } as typeof prefs);
    setText("");
  };
  const remove = (k: Kind, entry: string) => write({ ...prefs, [k]: prefs[k].filter((x) => x !== entry) });
  const toggleDiet = (key: string) => write({ ...prefs, diets: prefs.diets.includes(key) ? prefs.diets.filter((d) => d !== key) : [...prefs.diets, key] });

  const q = text.trim().toLowerCase();
  const options = React.useMemo(() => {
    if (!q) return [] as Array<{ entry: string; label: string; hint: string }>;
    const out: Array<{ entry: string; label: string; hint: string }> = [];
    for (const c of CUISINES) if (c !== "other" && taxonomyLabel(c).toLowerCase().includes(q)) out.push({ entry: `cuisine:${c}`, label: taxonomyLabel(c), hint: "cuisine" });
    for (const p of MAIN_PROTEINS) if (p !== "none" && taxonomyLabel(p).toLowerCase().includes(q)) out.push({ entry: `protein:${p}`, label: taxonomyLabel(p), hint: "main protein" });
    for (const i of searchIngredients(ing.list ?? [], q, 5)) out.push({ entry: `ingredient:${i.id}`, label: i.name.charAt(0).toUpperCase() + i.name.slice(1), hint: "ingredient" });
    out.push({ entry: formatPref({ kind: "text", value: q }), label: `Anything with “${q}”`, hint: "word" });
    return out.slice(0, 8);
  }, [q, ing.list]);

  return (
    <SettingsPage title="Preferences">
      <Card className="gap-4">
        <CardTitle>Food preferences</CardTitle>
        <p className="m-0 text-[0.8125rem] font-semibold">Set once for the whole household. Likes raise a suggestion; dislikes and restrictions keep recipes out of suggestions and the optimiser.</p>
        {(["likes", "dislikes"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">{k === "likes" ? "LIKES" : "DISLIKES"}</span>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={k === "likes" ? "Likes" : "Dislikes"}>
              {prefs[k].length === 0 ? <li className="text-[0.8125rem] font-semibold text-sub">None yet.</li> : null}
              {prefs[k].map((e) => (
                <li key={e}>
                  <button
                    type="button"
                    onClick={() => remove(k, e)}
                    aria-label={`Remove ${prefLabel(e, name)} from ${k}`}
                    className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line px-2.5 py-1.5 text-[0.8125rem] font-extrabold text-onc", k === "likes" ? "bg-acc" : "bg-red-soft")}
                  >
                    {prefLabel(e, name)}
                    <X aria-hidden className="size-3.5" strokeWidth={3} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const first = options[0];
            if (first) add(first.entry);
          }}
        >
          <div className="flex gap-1.5">
            <Input aria-label="Add a food, cuisine or word" placeholder="Add a food, cuisine or word" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={() => setKind(kind === "likes" ? "dislikes" : "likes")}
              aria-label={`Adding to ${kind}; switch`}
              className="flex-none cursor-pointer rounded-ui border-2 border-line bg-base px-2.5 font-mono text-[0.6875rem] font-bold text-ink"
            >
              {KIND_LABEL[kind]}
            </button>
            <Button type="submit" variant="ink" disabled={!options.length}>
              Add
            </Button>
          </div>
          {options.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Matches">
              {options.map((o) => (
                <li key={o.entry}>
                  <button type="button" onClick={() => add(o.entry)} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-ui border-2 border-line bg-base px-2.5 py-2 text-left text-[0.8125rem] font-bold text-ink">
                    <span>
                      {kind === "likes" ? "Like" : "Dislike"} {o.label}
                    </span>
                    <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">{o.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        <div role="group" aria-labelledby="diets-h" className="flex flex-col gap-1.5">
          <span id="diets-h" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
            DIETARY RESTRICTIONS
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DIETS.map((d) => (
              <ToggleChip key={d.key} pressed={prefs.diets.includes(d.key)} onClick={() => toggleDiet(d.key)}>
                {d.label}
              </ToggleChip>
            ))}
          </div>
        </div>
      </Card>

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
