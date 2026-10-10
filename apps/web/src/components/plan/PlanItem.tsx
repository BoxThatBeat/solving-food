// A planned meal on the Plan page (PRD R5.1, R5.5, R6.1) and its sheet: change servings and meal type, save an
// unsaved meal to Meals (R5.8), remove. Cooking arrives in M3.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  coverageFor,
  defaultMealName,
  formatCents,
  formatProtein,
  PLANNABLE_MEAL_TYPES,
  SERVINGS_MAX,
  taxonomyLabel,
  type MealType,
} from "@solving-food/core";
import { Badge, SectionLabel } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { useNotify } from "@/components/notifications-context";
import { removePlanItem, restorePlanItem, saveItemAsMeal, updatePlanItem, type StoredPlanItem } from "@/data/plan";
import type { StoredRecipe } from "@/data/recipes";
import { cn } from "@/lib/utils";
import { MEAL_LABEL } from "./plan-sheet-context";

export interface PlanItemView {
  id: string;
  item: StoredPlanItem;
  title: string;
  cost: { cents: number; unknown: number } | undefined;
}

function recipeMeta(r: StoredRecipe | undefined): string {
  if (!r) return "Loading…";
  return `${r.prepMin + r.cookMin} MIN · ${taxonomyLabel(r.cuisine).toUpperCase()} · ${formatProtein(r.proteinPerServingG, r.proteinApproximate)} PROTEIN`;
}

function costLine(v: PlanItemView): string {
  if (v.item.status !== "planned") return v.item.status === "cooked" ? "COOKED" : v.item.status.toUpperCase();
  if (!v.cost) return "PRICING…";
  const unknown = v.cost.unknown ? ` · ${v.cost.unknown} PRICE${v.cost.unknown === 1 ? "" : "S"} UNKNOWN` : "";
  return v.cost.cents > 0 ? `+${formatCents(v.cost.cents)} TO BUY${unknown}` : `$0 · NOTHING EXTRA TO BUY${unknown}`;
}

export function PlanItemCard({ v, recipes, onOpen, hid }: { v: PlanItemView; recipes: Map<string, StoredRecipe>; onOpen: () => void; hid: string }) {
  const notify = useNotify();
  const it = v.item;
  const multi = it.recipes.length > 1;
  const leftovers = (["lunch", "breakfast"] as const).filter((t) => t !== it.mealType && (it.coverage[t] ?? 0) > 0);
  const trashed = it.recipes.some((r) => recipes.get(r.recipeId)?.status === "trashed");
  const remove = async () => {
    const snapshot = { ...it };
    try {
      await removePlanItem(hid, v.id);
      notify({ kind: "success", message: `Removed “${v.title}” from the plan`, action: { label: "Undo", run: () => void restorePlanItem(hid, v.id, snapshot) } });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't remove it: ${(e as Error).message}` });
    }
  };
  return (
    <article className="flex flex-col overflow-hidden rounded-ui border-bw bg-base text-ink shadow-hard" data-testid="plan-item" aria-label={v.title}>
      <div className="flex flex-col gap-1.5 px-3.5 pt-3 pb-2.5">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="cursor-pointer bg-transparent p-0 text-left text-[1.0625rem] leading-tight font-extrabold text-ink hover:underline">
            {v.title}
          </button>
          <Badge className={cn("flex-none rounded-[calc(var(--r)*0.5)] px-1.5 py-1 text-[0.5625rem] uppercase", it.status === "planned" ? "bg-base" : "bg-acc text-onc")}>
            {it.status === "planned" ? "To cook" : it.status}
          </Badge>
        </div>
        {!multi ? <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">{recipeMeta(recipes.get(it.recipes[0]?.recipeId ?? ""))}</span> : null}
        <div className="flex flex-wrap gap-1">
          <Badge className="bg-s0 uppercase">{it.servings} servings</Badge>
          {it.carriedFromId ? <Badge className="bg-peach text-onc uppercase">Carried over</Badge> : null}
          {it.savedMealId ? <Badge className="bg-[color-mix(in_srgb,var(--blue)_55%,white)] text-[#4c4f69] uppercase">Saved meal</Badge> : null}
          {leftovers.map((t) => (
            <Badge key={t} className="bg-[color-mix(in_srgb,#c6a0f6_55%,white)] text-[#4c4f69] uppercase">
              Meal prep · +{it.coverage[t]} {t === "lunch" ? "lunches" : "breakfasts"}
            </Badge>
          ))}
          {trashed ? <Badge className="bg-red text-onc uppercase">Recipe in Trash</Badge> : null}
        </div>
      </div>
      {multi ? (
        <ul className="m-0 list-none p-0">
          {it.recipes.map((r) => {
            const rec = recipes.get(r.recipeId);
            return (
              <li key={r.recipeId} className="border-t-2 border-line">
                <Link to="/recipes/$id" params={{ id: r.recipeId }} className="flex items-center justify-between gap-2 px-3.5 py-2 text-ink no-underline">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[0.875rem] font-bold">
                      {rec?.title ?? "Recipe"}
                      {r.servingsMultiplier !== 1 ? ` ×${r.servingsMultiplier}` : ""}
                    </span>
                    <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">{recipeMeta(rec)}</span>
                  </span>
                  <span aria-hidden className="text-sub">
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex items-center gap-2 border-t-2 border-line bg-mantle px-3.5 py-2">
        <span className="flex-1 font-mono text-[0.6875rem] font-bold" data-testid="plan-item-cost">
          {costLine(v)}
        </span>
        <button type="button" onClick={remove} aria-label={`Remove ${v.title} from the plan`} className="grid size-10 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink">
          <X aria-hidden className="size-4" strokeWidth={3} />
        </button>
        <Button size="sm" variant="secondary" onClick={onOpen} aria-label={`Edit ${v.title}`} className="shadow-hard-sm">
          Edit
        </Button>
      </div>
    </article>
  );
}

export function PlanItemSheet({
  v,
  hid,
  uid,
  recipes,
  plannedMealTypes,
  onOpenChange,
}: {
  v: PlanItemView | null;
  hid: string;
  uid: string;
  recipes: Map<string, StoredRecipe>;
  plannedMealTypes: readonly string[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!v} onOpenChange={onOpenChange}>
      {v ? <PlanItemBody key={v.id} v={v} hid={hid} uid={uid} recipes={recipes} plannedMealTypes={plannedMealTypes} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function PlanItemBody({ v, hid, uid, recipes, plannedMealTypes, close }: { v: PlanItemView; hid: string; uid: string; recipes: Map<string, StoredRecipe>; plannedMealTypes: readonly string[]; close: () => void }) {
  const notify = useNotify();
  const it = v.item;
  const [servings, setServings] = React.useState(it.servings);
  const [mealType, setMealType] = React.useState<MealType>(it.mealType);
  const titles = it.recipes.map((r) => recipes.get(r.recipeId)?.title ?? "Recipe");
  const [name, setName] = React.useState(it.name ?? defaultMealName(titles));
  const [busy, setBusy] = React.useState(false);
  const types: MealType[] = [...PLANNABLE_MEAL_TYPES.filter((t) => plannedMealTypes.includes(t) || t === it.mealType), "snack"];
  const editable = it.status === "planned";

  const save = async () => {
    setBusy(true);
    try {
      const coverage = coverageFor({ kind: it.kind, mealType, recipes: it.recipes }, (id) => recipes.get(id));
      await updatePlanItem(hid, v.id, { servings, mealType, coverage });
      notify({ kind: "success", message: "Plan updated" });
      close();
    } catch (e) {
      notify({ kind: "error", message: `Couldn't save: ${(e as Error).message}` });
      setBusy(false);
    }
  };
  const saveMeal = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveItemAsMeal(hid, v.id, name, it.recipes, uid);
      notify({ kind: "success", message: `Saved “${name.trim()}” to Meals`, link: { to: "/meals", label: "Meals" } });
      setBusy(false);
    } catch (e) {
      notify({ kind: "error", message: `Couldn't save the meal: ${(e as Error).message}` });
      setBusy(false);
    }
  };
  const remove = async () => {
    const snapshot = { ...it };
    await removePlanItem(hid, v.id);
    notify({ kind: "success", message: `Removed “${v.title}” from the plan`, action: { label: "Undo", run: () => void restorePlanItem(hid, v.id, snapshot) } });
    close();
  };

  return (
    <SheetContent
      title={v.title}
      description="Change servings or meal type, save it as a meal, or remove it"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={remove} className="flex-none">
            Remove
          </Button>
          <Button className="flex-1" disabled={busy || !editable || (servings === it.servings && mealType === it.mealType)} onClick={save}>
            Save changes
          </Button>
        </div>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Recipes in this meal">
        {it.recipes.map((r, i) => (
          <li key={r.recipeId}>
            <Link to="/recipes/$id" params={{ id: r.recipeId }} className="flex items-center justify-between rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.875rem] font-bold text-ink no-underline">
              <span>
                {titles[i]}
                {r.servingsMultiplier !== 1 ? ` ×${r.servingsMultiplier}` : ""}
              </span>
              <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!editable}>
        <legend className="mb-2 p-0">
          <SectionLabel>Meal type</SectionLabel>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {types.map((t) => (
            <button key={t} type="button" aria-pressed={mealType === t} onClick={() => setMealType(t)} className={cn("cursor-pointer rounded-ui border-2 border-line px-2 py-3 text-[0.9375rem] font-extrabold", mealType === t ? "bg-acc text-onc" : "bg-base text-ink shadow-hard")}>
              {MEAL_LABEL[t]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-3 rounded-ui border-2 border-line bg-base px-3 py-2">
        <span id="pi-servings" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
          SERVINGS
        </span>
        <Stepper label="Servings" labelledBy="pi-servings" value={servings} min={1} max={SERVINGS_MAX} onChange={setServings} />
      </div>
      {it.savedMealId ? (
        <p className="m-0 text-[0.8125rem] font-semibold">
          Planned from a saved meal.{" "}
          <Link to="/meals/$id" params={{ id: it.savedMealId }} className="font-extrabold text-ink">
            Open it in Meals
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-ui border-2 border-line bg-base p-3">
          <SectionLabel>Save as meal</SectionLabel>
          <span className="text-[0.75rem] font-semibold text-sub">Keeps a reusable copy in Meals; this planned meal stays as it is.</span>
          <div className="flex gap-2">
            <Input aria-label="Meal name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <Button variant="secondary" disabled={busy || !name.trim()} onClick={saveMeal} className="flex-none">
              Save
            </Button>
          </div>
        </div>
      )}
    </SheetContent>
  );
}
