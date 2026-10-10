// <ReviewSheet> as a full-screen phase (PRD R9.2–R9.4, R5.3, R5.8, R6.9; TECHNICAL_SPECS §6 submitReview; prototype
// phase "review": "Rate it", "What did you use?", "Leftovers"). Each person rates for themselves (1–10) the meal (when
// it's a saved one; otherwise multi-recipe meals offer "Save this meal?") and each recipe. The used amounts start from
// what Done cooking deducted (the recipe defaults); change, remove, or add any. Leftovers ▲/▼ from the estimate. The
// `submitReview` command posts the differences as corrections. Later reviewers (once the amounts are confirmed) only
// add their rating. "Review later" leaves it in Pending reviews.
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  defaultMealName,
  formatCanonical,
  leftoverPortionsByType,
  mealRequirements,
  totalPortions,
  type RecipeRef,
} from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/chip";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useNotify } from "@/components/notifications-context";
import { useAllIngredients, useIngredientsById, type IngredientEntry } from "@/data/ingredients";
import { saveMealFromReview, useRecipeDocs } from "@/data/plan";
import { sendCommand, useCookEvent, usePendingCommands, useRatings, useSupply } from "@/data/supply";
import { useMemberNames } from "@/data/households";
import { cn } from "@/lib/utils";

interface Source {
  title: string;
  recipeIds: string[];
  refs: RecipeRef[];
  savedMealId?: string | undefined;
  planItemId?: string | undefined;
  used: Array<{ ingredientId: string; canonicalAmount: number }>;
  leftoverPortions: number;
  reviewStatus: "pending" | "done";
  cookedBy: string;
  /** Still on its way to the server (offline or just sent). */
  pending: boolean;
}

export function ReviewView({ hid, uid, eventId, tz }: { hid: string; uid: string; eventId: string; tz: string }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const event = useCookEvent(hid, eventId);
  const pending = usePendingCommands(hid);
  const finishCmd = pending.find((p) => p.command.type === "finishCooking" && p.command.payload.cookEventId === eventId);
  const refs: RecipeRef[] = React.useMemo(
    () => (event.data ? event.data.recipeIds.map((recipeId) => ({ recipeId, servingsMultiplier: 1 })) : finishCmd?.command.type === "finishCooking" ? finishCmd.command.payload.recipes : []),
    [event.data, finishCmd],
  );
  const recipes = useRecipeDocs(refs.map((r) => r.recipeId));
  const ingredientIds = React.useMemo(() => [...recipes.values()].flatMap((r) => r.ingredientIds), [recipes]);
  const recipeIngredients = useIngredientsById(ingredientIds);
  const members = useMemberNames(hid);

  // What's being reviewed: the cook event, or (before it reaches the server) the pending finishCooking command.
  const source: Source | null = React.useMemo(() => {
    if (event.data) {
      const e = event.data;
      return { title: e.title ?? e.titles.join(" + "), recipeIds: e.recipeIds, refs: e.recipeIds.map((recipeId) => ({ recipeId, servingsMultiplier: 1 })), savedMealId: e.savedMealId, planItemId: e.planItemId, used: e.used, leftoverPortions: e.leftoverPortions, reviewStatus: e.reviewStatus, cookedBy: e.cookedBy, pending: false };
    }
    if (finishCmd?.command.type === "finishCooking" && refs.every((r) => recipes.has(r.recipeId)) && ingredientIds.every((id) => recipeIngredients.has(id))) {
      const p = finishCmd.command.payload;
      const needs = mealRequirements(p.recipes, p.servings, { recipes: (id) => recipes.get(id), ingredients: (id) => recipeIngredients.get(id) });
      return {
        title: p.title ?? p.recipes.map((r) => recipes.get(r.recipeId)?.title ?? "Recipe").join(" + "),
        recipeIds: p.recipes.map((r) => r.recipeId),
        refs: p.recipes,
        savedMealId: p.savedMealId,
        planItemId: p.planItemId,
        used: [...needs].map(([ingredientId, canonicalAmount]) => ({ ingredientId, canonicalAmount })),
        leftoverPortions: totalPortions(leftoverPortionsByType(p.recipes, (id) => recipes.get(id))),
        reviewStatus: "pending",
        cookedBy: uid,
        pending: true,
      };
    }
    return null;
  }, [event.data, finishCmd, recipes, recipeIngredients, ingredientIds, refs, uid]);

  if (event.data === undefined) return <Shell title="Review" onClose={() => void navigate({ to: "/plan" })} />;
  if (!source)
    return (
      <Shell title="Review" onClose={() => void navigate({ to: "/plan" })}>
        <p className="p-6 text-sm font-bold">{event.data === null && !finishCmd ? "This cooked meal isn't here any more." : "Loading…"}</p>
      </Shell>
    );
  return <ReviewFlow key={eventId} hid={hid} uid={uid} eventId={eventId} source={source} recipeTitles={(id) => recipes.get(id)?.title ?? "Recipe"} tz={tz} members={members} onDone={() => void navigate({ to: "/plan" })} notify={notify} />;
}

function Shell({ title, kicker = "Review", onClose, children }: { title: string; kicker?: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-pg text-ink" role="region" aria-label={`Review ${title}`}>
      <header className="flex flex-none items-center gap-3 border-b-bw bg-base px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <button type="button" onClick={onClose} aria-label="Close review" className="grid size-10 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink shadow-hard-sm">
          <X aria-hidden className="size-5" strokeWidth={3} />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem] uppercase">{kicker}</span>
          <span className="truncate text-[0.9375rem] font-extrabold">{title}</span>
        </span>
      </header>
      {children}
    </div>
  );
}

type Step = 1 | 2 | 3;

function ReviewFlow({
  hid,
  uid,
  eventId,
  source,
  recipeTitles,
  tz,
  members,
  onDone,
  notify,
}: {
  hid: string;
  uid: string;
  eventId: string;
  source: Source;
  recipeTitles: (id: string) => string;
  tz: string;
  members: Map<string, string>;
  onDone: () => void;
  notify: ReturnType<typeof useNotify>;
}) {
  const rateOnly = source.reviewStatus === "done";
  const [step, setStep] = React.useState<Step>(1);
  const ratingsQ = useRatings(hid);
  const mine = React.useMemo(() => new Map((ratingsQ.docs ?? []).filter((r) => r.data.cookEventId === eventId && r.data.uid === uid).map((r) => [`${r.data.targetType}:${r.data.targetId}`, r.data.score])), [ratingsQ.docs, eventId, uid]);
  const others = (ratingsQ.docs ?? []).filter((r) => r.data.cookEventId === eventId && r.data.uid !== uid);
  const [scores, setScores] = React.useState<Map<string, number>>(new Map());
  const [savedMealPick, setSavedMealId] = React.useState<string | undefined>(undefined);
  const savedMealId = savedMealPick ?? source.savedMealId;
  const [mealName, setMealName] = React.useState(() => defaultMealName(source.recipeIds.map(recipeTitles)));
  const [usedEdit, setUsedEdit] = React.useState<Array<{ ingredientId: string; canonicalAmount: number }> | null>(null);
  const [leftoversEdit, setLeftoversEdit] = React.useState<number | null>(null);
  // Until the person changes them, the amounts and leftovers follow the source: the pending estimate, then the cook
  // event once it reaches the server (what was actually deducted).
  const used = usedEdit ?? source.used.filter((u) => u.canonicalAmount > 0);
  const leftovers = leftoversEdit ?? source.leftoverPortions;
  const setUsed = (f: (l: Array<{ ingredientId: string; canonicalAmount: number }>) => Array<{ ingredientId: string; canonicalAmount: number }>) => setUsedEdit(f(used.map((u) => ({ ...u }))));
  const setLeftovers = (f: (n: number) => number) => setLeftoversEdit(f(leftovers));
  const [note, setNote] = React.useState("");
  const supply = useSupply(hid, tz);
  const usedIngredients = useIngredientsById([...used.map((u) => u.ingredientId), ...[...supply.items.values()].flatMap((i) => (i.ingredientId ? [i.ingredientId] : []))]);
  const [adding, setAdding] = React.useState(false);
  const all = useAllIngredients(adding);

  const scoreOf = (k: string) => scores.get(k) ?? mine.get(k);
  const setScore = (k: string, v: number) => setScores((m) => new Map(m).set(k, v));
  const targets: Array<{ key: string; type: "recipe" | "meal"; id: string; label: string; kicker: string }> = [
    ...(savedMealId ? [{ key: `meal:${savedMealId}`, type: "meal" as const, id: savedMealId, label: source.title, kicker: "The meal" }] : []),
    ...source.recipeIds.map((id) => ({ key: `recipe:${id}`, type: "recipe" as const, id, label: recipeTitles(id), kicker: "Recipe" })),
  ];

  const submit = () => {
    const ratings = targets.flatMap((t) => {
      const v = scores.get(t.key);
      return v ? [{ targetType: t.type, targetId: t.id, score: v }] : [];
    });
    sendCommand(hid, uid, "submitReview", {
      cookEventId: eventId,
      ratings,
      ...(rateOnly ? {} : { used: used.map((u) => ({ ingredientId: u.ingredientId, canonicalAmount: Math.max(0, Math.round(u.canonicalAmount * 1000) / 1000) })), leftoverPortions: leftovers }),
      ...(savedMealId && savedMealId !== source.savedMealId ? { savedMealId } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}),
    });
    notify({ kind: "success", message: rateOnly ? "Rating saved" : `Review saved · supply corrected${leftovers ? ` · ${leftovers} leftover portion${leftovers === 1 ? "" : "s"}` : ""}`, link: rateOnly ? undefined : { to: "/supply", label: "See supply" } });
    onDone();
  };

  const saveMeal = () => {
    if (!mealName.trim()) return;
    const id = saveMealFromReview(hid, source.planItemId, mealName, source.refs, uid);
    setSavedMealId(id);
    notify({ kind: "success", message: `Saved “${mealName.trim()}” to Meals`, link: { to: "/meals", label: "Meals" } });
  };

  const tabs: Array<[Step, string]> = rateOnly ? [[1, "1 · Rate"]] : [
    [1, "1 · Rate"],
    [2, "2 · Used"],
    [3, "3 · Leftovers"],
  ];
  const last = rateOnly || step === 3;

  return (
    <Shell title={source.title} kicker={rateOnly ? "Add your rating" : "Review"} onClose={onDone}>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col gap-3.5 px-4 pt-3.5 pb-4">
          <div role="tablist" aria-label="Review steps" className={cn("grid gap-2", rateOnly ? "grid-cols-1" : "grid-cols-3")}>
            {tabs.map(([n, l]) => (
              <button key={n} type="button" role="tab" aria-selected={step === n} onClick={() => setStep(n)} className={cn("cursor-pointer rounded-ui border-2 border-line py-2 font-mono text-[0.625rem] font-bold uppercase", step === n ? "bg-acc text-onc" : n < step ? "bg-s0 text-ink" : "bg-base text-ink")}>
                {l}
              </button>
            ))}
          </div>
          {source.pending ? <p className="m-0 rounded-ui border-2 border-dashed border-line p-2 font-mono text-[0.625rem] font-bold uppercase">Syncing · supply updates when you're back online</p> : null}

          {step === 1 ? (
            <>
              <h1 className="m-0 font-display text-[2rem] leading-none font-normal">Rate it</h1>
              <span className="text-[0.8125rem] font-semibold text-sub">
                Rating as {members.get(uid) ?? "you"}. Everyone in the household rates for themselves.
                {others.length ? ` ${[...new Set(others.map((o) => members.get(o.data.uid) ?? "Someone"))].join(", ")} already rated.` : ""}
              </span>
              {targets.map((t) => (
                <RatingCard key={t.key} kicker={t.kicker} label={t.label} value={scoreOf(t.key)} onPick={(v) => setScore(t.key, v)} />
              ))}
              {!savedMealId && source.recipeIds.length > 1 ? (
                <div className="flex flex-col gap-2 rounded-ui border-bw bg-base p-3.5 shadow-hard" data-testid="save-meal-prompt">
                  <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">SAVE THIS MEAL?</span>
                  <span className="text-[0.8125rem] font-semibold text-sub">Keep it in Meals to plan it again and rate the meal as a whole.</span>
                  <div className="flex gap-2">
                    <Input aria-label="Meal name" value={mealName} maxLength={80} onChange={(e) => setMealName(e.target.value)} className="flex-1" />
                    <Button variant="secondary" onClick={saveMeal} disabled={!mealName.trim()}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : step === 2 ? (
            <>
              <h1 className="m-0 font-display text-[2rem] leading-none font-normal">What did you use?</h1>
              <span className="text-[0.8125rem] font-semibold text-sub">Pre-filled from the recipe. Change anything that was different.</span>
              {used.length ? (
                <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0 shadow-hard" aria-label="Ingredients used">
                  {used.map((u, i) => {
                    const ing = usedIngredients.get(u.ingredientId);
                    const def = source.used.find((x) => x.ingredientId === u.ingredientId)?.canonicalAmount;
                    const unit = ing?.canonicalUnit ?? "g";
                    const stepAmt = unit === "count" ? 1 : u.canonicalAmount < 100 ? 5 : 25;
                    const name = ing ? ing.name.charAt(0).toUpperCase() + ing.name.slice(1) : u.ingredientId.replace(/-/g, " ");
                    return (
                      <li key={u.ingredientId} className={cn("flex items-center gap-2 px-3 py-2.5", i && "border-t-2 border-line")} data-testid="used-row">
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-[0.9375rem] font-extrabold">{name}</span>
                          <span className="font-mono text-[0.5625rem] font-bold text-sub uppercase">{def === undefined ? "added" : Math.abs(def - u.canonicalAmount) < 1e-6 ? "as written" : `recipe ${formatCanonical(def, unit, ing?.unitWeightG)}`}</span>
                        </span>
                        <div className="flex flex-none overflow-hidden rounded-ui border-2 border-line" role="group" aria-label={`${name} used`}>
                          <button type="button" aria-label={`Less ${name}`} onClick={() => setUsed((l) => l.map((x) => (x.ingredientId === u.ingredientId ? { ...x, canonicalAmount: Math.max(0, x.canonicalAmount - stepAmt) } : x)))} className="h-10 w-9 cursor-pointer bg-pg text-lg font-extrabold">
                            −
                          </button>
                          <output className="flex min-w-[5.75rem] items-center justify-center border-x-2 border-line px-1 font-mono text-[0.6875rem] font-extrabold" aria-label={`${name} amount`}>
                            {formatCanonical(u.canonicalAmount, unit, ing?.unitWeightG).replace(" · ", " · ")}
                          </output>
                          <button type="button" aria-label={`More ${name}`} onClick={() => setUsed((l) => l.map((x) => (x.ingredientId === u.ingredientId ? { ...x, canonicalAmount: x.canonicalAmount + stepAmt } : x)))} className="h-10 w-9 cursor-pointer bg-pg text-lg font-extrabold">
                            +
                          </button>
                        </div>
                        <button type="button" aria-label={`Didn't use ${name}`} onClick={() => setUsed((l) => l.filter((x) => x.ingredientId !== u.ingredientId))} className="grid size-10 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base">
                          <X aria-hidden className="size-4" strokeWidth={3} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-0 text-sm font-semibold">Nothing tracked was used.</p>
              )}
              <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">ADD SOMETHING YOU USED</span>
              <div className="flex flex-wrap gap-1.5">
                {[...supply.items.values()]
                  .filter((i) => i.ingredientId && !used.some((u) => u.ingredientId === i.ingredientId) && i.lots.length)
                  .slice(0, 8)
                  .map((i) => {
                    const ing = usedIngredients.get(i.ingredientId!);
                    return (
                      <button key={i.id} type="button" onClick={() => setUsed((l) => [...l, { ingredientId: i.ingredientId!, canonicalAmount: ing?.canonicalUnit === "count" ? 1 : 100 }])} className="cursor-pointer rounded-ui border-2 border-line bg-base px-2.5 py-1.5 text-[0.8125rem] font-extrabold shadow-hard-sm">
                        + {i.label.charAt(0).toUpperCase() + i.label.slice(1)}
                      </button>
                    );
                  })}
                <button type="button" onClick={() => setAdding((a) => !a)} className="cursor-pointer rounded-ui border-2 border-dashed border-line bg-base px-2.5 py-1.5 text-[0.8125rem] font-extrabold">
                  + Something else
                </button>
              </div>
              {adding ? (
                <IngredientPicker
                  ingredients={all.list ?? []}
                  uid={uid}
                  label="Ingredient used"
                  autoFocus
                  onPick={(i: IngredientEntry) => {
                    if (!used.some((u) => u.ingredientId === i.id)) setUsed((l) => [...l, { ingredientId: i.id, canonicalAmount: i.canonicalUnit === "count" ? 1 : 100 }]);
                    setAdding(false);
                  }}
                />
              ) : null}
            </>
          ) : (
            <>
              <h1 className="m-0 font-display text-[2rem] leading-none font-normal">Leftovers</h1>
              <div className="flex items-center gap-4 rounded-ui border-bw bg-base p-4 shadow-hard">
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[1.125rem] leading-tight font-extrabold">
                    Estimated leftovers: {source.leftoverPortions} {source.leftoverPortions === 1 ? "portion" : "portions"}. Correct?
                  </span>
                  <span className="text-[0.8125rem] font-semibold text-sub">Portions go into supply with a 4-day use-by and fill lunch slots in the plan.</span>
                </span>
                <span className="flex flex-col items-center">
                  <output className="font-display text-[3rem] leading-none" aria-label="Leftover portions" data-testid="leftover-count">
                    {leftovers}
                  </output>
                  <span className="font-mono text-[0.5625rem] font-bold">PORTIONS</span>
                </span>
                <span className="flex flex-col gap-1.5">
                  <Button size="icon" onClick={() => setLeftovers((n) => Math.min(50, n + 1))} aria-label="More leftovers">
                    ▲
                  </Button>
                  <Button size="icon" variant="secondary" onClick={() => setLeftovers((n) => Math.max(0, n - 1))} aria-label="Fewer leftovers">
                    ▼
                  </Button>
                </span>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">NOTES FOR NEXT TIME (OPTIONAL)</span>
                <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pork could go five minutes longer." />
              </label>
            </>
          )}

          <div className="mt-auto flex flex-col items-center gap-2 pt-3">
            <div className="flex w-full gap-2.5">
              {step > 1 ? (
                <Button variant="secondary" size="lg" className="flex-none" onClick={() => setStep((s) => (s - 1) as Step)}>
                  ← Back
                </Button>
              ) : null}
              <Button size="lg" className="flex-1" onClick={() => (last ? submit() : setStep((s) => (s + 1) as Step))}>
                {rateOnly ? "Save rating" : last ? "Save & update supply" : "Next →"}
              </Button>
            </div>
            <button type="button" onClick={onDone} className="cursor-pointer bg-transparent p-1 text-[0.8125rem] font-extrabold text-ink underline">
              Review later
            </button>
          </div>
        </div>
      </main>
    </Shell>
  );
}

function RatingCard({ kicker, label, value, onPick }: { kicker: string; label: string; value: number | undefined; onPick: (v: number) => void }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-2.5 rounded-ui border-bw bg-base p-3.5 shadow-hard" role="group" aria-labelledby={id} data-testid="rating-card">
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem] uppercase">{kicker}</span>
          <span id={id} className="text-[1rem] font-extrabold">
            {label}
          </span>
        </span>
        <span className="font-display text-[1.75rem] leading-none">
          {value ?? "–"}
          <span className="font-mono text-[0.75rem]">/10</span>
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" aria-pressed={value === n} aria-label={`${n} out of 10`} onClick={() => onPick(n)} className={cn("h-11 cursor-pointer rounded-ui border-2 border-line font-mono text-[0.9375rem] font-extrabold", value === n ? "bg-acc text-onc" : value !== undefined && n < value ? "bg-s0 text-ink shadow-hard-sm" : "bg-base text-ink shadow-hard-sm")}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
