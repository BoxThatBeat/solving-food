// <CreateMealSheet> (PRD R5.7, R5.8; TECHNICAL_SPECS §7 "Creating meals", §12): the Plan page's primary action.
// Step 1 picks one or more recipes with the shared <CollectionView> in multi-select mode (Suggested first, selected
// recipes pinned on top with a servings multiplier), or a saved meal. Step 2 sets the meal type, servings (default
// R11.12), sides (R5.9, picked from a search dropdown with the household's portion per person snapshotted), and
// optionally a name + "Save as meal", shows the budget impact, and adds the plan item. M9 (R6.23): a third tab,
// Eating out, adds a plan item with no recipes for a meal type and an optional note.
import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import {
  addedCost,
  applyCollection,
  collectionSearchSchema,
  createMealInputSchema,
  defaultMealName,
  EATING_OUT_NOTE_MAX,
  formatCents,
  formatMinutes,
  formatProtein,
  mealRow,
  optionCount,
  PLANNABLE_MEAL_TYPES,
  SERVINGS_MAX,
  tagCounts,
  taxonomyLabel,
  type CollectionSearch,
  type MealSide,
  type MealType,
  type RecipeRef,
} from "@solving-food/core";
import { CollectionView } from "@/components/CollectionView";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { useHouseholdFacts, useNotes } from "@/data/householdRecipes";
import { addEatingOut, createMeal, useMeals } from "@/data/plan";
import { usePlanModel } from "@/data/planModel";
import { useSides } from "@/data/sides";
import { SidePicker } from "./SidePicker";
import { useSuggestions } from "@/data/suggestions";
import { useRecipeIndex, useRecipeSearch } from "@/search/useRecipeSearch";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";
import { MEAL_LABEL, type CreateMealRequest } from "./plan-sheet-context";

type Step = "pick" | "details";
type Tab = "recipes" | "meals" | "out";

const MULTIPLIERS_STEP = 0.5;

function fmtMultiplier(m: number): string {
  if (m % 1 === 0) return `×${m}`;
  return `×${Math.floor(m) || ""}½`;
}

export function CreateMealSheet({ open, request, onOpenChange }: { open: boolean; request: CreateMealRequest; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? <CreateMealBody key={JSON.stringify(request)} request={request} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function CreateMealBody({ request, close }: { request: CreateMealRequest; close: () => void }) {
  const s = useReadySession();
  const notify = useNotify();
  const pathname = useRouterState({ select: (x) => x.location.pathname });
  const summaries = useRecipeIndex();
  const all = React.useMemo(() => summaries ?? [], [summaries]);
  const byId = React.useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const meals = useMeals();
  const sideList = useSides();
  const sideName = React.useCallback((id: string) => sideList.byId.get(id)?.ingredient.name, [sideList.byId]);
  const mealRows = React.useMemo(
    () => (meals.docs ?? []).map((m) => ({ ...mealRow(m.id, m.data, (id) => byId.get(id), sideName), doc: m.data })).sort((a, b) => a.title.localeCompare(b.title)),
    [meals.docs, byId, sideName],
  );

  const preMeal = request.savedMealId ? meals.docs?.find((m) => m.id === request.savedMealId) : undefined;
  const [selected, setSelected] = React.useState<RecipeRef[]>(() => (request.recipeIds ?? []).map((recipeId) => ({ recipeId, servingsMultiplier: 1 })));
  const [sides, setSides] = React.useState<MealSide[]>([]);
  const [savedMealId, setSavedMealId] = React.useState<string | undefined>(request.savedMealId);
  const [step, setStep] = React.useState<Step>(request.recipeIds?.length || request.savedMealId ? "details" : "pick");
  const [tab, setTab] = React.useState<Tab>("recipes");
  const [search, setSearch] = React.useState<CollectionSearch>({});
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [saveAsMeal, setSaveAsMeal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outNote, setOutNote] = React.useState("");

  // A preselected saved meal arrives with the meals listener.
  const [appliedMeal, setAppliedMeal] = React.useState<string | null>(null);
  if (preMeal && appliedMeal !== preMeal.id) {
    setAppliedMeal(preMeal.id);
    setSelected(preMeal.data.recipes.filter((r) => byId.size === 0 || byId.has(r.recipeId)));
    setSides(preMeal.data.sides ?? []);
    setName(preMeal.data.name);
  }

  const model = usePlanModel({ extraRecipeIds: selected.map((r) => r.recipeId), extraIngredientIds: sides.map((x) => x.ingredientId) });
  const household = model.household;
  const plannedTypes = household?.plannedMealTypes ?? [...PLANNABLE_MEAL_TYPES];
  const mealTypes: MealType[] = [...PLANNABLE_MEAL_TYPES.filter((t) => plannedTypes.includes(t)), "snack"];
  const [mealType, setMealType] = React.useState<MealType>(() => request.mealType ?? "dinner");
  const effectiveType: MealType = mealTypes.includes(mealType) ? mealType : (mealTypes[0] ?? "dinner");
  const [servings, setServings] = React.useState<number | null>(null);
  const effectiveServings = servings ?? household?.defaultServings ?? 4;

  const titles = selected.map((r) => byId.get(r.recipeId)?.title ?? model.recipes.get(r.recipeId)?.title ?? "Recipe");
  const sideNames = sides.map((x) => sideName(x.ingredientId) ?? model.ingredients.get(x.ingredientId)?.name ?? "side");
  const autoName = savedMealId ? name : defaultMealName(titles, sideNames);
  const shownName = nameTouched || savedMealId ? name : autoName;

  // Recipes tab: shared filters and text search over the index.
  const notes = useNotes(model.hid);
  const suggestions = useSuggestions();
  const factsOf = useHouseholdFacts(model.hid, all, model.supply.loading ? undefined : model.projected, suggestions.byId);
  const matches = useRecipeSearch(all, notes, search.q ?? "");
  const result = React.useMemo(() => applyCollection(all, search, factsOf, matches), [all, search, factsOf, matches]);
  const tags = React.useMemo(() => tagCounts(all), [all]);
  const isSelected = (id: string) => selected.some((r) => r.recipeId === id);
  const toggle = (id: string) => {
    setSavedMealId(undefined);
    setSelected((sel) => (sel.some((r) => r.recipeId === id) ? sel.filter((r) => r.recipeId !== id) : [...sel, { recipeId: id, servingsMultiplier: 1 }]));
  };
  const setMultiplier = (id: string, m: number) => setSelected((sel) => sel.map((r) => (r.recipeId === id ? { ...r, servingsMultiplier: m } : r)));

  const pickMeal = (id: string) => {
    const m = mealRows.find((x) => x.id === id);
    if (!m) return;
    setSavedMealId(id);
    setSelected(m.doc.recipes.filter((r) => byId.has(r.recipeId)));
    // A saved meal keeps its sides with the portions it was saved with (R5.9, R5.10).
    setSides(m.doc.sides ?? []);
    setName(m.title);
    setNameTouched(true);
    setSaveAsMeal(false);
    setStep("details");
  };

  const impact = React.useMemo(() => {
    if (!model.ready || !selected.length) return null;
    const planned = model.items.map((i) => ({ id: i.id, status: i.data.status, servings: i.data.servings, recipes: i.data.recipes, sides: i.data.sides }));
    return addedCost(planned, { id: "new", status: "planned", servings: effectiveServings, recipes: selected, sides }, model.ctx);
  }, [model.ready, model.items, model.ctx, selected, sides, effectiveServings]);

  const canName = !savedMealId;
  const submit = async () => {
    setError(null);
    if (!model.periodId) {
      setError("The plan period is still being set up. Try again in a moment.");
      return;
    }
    const input = {
      recipes: selected,
      ...(sides.length ? { sides } : {}),
      ...(savedMealId ? { savedMealId } : {}),
      mealType: effectiveType,
      servings: effectiveServings,
      ...(shownName.trim() ? { name: shownName.trim() } : {}),
      saveAsMeal: canName && saveAsMeal,
    };
    const parsed = createMealInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the meal");
      return;
    }
    setBusy(true);
    try {
      const lookup = (id: string) => model.recipes.get(id);
      const write = createMeal(model.hid, model.periodId, parsed.data, s.user.uid, lookup);
      // Offline the write is queued and resolves later; don't hold the sheet open for it.
      if (navigator.onLine) await write;
      else void write.catch(() => notify({ kind: "error", message: "Couldn't add the meal to the plan" }));
      const what = parsed.data.saveAsMeal ? `Added to plan · ${MEAL_LABEL[effectiveType].toLowerCase()} · saved to Meals` : `Added to plan · ${MEAL_LABEL[effectiveType].toLowerCase()}`;
      notify({ kind: "success", message: what, ...(pathname !== "/plan" ? { link: { to: "/plan", label: "Plan" } } : {}) });
      close();
    } catch (e) {
      setError(`Couldn't add it: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const submitOut = async () => {
    setError(null);
    if (!model.periodId) {
      setError("The plan period is still being set up. Try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      const write = addEatingOut(model.hid, model.periodId, { mealType: effectiveType, ...(outNote.trim() ? { note: outNote.trim() } : {}) }, s.user.uid);
      if (navigator.onLine) await write;
      else void write.catch(() => notify({ kind: "error", message: "Couldn't add it to the plan" }));
      notify({ kind: "success", message: `Eating out · ${MEAL_LABEL[effectiveType].toLowerCase()} added to the plan`, ...(pathname !== "/plan" ? { link: { to: "/plan", label: "Plan" } } : {}) });
      close();
    } catch (e) {
      setError(`Couldn't add it: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  if (step === "pick") {
    return (
      <SheetContent
        title="Create meal"
        description="Pick one or more recipes, or a saved meal"
        className="md:h-[88dvh]"
        footer={
          tab === "recipes" ? (
            <Button className="w-full" size="lg" disabled={!selected.length} onClick={() => setStep("details")}>
              {selected.length ? `Next · ${selected.length} recipe${selected.length === 1 ? "" : "s"}` : "Pick at least one recipe"}
            </Button>
          ) : tab === "out" ? (
            <div className="flex flex-col gap-2">
              {error ? (
                <p role="alert" className="m-0 text-sm font-extrabold text-ink">
                  {error}
                </p>
              ) : null}
              <Button className="w-full" size="lg" disabled={busy} onClick={submitOut}>
                {busy ? "Adding…" : `Add eating out · ${MEAL_LABEL[effectiveType]}`}
              </Button>
            </div>
          ) : undefined
        }
      >
        <div role="tablist" aria-label="Pick from" className="grid flex-none grid-cols-3 overflow-hidden rounded-ui border-2 border-line bg-base">
          {(["recipes", "meals", "out"] as const).map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("cursor-pointer px-1 py-2.5 text-center text-[0.8125rem] font-extrabold", i && "border-l-2 border-line", tab === t ? "bg-acc text-onc" : "bg-transparent text-ink")}
            >
              {t === "recipes" ? "Recipes" : t === "out" ? "Eating out" : `Saved meals${mealRows.length ? ` · ${mealRows.length}` : ""}`}
            </button>
          ))}
        </div>

        {tab === "recipes" ? (
          <>
            {selected.length ? (
              <section aria-label="Selected recipes" className="flex flex-col gap-2">
                <SectionLabel hint="Servings multiplier">Selected · {selected.length}</SectionLabel>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {selected.map((r) => {
                    const sum = byId.get(r.recipeId);
                    const title = sum?.title ?? "Recipe";
                    return (
                      <li key={r.recipeId} className="flex items-center gap-2 rounded-ui border-2 border-line bg-acc px-2.5 py-1.5 text-onc">
                        <span className="min-w-0 flex-1 text-sm leading-tight font-extrabold">{title}</span>
                        <Stepper
                          label={`Multiplier for ${title}`}
                          value={r.servingsMultiplier}
                          min={0.5}
                          max={4}
                          step={MULTIPLIERS_STEP}
                          format={fmtMultiplier}
                          onChange={(v) => setMultiplier(r.recipeId, v)}
                          className="text-ink [&_button]:size-9"
                        />
                        <button type="button" aria-label={`Remove ${title}`} onClick={() => toggle(r.recipeId)} className="grid size-9 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink">
                          <X aria-hidden className="size-4" strokeWidth={3} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            <CollectionView
              search={search}
              onSearchChange={(next) => setSearch(collectionSearchSchema.parse(next))}
              placeholder="Search recipes to add…"
              noun="recipes"
              countFor={(x) => applyCollection(all, x, factsOf, x.q === search.q ? matches : null).items.length}
              optionCount={(key, value) => optionCount(all, search, factsOf, matches, key, value)}
              tags={tags}
              sticky={false}
            >
              <ul aria-label="Recipes to pick" className="m-0 flex list-none flex-col gap-1.5 p-0">
                {summaries === undefined ? <li className="text-sm font-bold">Loading recipes…</li> : null}
                {result.items.map((r) => {
                  const on = isSelected(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(r.id)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2.5 rounded-ui border-2 border-line px-2.5 py-2 text-left",
                          on ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm",
                        )}
                      >
                        <span aria-hidden className={cn("grid size-6 flex-none place-items-center rounded-[calc(var(--r)*0.5)] border-2 border-line", on ? "bg-ink text-base" : "bg-base")}>
                          {on ? <Check className="size-3.5" strokeWidth={4} /> : null}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm leading-tight font-extrabold">{r.title}</span>
                          <span className="font-mono text-[0.625rem] font-semibold uppercase opacity-80">
                            {formatMinutes(r.totalMin)} · {taxonomyLabel(r.cuisine)} · {formatProtein(r.proteinPerServingG, r.proteinApproximate)} protein
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {summaries && result.items.length === 0 ? <li className="rounded-ui border-2 border-dashed border-line p-4 text-center text-sm font-bold">No recipes match.</li> : null}
              </ul>
            </CollectionView>
          </>
        ) : tab === "out" ? (
          <section aria-label="Eating out" className="flex flex-col gap-3">
            <p className="m-0 text-[0.875rem] font-semibold">A meal you&apos;ll eat out: it fills a slot in the plan with nothing to buy, cook, or take from Supply.</p>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0">
                <SectionLabel>Meal type</SectionLabel>
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {mealTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={effectiveType === t}
                    onClick={() => setMealType(t)}
                    className={cn("cursor-pointer rounded-ui border-2 border-line px-2 py-3 text-[0.9375rem] font-extrabold", effectiveType === t ? "bg-acc text-onc" : "bg-base text-ink shadow-hard")}
                  >
                    {MEAL_LABEL[t]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1.5">
              <SectionLabel hint="Optional">Note</SectionLabel>
              <Input value={outNote} maxLength={EATING_OUT_NOTE_MAX} onChange={(e) => setOutNote(e.target.value)} placeholder="Pizza night, dinner at Mom's…" aria-label="Note" />
            </label>
          </section>
        ) : (
          <ul aria-label="Saved meals" className="m-0 flex list-none flex-col gap-2 p-0">
            {meals.docs === undefined ? <li className="text-sm font-bold">Loading meals…</li> : null}
            {meals.docs && mealRows.length === 0 ? (
              <li className="rounded-ui border-2 border-dashed border-line p-4 text-center text-sm font-bold">
                No saved meals yet. Pick recipes, then turn on “Save as meal”.
              </li>
            ) : null}
            {mealRows.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => pickMeal(m.id)} className="flex w-full cursor-pointer items-center gap-3 rounded-ui border-bw bg-base px-3 py-2.5 text-left text-ink shadow-hard">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[0.9375rem] font-extrabold">{m.title}</span>
                    <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                      {m.recipeIds.length} recipe{m.recipeIds.length === 1 ? "" : "s"} · {formatMinutes(m.totalMin)} total
                      {m.missing.length ? ` · ${m.missing.length} in Trash` : ""}
                    </span>
                  </span>
                  <span aria-hidden className="font-extrabold">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    );
  }

  const fromMeal = savedMealId ? mealRows.find((m) => m.id === savedMealId) : undefined;
  return (
    <SheetContent
      title="Add to plan"
      description="Meal type, servings, sides, and an optional name"
      footer={
        <div className="flex flex-col gap-2">
          {error ? (
            <p role="alert" className="m-0 text-sm font-extrabold text-ink">
              {error}
            </p>
          ) : null}
          <Button className="w-full" size="lg" disabled={busy || !selected.length} onClick={submit}>
            {busy ? "Adding…" : `Add to plan · ${MEAL_LABEL[effectiveType]}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[1.0625rem] leading-tight font-extrabold" data-testid="create-meal-title">
          {fromMeal ? fromMeal.title : defaultMealName(titles, sideNames) || "No recipes picked"}
        </span>
        {fromMeal ? <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">Saved meal · {titles.join(" + ")}</span> : null}
        {selected.some((r) => r.servingsMultiplier !== 1) ? (
          <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">
            {selected.map((r, i) => `${titles[i]} ${fmtMultiplier(r.servingsMultiplier)}`).join(" · ")}
          </span>
        ) : null}
        <button type="button" onClick={() => setStep("pick")} className="cursor-pointer self-start bg-transparent p-0 text-[0.8125rem] font-extrabold text-ink underline">
          Change recipes
        </button>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0">
          <SectionLabel>Meal type</SectionLabel>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {mealTypes.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={effectiveType === t}
              onClick={() => setMealType(t)}
              className={cn("cursor-pointer rounded-ui border-2 border-line px-2 py-3 text-[0.9375rem] font-extrabold", effectiveType === t ? "bg-acc text-onc" : "bg-base text-ink shadow-hard")}
            >
              {MEAL_LABEL[t]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3 rounded-ui border-2 border-line bg-base px-3 py-2">
        <span className="flex flex-col gap-0.5">
          <span id="cm-servings" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
            SERVINGS
          </span>
          <span className="text-[0.75rem] font-semibold text-sub">Each recipe is scaled to this</span>
        </span>
        <Stepper label="Servings" decLabel="Fewer servings" incLabel="More servings" labelledBy="cm-servings" value={effectiveServings} min={1} max={SERVINGS_MAX} onChange={setServings} />
      </div>

      <section aria-label="Sides" className="flex flex-col gap-2">
        <SectionLabel hint="Optional · per person">Sides</SectionLabel>
        <span className="-mt-1 text-[0.75rem] font-semibold text-sub">Fries, rice, buns: eaten as is, no recipe. They go on the grocery list.</span>
        <SidePicker value={sides} onChange={setSides} sides={sideList.list} servings={effectiveServings} ingredientOf={(id) => model.ingredients.get(id)} />
      </section>

      {canName ? (
        <div className="flex flex-col gap-2 rounded-ui border-2 border-line bg-base p-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-[0.9375rem] font-extrabold">
            <input type="checkbox" checked={saveAsMeal} onChange={(e) => setSaveAsMeal(e.target.checked)} className="size-5 accent-[var(--ink)]" />
            Save as meal
          </label>
          <span className="text-[0.75rem] font-semibold text-sub">Adds a reusable copy to Meals. The planned meal is the same either way.</span>
          {saveAsMeal || selected.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cm-name" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
                NAME{saveAsMeal ? "" : " (OPTIONAL)"}
              </label>
              <Input
                id="cm-name"
                value={shownName}
                maxLength={80}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder="Taco night"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1 rounded-ui border-2 border-line bg-base px-3.5 py-3" data-testid="budget-impact">
        <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">BUDGET IMPACT</span>
        {impact ? (
          <>
            <span className="text-[1.0625rem] font-extrabold">{impact.cents > 0 ? `+${formatCents(impact.cents)} to buy` : "Nothing extra to buy"}</span>
            <span className="text-[0.8125rem] font-semibold">
              Leaves {formatCents(model.budget.remainingCents - impact.cents)} of {formatCents(model.budget.budgetCents)}.
              {impact.unknown ? ` ${impact.unknown} price${impact.unknown === 1 ? "" : "s"} unknown.` : ""}
            </span>
          </>
        ) : (
          <span className="text-[0.8125rem] font-semibold">Working it out…</span>
        )}
        <span className="text-[0.75rem] font-semibold text-sub">Going over is fine; nothing is blocked.</span>
      </div>
      {!model.periodId ? (
        <p className="m-0 text-[0.8125rem] font-semibold text-sub">
          Setting up this household's plan period… <Link to="/plan">Plan</Link>
        </p>
      ) : null}
    </SheetContent>
  );
}
