// Settings → Preferences (PRD R11.2, R11.4, R6.14; TECHNICAL_SPECS §4.2 `settings.preferences`, `settings.proteinGoals`):
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
import { savePreferences, saveProteinGoals } from "@/data/plan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/preferences")({
  component: PreferencesPage,
});

type Kind = "likes" | "dislikes";
const KIND_LABEL: Record<Kind, string> = { likes: "LIKE", dislikes: "DISLIKE" };
/** Default grams when a goal is switched on (the prototype's defaults). */
const GOAL_DEFAULTS: Record<MealType, number> = { breakfast: 20, lunch: 25, dinner: 35, snack: 10 };

function PreferencesPage() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const ing = useAllIngredients();
  const prefs = hh.data?.settings?.preferences ?? { likes: [], dislikes: [], diets: [] };
  const goals = (hh.data?.settings?.proteinGoals ?? {}) as Partial<Record<MealType, number>>;
  const planned = hh.data?.plannedMealTypes ?? ["breakfast", "lunch", "dinner"];
  const [text, setText] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("likes");
  // Off goals keep their last value on this page so switching back on restores it.
  const [lastGoal, setLastGoal] = React.useState<Partial<Record<MealType, number>>>({});
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

  const setGoal = (t: MealType, g: number | undefined) => {
    const next = { ...goals };
    if (g === undefined) {
      setLastGoal((l) => ({ ...l, [t]: goals[t] }));
      delete next[t];
    } else next[t] = g;
    void saveProteinGoals(hh.id, next).catch(fail("protein goals"));
  };

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

      <Card className="gap-3">
        <CardTitle>Protein goal per serving</CardTitle>
        <p className="m-0 text-[0.8125rem] font-semibold">Suggestions favour recipes that meet the goal, and the optimiser can be told to only use them. The Plan page shows each meal type's average next to its goal.</p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Protein goals">
          {MEAL_TYPES.filter((t) => t === "snack" || (planned as readonly string[]).includes(t)).map((t) => {
            const on = typeof goals[t] === "number";
            const g = goals[t] ?? lastGoal[t] ?? GOAL_DEFAULTS[t];
            return (
              <li key={t} className={cn("flex items-center gap-2.5", !on && "opacity-70")} data-testid={`goal-${t}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${MEAL_LABEL[t]} protein goal`}
                  onClick={() => setGoal(t, on ? undefined : g)}
                  className={cn("box-border flex h-[1.875rem] w-[3.25rem] flex-none cursor-pointer rounded-full border-2 border-line p-0.5", on ? "justify-end bg-acc" : "justify-start bg-s0")}
                >
                  <span className="box-border size-[1.375rem] rounded-full border-2 border-line bg-base" />
                </button>
                <span className="flex-1 text-[0.875rem] font-extrabold">{MEAL_LABEL[t]}</span>
                <Stepper value={g} onChange={(v) => setGoal(t, v)} min={5} max={120} step={5} format={(v) => `${v} g`} label={`${MEAL_LABEL[t]} protein goal in grams`} decLabel={`Lower the ${MEAL_LABEL[t].toLowerCase()} goal`} incLabel={`Raise the ${MEAL_LABEL[t].toLowerCase()} goal`} />
              </li>
            );
          })}
        </ul>
      </Card>
    </SettingsPage>
  );
}
