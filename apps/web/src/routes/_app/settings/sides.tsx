// Settings → Sides (PRD R11.14, R5.9, R5.10; spec §4.2 `settings.sides`): the sides the household can pick in Create
// meal. Shipped sides come from the ingredient data (`ingredient.side`); the household can flag any other ingredient
// (or create one through the picker) and change any side's portion per person. A changed portion applies to meals
// created afterwards: planned and saved meals keep the portion they were made with.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatPortion, portionFromInput, portionInputUnit, portionToInput, type SideSettings } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useActiveHousehold } from "@/data/households";
import { useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { saveSides, useSides, type SideEntry } from "@/data/sides";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/settings/sides")({
  component: SidesPage,
});

const unitLabel = (ing: IngredientEntry) => (portionInputUnit(ing) === "count" ? "pieces" : "g");

function SidesPage() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const notify = useNotify();
  const sides = useSides();
  const ing = useAllIngredients();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<IngredientEntry | null>(null);

  const write = async (next: SideSettings, message: string) => {
    try {
      await saveSides(hh.id, next);
      notify({ kind: "success", message });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't save sides: ${(e as Error).message}` });
    }
  };
  const setPortion = (side: SideEntry, portion: number) => {
    const next = { ...sides.settings };
    // An override equal to the shipped portion is no override.
    if (side.source === "seed" && side.ingredient.side?.portion === portion) delete next[side.ingredient.id];
    else next[side.ingredient.id] = { portion };
    setEditing(null);
    return write(next, `${cap(side.ingredient.name)}: ${formatPortion(portion, side.ingredient)} per person from now on`);
  };
  const reset = (side: SideEntry) => {
    const next = { ...sides.settings };
    delete next[side.ingredient.id];
    return write(next, `${cap(side.ingredient.name)} back to ${formatPortion(side.ingredient.side!.portion, side.ingredient)} per person`);
  };
  const remove = (side: SideEntry) => {
    const next = { ...sides.settings };
    delete next[side.ingredient.id];
    return write(next, `${cap(side.ingredient.name)} is no longer a side`);
  };
  const list = sides.list;
  const already = picked ? sides.byId.get(picked.id) : undefined;

  return (
    <SettingsPage title="Sides" wide>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-1 p-3.5">
            <CardTitle>Sides</CardTitle>
            <p className="m-0 text-[0.8125rem] font-semibold">
              Things eaten as they are with a meal: fries, rice, buns, chips. Pick them in Create meal; each serving gets one portion, and they go on the grocery list.
            </p>
            <p className="m-0 text-[0.75rem] font-semibold text-sub">A changed portion applies to meals you create afterwards. Meals already planned or saved keep theirs.</p>
          </div>
          <div className="bg-ink px-3.5 py-2 font-mono text-[0.625rem] font-bold tracking-[0.09rem] text-base">SIDE · PORTION PER PERSON</div>
          <ul className="m-0 list-none p-0" aria-label="Sides">
            {list === undefined ? <li className="p-3.5 text-[0.8125rem] font-semibold text-sub">Loading…</li> : null}
            {list?.length === 0 ? <li className="p-3.5 text-[0.8125rem] font-semibold text-sub">No sides yet. Flag an ingredient to add one.</li> : null}
            {list?.map((side) => (
              <li key={side.ingredient.id} className="flex flex-col gap-2 border-t-2 border-line px-3.5 py-2.5 first:border-t-0" data-testid="side-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[8rem] flex-1 text-[0.9375rem] font-extrabold first-letter:uppercase">{side.ingredient.name}</span>
                  <span className="font-mono text-[0.75rem] font-bold" data-testid="side-portion">
                    {formatPortion(side.portion, side.ingredient)}
                  </span>
                  <Badge className={side.source === "household" ? "bg-acc text-onc uppercase" : "bg-s0 uppercase"}>{side.source === "household" ? "Household" : side.defaultPortion ? "Changed" : "Shipped"}</Badge>
                  {editing === side.ingredient.id ? null : (
                    <Button size="sm" variant="secondary" className="shadow-hard-sm" onClick={() => setEditing(side.ingredient.id)} aria-label={`Change portion of ${side.ingredient.name}`}>
                      Change
                    </Button>
                  )}
                  {side.defaultPortion ? (
                    <Button size="sm" variant="ghost" onClick={() => void reset(side)} aria-label={`Reset ${side.ingredient.name} to ${formatPortion(side.defaultPortion, side.ingredient)}`}>
                      Reset
                    </Button>
                  ) : null}
                  {side.source === "household" ? (
                    <Button size="sm" variant="ghost" onClick={() => void remove(side)} aria-label={`Remove ${side.ingredient.name} from sides`}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                {editing === side.ingredient.id ? (
                  <PortionForm ingredient={side.ingredient} initial={side.portion} submitLabel="Save" onCancel={() => setEditing(null)} onSubmit={(p) => void setPortion(side, p)} />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="gap-3">
          <CardTitle>Flag an ingredient</CardTitle>
          <p className="m-0 text-[0.8125rem] font-semibold">Any ingredient can be a side. Type to find it, or create a new one.</p>
          <IngredientPicker ingredients={ing.list ?? []} value={picked ?? undefined} onPick={(i) => setPicked(i)} uid={s.user.uid} label="Ingredient to use as a side" />
          {picked ? (
            picked.freeUse ? (
              <p role="alert" className="m-0 rounded-ui border-2 border-line bg-yellow p-3 text-[0.8125rem] font-extrabold text-onc">
                {cap(picked.name)} is free use: it isn't tracked by amount, so it can't be a side. Turn off “Free use” on the ingredient first.
              </p>
            ) : already ? (
              <p role="status" className="m-0 text-[0.8125rem] font-bold">
                {cap(picked.name)} is already a side ({formatPortion(already.portion, already.ingredient)} per person). Change it in the list.
              </p>
            ) : (
              <PortionForm
                key={picked.id}
                ingredient={picked}
                initial={portionInputUnit(picked) === "count" ? portionFromInput(1, picked) : 100}
                submitLabel="Add side"
                onSubmit={(portion) => {
                  const name = picked.name;
                  setPicked(null);
                  void write({ ...sides.settings, [picked.id]: { portion } }, `${cap(name)} added to sides`);
                }}
              />
            )
          ) : null}
        </Card>
      </div>
    </SettingsPage>
  );
}

function PortionForm({ ingredient, initial, submitLabel, onSubmit, onCancel }: { ingredient: IngredientEntry; initial: number; submitLabel: string; onSubmit: (portion: number) => void; onCancel?: () => void }) {
  const id = React.useId();
  const [text, setText] = React.useState(String(portionToInput(initial, ingredient)));
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 5000;
  const portion = valid ? portionFromInput(n, ingredient) : null;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (portion) onSubmit(portion);
      }}
    >
      <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <Label htmlFor={id}>Portion per person ({unitLabel(ingredient)})</Label>
        <Input id={id} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!valid} />
      </div>
      <span className="pb-3 font-mono text-[0.75rem] font-bold text-sub">{portion ? `= ${formatPortion(portion, ingredient)}` : "Enter an amount"}</span>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!portion}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
