// A planned meal on the Plan page (PRD R5.1, R5.5, R6.1) and its sheet: change servings and meal type, save an
// unsaved meal to Meals (R5.8), remove. M3: Cook → opens the cook view; cooked meals, leftovers, and snacks can be
// marked eaten (R9.5, `markEaten`); an expiry badge names the soonest-expiring ingredient the meal would use (R6.7);
// leftovers show their use-by (R6.10). M9 (R9.5): a cooked meal's review marks it eaten, so a cooked meal shows
// Review (its pending review) instead of Mark eaten.
import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  coverageFor,
  defaultMealName,
  formatCents,
  formatMinutes,
  formatProtein,
  PLANNABLE_MEAL_TYPES,
  SERVINGS_MAX,
  sidesLine,
  taxonomyLabel,
  type MealSide,
  type MealType,
} from "@solving-food/core";
import { Badge, SectionLabel } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { useNotify } from "@/components/notifications-context";
import { removePlanItem, restorePlanItem, saveItemAsMeal, updatePlanItem, type StoredPlanItem } from "@/data/plan";
import { sendCommand } from "@/data/supply";
import type { IngredientEntry } from "@/data/ingredients";
import { useSides } from "@/data/sides";
import { SidePicker } from "./SidePicker";
import type { StoredRecipe } from "@/data/recipes";
import { cn } from "@/lib/utils";
import { MEAL_LABEL } from "./plan-sheet-context";

export interface PlanItemView {
  id: string;
  item: StoredPlanItem;
  title: string;
  cost: { cents: number; unknown: number } | undefined;
  /** Shown status: a pending finishCooking / markEaten is applied optimistically. */
  status: StoredPlanItem["status"];
  /** "Salmon expires in 2 days" (R6.7). */
  expiry?: string | undefined;
  /** A cooked meal's pending review (cook event ID): finishing it marks the meal eaten (M9, R9.5). */
  review?: string | undefined;
  /** Leftovers: "use by 13 Oct" and whether the batch is already past it. */
  leftover?: { useBy: string | null; expired: boolean } | undefined;
}

/** Uppercased by CSS; the duration stays lower case ("45m", not "45M"). */
function recipeMeta(r: StoredRecipe | undefined): React.ReactNode {
  if (!r) return "Loading…";
  return (
    <>
      <span className="normal-case">{formatMinutes(r.prepMin + r.cookMin)}</span> · {taxonomyLabel(r.cuisine).toUpperCase()} ·{" "}
      {formatProtein(r.proteinPerServingG, r.proteinApproximate)} PROTEIN
    </>
  );
}

function costLine(v: PlanItemView): string {
  if (v.item.kind === "out") return "EATING OUT · NOTHING TO BUY OR COOK";
  if (v.status === "cooked") return v.review ? "COOKED · REVIEW TO FINISH" : "COOKED";
  if (v.status === "eaten") return "EATEN";
  if (v.status !== "planned") return v.status.toUpperCase();
  if (v.item.kind === "leftover") return "ALREADY PAID FOR";
  if (!v.cost) return "PRICING…";
  const unknown = v.cost.unknown ? ` · ${v.cost.unknown} PRICE${v.cost.unknown === 1 ? "" : "S"} UNKNOWN` : "";
  return v.cost.cents > 0 ? `+${formatCents(v.cost.cents)} TO BUY${unknown}` : `$0 · NOTHING EXTRA TO BUY${unknown}`;
}

export function PlanItemCard({ v, recipes, ingredients, onOpen, hid, uid }: { v: PlanItemView; recipes: Map<string, StoredRecipe>; ingredients: Map<string, IngredientEntry>; onOpen: () => void; hid: string; uid: string }) {
  const notify = useNotify();
  const navigate = useNavigate();
  const it = v.item;
  const status = v.status;
  const leftover = it.kind === "leftover";
  const out = it.kind === "out";
  const canCook = status === "planned" && !leftover && it.recipes.length > 0;
  // A cooked meal is finished by its review (M9); Mark eaten stays only for one whose review is already done (older data).
  const canReview = status === "cooked" && !!v.review;
  const canEat = !out && ((status === "cooked" && !v.review) || (status === "planned" && (leftover || it.mealType === "snack")));
  const eat = () => {
    sendCommand(hid, uid, "markEaten", { planItemId: v.id });
    notify({ kind: "success", message: leftover ? `Ate a portion of ${v.title}` : `${v.title} marked eaten` });
  };
  const multi = it.recipes.length > 1;
  const leftovers = (["lunch", "breakfast"] as const).filter((t) => t !== it.mealType && (it.coverage[t] ?? 0) > 0);
  const trashed = it.recipes.some((r) => recipes.get(r.recipeId)?.status === "trashed");
  // Sides (R5.9): an unnamed meal's title already lists them ("Salmon + french fries"); otherwise they get a line.
  const sideNames = (it.sides ?? []).map((x) => ingredients.get(x.ingredientId)?.name).filter((n): n is string => !!n);
  const lower = v.title.toLowerCase();
  const sides = it.sides?.length && !sideNames.every((n) => lower.includes(n.toLowerCase())) ? sidesLine(it.sides, (id) => ingredients.get(id)?.name) : "";
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
          <Badge className={cn("flex-none rounded-[calc(var(--r)*0.5)] px-1.5 py-1 text-[0.5625rem] uppercase", status === "planned" ? "bg-base" : "bg-acc text-onc")} data-testid="plan-item-status">
            {out ? "Eating out" : status === "planned" ? (leftover ? "Leftover" : "To cook") : status}
          </Badge>
        </div>
        {sides ? (
          <span className="font-mono text-[0.625rem] font-bold uppercase" data-testid="plan-item-sides">
            With {sides}
          </span>
        ) : null}
        {leftover ? (
          <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">Leftovers · 1 portion{v.leftover?.useBy ? ` · use by ${v.leftover.useBy}` : ""}</span>
        ) : out ? (
          <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">{MEAL_LABEL[it.mealType]} · covered, nothing to buy</span>
        ) : !multi ? (
          <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">{recipeMeta(recipes.get(it.recipes[0]?.recipeId ?? ""))}</span>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {leftover || out ? null : <Badge className="bg-s0 uppercase">{it.servings} serving{it.servings === 1 ? "" : "s"}</Badge>}
          {it.carriedFromId ? <Badge className="bg-peach-soft text-onc uppercase">Carried over</Badge> : null}
          {it.savedMealId ? <Badge className="bg-[color-mix(in_srgb,var(--blue)_55%,white)] text-[#4c4f69] uppercase">Saved meal</Badge> : null}
          {leftovers.map((t) => (
            <Badge key={t} className="bg-[color-mix(in_srgb,#c6a0f6_55%,white)] text-[#4c4f69] uppercase">
              Meal prep · +{it.coverage[t]} {t === "lunch" ? "lunches" : "breakfasts"}
            </Badge>
          ))}
          {trashed ? <Badge className="bg-red-soft text-onc uppercase">Recipe in Trash</Badge> : null}
          {v.expiry && status === "planned" ? (
            <Badge className="bg-peach-soft text-onc uppercase" data-testid="expiry-badge">
              {v.expiry}
            </Badge>
          ) : null}
          {v.leftover?.expired && status === "planned" ? <Badge className="bg-red-soft text-onc uppercase">Past its use-by</Badge> : v.leftover && status === "planned" ? <Badge className="bg-peach-soft text-onc uppercase">Eat soon</Badge> : null}
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
        {canCook ? (
          <Button size="sm" onClick={() => void navigate({ to: "/plan/$itemId/cook", params: { itemId: v.id } })} aria-label={`Cook ${v.title}`} className="shadow-hard-sm">
            Cook →
          </Button>
        ) : null}
        {canReview ? (
          <Link
            to="/review/$eventId"
            params={{ eventId: v.review! }}
            aria-label={`Review ${v.title} to finish it`}
            className="press inline-flex min-h-10 items-center rounded-ui border-2 border-line bg-acc px-3 text-[0.875rem] font-extrabold text-onc no-underline shadow-hard-sm"
          >
            Review →
          </Link>
        ) : null}
        {canEat ? (
          <Button size="sm" variant="secondary" onClick={eat} aria-label={leftover ? `Ate one: ${v.title}` : `Mark ${v.title} eaten`} className="shadow-hard-sm">
            {leftover ? "Ate one" : status === "cooked" ? "Mark eaten" : "Ate it"}
          </Button>
        ) : null}
        {!canCook && !canEat && status === "planned" && !out ? (
          <Button size="sm" variant="secondary" onClick={onOpen} aria-label={`Edit ${v.title}`} className="shadow-hard-sm">
            Edit
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function PlanItemSheet({
  v,
  hid,
  uid,
  recipes,
  ingredients,
  plannedMealTypes,
  onOpenChange,
}: {
  v: PlanItemView | null;
  hid: string;
  uid: string;
  recipes: Map<string, StoredRecipe>;
  ingredients: Map<string, IngredientEntry>;
  plannedMealTypes: readonly string[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!v} onOpenChange={onOpenChange}>
      {v ? <PlanItemBody key={v.id} v={v} hid={hid} uid={uid} recipes={recipes} ingredients={ingredients} plannedMealTypes={plannedMealTypes} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function sameSides(a: readonly MealSide[], b: readonly MealSide[]): boolean {
  return a.length === b.length && a.every((x, i) => x.ingredientId === b[i]!.ingredientId && x.portion === b[i]!.portion);
}

function PlanItemBody({
  v,
  hid,
  uid,
  recipes,
  ingredients,
  plannedMealTypes,
  close,
}: {
  v: PlanItemView;
  hid: string;
  uid: string;
  recipes: Map<string, StoredRecipe>;
  ingredients: Map<string, IngredientEntry>;
  plannedMealTypes: readonly string[];
  close: () => void;
}) {
  const notify = useNotify();
  const it = v.item;
  const [servings, setServings] = React.useState(it.servings);
  const [mealType, setMealType] = React.useState<MealType>(it.mealType);
  const [sides, setSides] = React.useState<MealSide[]>(it.sides ?? []);
  const sideList = useSides(it.kind === "meal");
  const titles = it.recipes.map((r) => recipes.get(r.recipeId)?.title ?? "Recipe");
  const sideNames = sides.map((x) => ingredients.get(x.ingredientId)?.name ?? sideList.byId.get(x.ingredientId)?.ingredient.name ?? "side");
  const [name, setName] = React.useState(it.name ?? defaultMealName(titles, sideNames));
  const [busy, setBusy] = React.useState(false);
  const types: MealType[] = [...PLANNABLE_MEAL_TYPES.filter((t) => plannedMealTypes.includes(t) || t === it.mealType), "snack"];
  const editable = it.status === "planned";
  const out = it.kind === "out";

  const save = async () => {
    setBusy(true);
    try {
      const coverage = coverageFor({ kind: it.kind, mealType, recipes: it.recipes }, (id) => recipes.get(id));
      await updatePlanItem(hid, v.id, { servings, mealType, coverage, ...(sameSides(sides, it.sides ?? []) ? {} : { sides }) });
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
      await saveItemAsMeal(hid, v.id, name, it.recipes, uid, sides);
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
          <Button className="flex-1" disabled={busy || !editable || (servings === it.servings && mealType === it.mealType && sameSides(sides, it.sides ?? []))} onClick={save}>
            Save changes
          </Button>
        </div>
      }
    >
      {out ? <p className="m-0 text-[0.875rem] font-semibold">Eating out: nothing to buy, cook, or take from Supply. It fills one {MEAL_LABEL[it.mealType].toLowerCase()} slot.</p> : null}
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
      {out ? null : (
      <div className="flex items-center justify-between gap-3 rounded-ui border-2 border-line bg-base px-3 py-2">
        <span id="pi-servings" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
          SERVINGS
        </span>
        <Stepper label="Servings" decLabel="Fewer servings" incLabel="More servings" labelledBy="pi-servings" value={servings} min={1} max={SERVINGS_MAX} onChange={setServings} />
      </div>
      )}
      {it.kind === "meal" && (editable || sides.length) ? (
        <section aria-label="Sides" className="flex flex-col gap-2">
          <SectionLabel hint="Per person">Sides</SectionLabel>
          {editable ? (
            <SidePicker value={sides} onChange={setSides} sides={sideList.list} servings={servings} ingredientOf={(id) => ingredients.get(id)} />
          ) : (
            <p className="m-0 text-[0.875rem] font-bold first-letter:uppercase">{sideNames.join(", ")}</p>
          )}
        </section>
      ) : null}
      {out ? null : it.savedMealId ? (
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
