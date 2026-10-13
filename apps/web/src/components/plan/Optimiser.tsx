// The budget optimiser on the Plan page (PRD R6.18–R6.20, R6.16; TECHNICAL_SPECS §7 "Optimiser", §12
// <OptimiserSheet>): "n dinners under $x", a meal type, and "only recipes that meet the protein goal". Find sets asks
// the optimiser worker for the best good set; Next asks for the next one (Back is instant, from memory); Accept adds
// every recipe in the set as its own planned meal in one batch. When the good sets run out it says "No more good
// combinations" and offers to relax the budget, the caps, or the protein filter. Shown as a card, as the prototype
// draws it, rather than a sheet.
import { RecipeThumb } from "@/components/recipes/RecipeThumb";
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { defaultCap, formatCents, formatProtein, MEAL_TYPES, taxonomyLabel, type MealType, type OptimiserSet, type RecipeSummary } from "@solving-food/core";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { cn } from "@/lib/utils";
import { useNutrition } from "@/data/nutrition";
import { addOptimiserSet } from "@/data/plan";
import type { ScoringSnapshot } from "@/workers/snapshot";
import type { OptimiserRequest, OptimiserResponse } from "@/workers/optimiser.worker";
import { MEAL_LABEL } from "./plan-sheet-context";

type ShownSet = OptimiserSet & { costs: Record<string, number | null> };

const PLURAL: Record<MealType, string> = { breakfast: "breakfasts", lunch: "lunches", dinner: "dinners", snack: "snacks" };

export function OptimiserCard({
  snapshot,
  summaries,
  hid,
  periodId,
  uid,
  servings,
  remainingCents,
  goals,
}: {
  snapshot: ScoringSnapshot | null;
  summaries: ReadonlyMap<string, RecipeSummary>;
  hid: string;
  periodId: string | null;
  uid: string;
  servings: number;
  remainingCents: number;
  goals: Partial<Record<MealType, number>>;
}) {
  const notify = useNotify();
  const [n, setN] = React.useState(4);
  const [mealType, setMealType] = React.useState<MealType>("dinner");
  // "4 dinners under $60" by default, or what's left of the budget when that is less.
  const defaultMax = Math.max(10, Math.min(60, Math.floor(Math.max(0, remainingCents) / 100 / 5) * 5));
  const [max, setMax] = React.useState<number | null>(null);
  const maxDollars = max ?? defaultMax;
  const [proteinOnly, setProteinOnly] = React.useState(false);
  const [caps, setCaps] = React.useState<number | null>(null);
  const [sets, setSets] = React.useState<ShownSet[]>([]);
  const [index, setIndex] = React.useState(0);
  const [state, setState] = React.useState<"idle" | "searching" | "done" | "exhausted">("idle");
  const [busy, setBusy] = React.useState(false);
  const worker = React.useRef<Worker | null>(null);
  const seq = React.useRef(0);
  const goal = goals[mealType];
  // M9: the fibre goal joins the filter (R6.26); with tracking off neither goal shows (R6.27).
  const nutrition = useNutrition();
  const fibreGoal = nutrition.fibreGoals[mealType];
  const anyGoal = goal !== undefined || fibreGoal !== undefined;
  const goalText = [goal !== undefined ? `protein goal (${goal} g)` : null, fibreGoal !== undefined ? `fibre goal (${fibreGoal} g)` : null].filter(Boolean).join(" and ");

  React.useEffect(() => () => worker.current?.terminate(), []);

  const reset = () => {
    seq.current++;
    setSets([]);
    setIndex(0);
    setState("idle");
  };

  const ask = (req: OptimiserRequest) =>
    new Promise<OptimiserResponse>((resolve) => {
      let w = worker.current;
      if (!w) {
        w = new Worker(new URL("../../workers/optimiser.worker.ts", import.meta.url), { type: "module" });
        worker.current = w;
      }
      const onMsg = (e: MessageEvent<OptimiserResponse>) => {
        if (e.data.seq !== req.seq) return;
        w!.removeEventListener("message", onMsg);
        resolve(e.data);
      };
      w.addEventListener("message", onMsg);
      w.postMessage(req);
    });

  const find = async () => {
    if (!snapshot) return;
    const id = ++seq.current;
    setState("searching");
    setSets([]);
    setIndex(0);
    const cap = caps ?? defaultCap(n);
    const r = await ask({ type: "start", seq: id, snapshot, n, maxCents: maxDollars * 100, mealType, proteinOnly, cuisineCap: cap, proteinCap: cap });
    if (id !== seq.current) return;
    if (r.set) {
      setSets([r.set]);
      setState("done");
    } else setState("exhausted");
  };

  const next = async () => {
    if (index < sets.length - 1) return setIndex(index + 1);
    if (state === "exhausted") return;
    const id = ++seq.current;
    setBusy(true);
    const r = await ask({ type: "next", seq: id });
    setBusy(false);
    if (id !== seq.current) return;
    if (r.set) {
      setSets((s) => [...s, r.set!]);
      setIndex(sets.length);
    } else setState("exhausted");
  };

  const current = sets[index];
  const atEnd = state === "exhausted" && index === sets.length - 1;

  const accept = async () => {
    if (!current || !periodId) return;
    try {
      await addOptimiserSet(hid, periodId, uid, current.ids, mealType, servings);
      notify({ kind: "success", message: `Added ${current.ids.length} ${current.ids.length === 1 ? MEAL_LABEL[mealType].toLowerCase() : PLURAL[mealType]} to the plan` });
      reset();
    } catch (e) {
      notify({ kind: "error", message: `Couldn't add the set: ${(e as Error).message}` });
    }
  };

  const relax = (what: "budget" | "caps" | "protein") => {
    if (what === "budget") setMax(maxDollars + 10);
    if (what === "caps") setCaps((caps ?? defaultCap(n)) + 1);
    if (what === "protein") setProteinOnly(false);
    reset();
  };

  return (
    <section aria-labelledby="optimiser-h" data-testid="optimiser" className="flex flex-col gap-3 rounded-ui border-bw bg-base p-3.5 shadow-hard">
      <div className="flex flex-col gap-[0.1875rem]">
        <h2 id="optimiser-h" className="m-0 font-display text-[1.1875rem] font-normal">
          Budget optimiser
        </h2>
        <span className="text-[0.78125rem] leading-snug font-semibold text-sub">A full set that shares ingredients but varies cuisine and protein.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-extrabold">
        <Stepper value={n} onChange={(v) => {
            setN(v);
            reset();
          }} min={1} max={7} label="How many meals" decLabel="Fewer meals" incLabel="More meals" />
        <label className="sr-only" htmlFor="opt-type">
          Meal type
        </label>
        <select
          id="opt-type"
          value={mealType}
          onChange={(e) => {
            setMealType(e.target.value as MealType);
            reset();
          }}
          className="h-11 cursor-pointer rounded-ui border-2 border-line bg-base px-3 text-[0.875rem] font-extrabold text-ink shadow-hard-sm"
        >
          {MEAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {n === 1 ? MEAL_LABEL[t] : PLURAL[t].charAt(0).toUpperCase() + PLURAL[t].slice(1)}
            </option>
          ))}
        </select>
        <span>under</span>
        <Stepper value={maxDollars} onChange={(v) => {
            setMax(v);
            reset();
          }} min={10} max={1000} step={5} format={(v) => `$${v}`} label="Budget for the set" decLabel="Lower the budget" incLabel="Raise the budget" />
      </div>
      {nutrition.on ? (
        <label className={cn("flex cursor-pointer items-center gap-2.5 text-[0.8125rem] font-bold", !anyGoal && "opacity-60")}>
          <input type="checkbox" checked={proteinOnly} onChange={(e) => {
              setProteinOnly(e.target.checked);
              reset();
            }} className="size-[1.375rem] accent-[var(--ink)]" disabled={!anyGoal} />
          {anyGoal ? `Only recipes that meet the ${goalText}` : "Only recipes that meet the protein goal (no goal set)"}
        </label>
      ) : null}

      {state === "idle" || state === "searching" ? (
        <Button onClick={() => void find()} disabled={!snapshot || state === "searching"} className="w-full">
          {state === "searching" ? "Finding sets…" : snapshot ? "Find sets" : "Loading…"}
        </Button>
      ) : null}

      {state === "exhausted" && !sets.length ? (
        <div role="status" className="rounded-ui border-2 border-dashed border-line p-3.5 text-center text-[0.8125rem] leading-snug font-bold">
          No set fits. Raise the budget or ask for fewer meals.
          <Relax onRelax={relax} proteinOnly={proteinOnly} />
        </div>
      ) : null}

      {current ? (
        <>
          <div className="flex flex-col overflow-hidden rounded-ui border-2 border-line" data-testid="optimiser-set">
            <div className="flex justify-between gap-2 bg-ink px-2.5 py-2 font-mono text-[0.625rem] font-bold tracking-[0.03rem] text-base">
              <span>
                SET {index + 1}
                {atEnd ? ` OF ${sets.length}` : ""}
              </span>
              <span>{formatCents(current.costCents)} TO BUY</span>
            </div>
            <ul className="m-0 list-none p-0" aria-label="Recipes in this set">
              {current.ids.map((id, i) => {
                const r = summaries.get(id);
                const c = current.costs[id];
                return (
                  <li key={id} className={cn("bg-base", i && "border-t-2 border-line")}>
                    <Link to="/recipes/$id" params={{ id }} className="flex items-center gap-2.5 px-2.5 py-2 text-ink no-underline">
                      <RecipeThumb base={r?.thumb} cuisine={r?.cuisine} className="min-h-10" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[0.875rem] font-extrabold">{r?.title ?? "Recipe"}</span>
                      {r ? (
                        <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                          {taxonomyLabel(r.cuisine)} · {taxonomyLabel(r.mainProtein)} · {formatProtein(r.proteinPerServingG, r.proteinApproximate)}
                          {c !== null && c !== undefined ? ` · +${formatCents(c)}` : ""}
                        </span>
                      ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="border-t-2 border-line bg-mantle px-2.5 py-[0.4375rem] font-mono text-[0.625rem] leading-snug font-bold uppercase">
              {current.shared.length ? `Shares ${current.shared.map((x) => x.replace(/-/g, " ")).join(", ")}` : "No shared ingredients"}
            </div>
          </div>
          {atEnd ? (
            <div role="status" className="rounded-ui border-2 border-dashed border-line p-3 text-center text-[0.8125rem] font-bold">
              No more good combinations.
              <Relax onRelax={relax} proteinOnly={proteinOnly} />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} className="shadow-hard-sm">
              ← Back
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void next()} disabled={busy || atEnd} className="shadow-hard-sm">
              {busy ? "…" : "Next →"}
            </Button>
            <Button size="sm" onClick={() => void accept()} className="flex-1">
              Accept · add {current.ids.length}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Relax({ onRelax, proteinOnly }: { onRelax: (what: "budget" | "caps" | "protein") => void; proteinOnly: boolean }) {
  return (
    <span className="mt-2 flex flex-wrap justify-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => onRelax("budget")} className="shadow-hard-sm">
        +$10 budget
      </Button>
      <Button variant="secondary" size="sm" onClick={() => onRelax("caps")} className="shadow-hard-sm">
        Allow repeats
      </Button>
      {proteinOnly ? (
        <Button variant="secondary" size="sm" onClick={() => onRelax("protein")} className="shadow-hard-sm">
          Any protein
        </Button>
      ) : null}
    </span>
  );
}
