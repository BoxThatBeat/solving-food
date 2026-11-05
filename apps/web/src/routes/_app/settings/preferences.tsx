// Settings → Preferences (PRD R11.2; TECHNICAL_SPECS §4.2 `settings.preferences`): the household's likes and dislikes
// (foods, cuisines, main proteins, or any word) and dietary restrictions. Likes raise suggestions; dislikes and
// restrictions keep recipes out of suggestions and the optimiser and sort them last (prototype: "Food preferences",
// "prefKind"). M20: the protein and fibre goals and the tracking switch moved to Settings → Nutrition goals.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  addPref,
  CUISINES,
  DIETS,
  formatPref,
  MAIN_PROTEINS,
  prefLabel,
  taxonomyLabel,
} from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { useActiveHousehold } from "@/data/households";
import { searchIngredients, useAllIngredients } from "@/data/ingredients";
import { savePreferences } from "@/data/plan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/preferences")({
  component: PreferencesPage,
});

type Kind = "likes" | "dislikes";
const KIND_LABEL: Record<Kind, string> = { likes: "LIKE", dislikes: "DISLIKE" };

function PreferencesPage() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const ing = useAllIngredients();
  const prefs = hh.data?.settings?.preferences ?? { likes: [], dislikes: [], diets: [] };
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

    </SettingsPage>
  );
}
