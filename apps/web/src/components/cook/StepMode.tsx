// <MiseEnPlace> and <StepMode> (PRD R4.10–R4.12, R4.23, R4.24; TECHNICAL_SPECS §12 "Cooking layouts", "Cooking
// timers"; prototype phases "mise" and "steps"). Step mode shows one step in large text (clamp(1.5rem, 3vw, 4rem)),
// its ingredients with inline amounts, and its timer; swipe, tap the screen edges, or use the arrow keys to move.
// The layout follows the container: phone portrait (one column), phone landscape (step | ingredients and timers),
// tablet portrait (step, next step, all ingredients), and landscape tablet/desktop (ingredient checklist | step |
// timers and next step).
import * as React from "react";
import { Check } from "lucide-react";
import {
  formatClock,
  formatDuration,
  lineText,
  newTimer,
  remainingMs,
  renderStep,
  type CookTimer,
  type IngredientLookup,
  type RecipeIngredient,
} from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StoredRecipe } from "@/data/recipes";
import type { useCookTimers } from "./useCookTimers";
import { layoutFor, prepList, timerId } from "./helpers";

type Timers = ReturnType<typeof useCookTimers>;

export function MiseEnPlace({ recipe, lookup, factor, missingTools, onStart }: { recipe: StoredRecipe; lookup: IngredientLookup; factor: number; missingTools: string[]; onStart: () => void }) {
  const items = prepList(recipe, lookup, factor);
  const [done, setDone] = React.useState<Set<number>>(new Set());
  return (
    <div className="mx-auto flex w-full max-w-[60rem] flex-1 flex-col gap-3 px-4 pt-4 pb-4">
      <div className="flex flex-col gap-1">
        <span className="kicker" data-testid="mise-count">
          {done.size} OF {items.length} READY
        </span>
        <h1 className="m-0 font-display text-[2rem] leading-[0.95] font-normal md:text-[2.5rem]">Mise en place</h1>
        <span className="text-[0.9375rem] font-bold">{recipe.title}</span>
      </div>
      {recipe.tools.length ? (
        <div className={cn("rounded-ui border-2 border-dashed border-line px-3 py-2 font-mono text-[0.6875rem] font-bold uppercase", missingTools.length && "border-solid bg-red-soft text-onc")}>
          Get out · {recipe.tools.join(" · ")}
          {missingTools.length ? ` · not in your kitchen: ${missingTools.join(", ")}` : ""}
        </div>
      ) : null}
      {items.length ? (
        <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0 shadow-hard" aria-label="Prep tasks">
          {items.map((it, i) => {
            const on = done.has(i);
            return (
              <li key={i} className={cn(i && "border-t-2 border-line")}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setDone((d) => (d.has(i) ? new Set([...d].filter((x) => x !== i)) : new Set([...d, i])))}
                  className={cn("flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left text-ink", on ? "bg-mantle" : "bg-base")}
                >
                  <span className={cn("grid size-7 flex-none place-items-center rounded-[calc(var(--r)*0.67)] border-2 border-line", on ? "bg-acc text-onc" : "bg-base")}>{on ? <Check aria-hidden className="size-4" strokeWidth={4} /> : null}</span>
                  <span className={cn("text-[0.9375rem] font-bold first-letter:uppercase", on && "line-through decoration-2")}>
                    {it.text}{" "}
                    {it.amount ? <span className="ml-1 rounded-[calc(var(--r)*0.5)] border-2 border-line bg-acc px-1 font-mono text-[0.75rem] font-extrabold whitespace-nowrap text-onc">{it.amount}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-sm font-semibold">Nothing to prep for this one.</p>
      )}
      <div className="mt-auto pt-2">
        <Button size="lg" className="w-full" onClick={onStart}>
          Start step mode →
        </Button>
      </div>
    </div>
  );
}

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState({ w: typeof window === "undefined" ? 400 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function StepMode({
  recipe,
  recipeId,
  lookup,
  factor,
  step,
  onStep,
  onFinish,
  timers,
  isLastRecipe,
}: {
  recipe: StoredRecipe;
  recipeId: string;
  lookup: IngredientLookup;
  factor: number;
  step: number;
  onStep: (i: number) => void;
  /** After the last step: this recipe is done. */
  onFinish: () => void;
  timers: Timers;
  isLastRecipe: boolean;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const layout = layoutFor(size.w, size.h);
  const n = recipe.steps.length;
  const i = Math.min(step, Math.max(0, n - 1));
  const s = recipe.steps[i];
  const next = recipe.steps[i + 1];
  const go = React.useCallback((d: number) => onStep(Math.min(Math.max(0, i + d), Math.max(0, n - 1))), [i, n, onStep]);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go]);

  // Swipe: a mostly horizontal drag of 50 px or more.
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const st = start.current;
    start.current = null;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  if (!s) return <div className="p-6 text-sm font-bold">This recipe has no steps.</div>;
  const lines = s.ingredientRefs.map((id) => recipe.ingredients.find((l) => l.id === id)).filter((l): l is RecipeIngredient => !!l);

  const stepCard = (
    <section aria-label={`Step ${i + 1} of ${n}`} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-4 rounded-ui border-bw bg-base p-[clamp(1rem,2.5vw,2.25rem)] shadow-hard" data-testid="step-card">
      <span className="self-start rounded-ui border-2 border-line bg-acc px-2.5 py-1 font-display text-[0.8125rem] text-onc uppercase">
        Step {i + 1} of {n}
        {s.section ? ` · ${s.section}` : ""}
      </span>
      <p className="step-text m-0 font-extrabold text-pretty" data-testid="step-text">
        {renderStep(s.text, recipe.ingredients, lookup, factor).map((seg, k) =>
          seg.kind === "text" ? (
            <React.Fragment key={k}>{seg.text}</React.Fragment>
          ) : (
            <React.Fragment key={k}>
              {seg.name}
              {seg.amount ? <span className="mx-1 inline-block rounded-ui border-2 border-line bg-acc px-1.5 align-middle font-mono text-[0.55em] leading-[1.5] font-extrabold whitespace-nowrap text-onc">{seg.amount}</span> : null}
            </React.Fragment>
          ),
        )}
      </p>
      {layout !== "wide" && layout !== "phone-landscape" ? <StepIngredients lines={lines} lookup={lookup} factor={factor} big={layout === "tablet-portrait"} /> : null}
      {layout === "phone" || layout === "tablet-portrait" ? (
        <div className="mt-auto flex flex-col gap-3">
          {s.timerSeconds ? <TimerBox timers={timers} recipeId={recipeId} step={i} seconds={s.timerSeconds} /> : null}
          <OtherTimers timers={timers} except={timerId(recipeId, i)} />
        </div>
      ) : null}
    </section>
  );

  const nav = (
    <div className="flex flex-none gap-3">
      <Button variant="secondary" size="lg" disabled={i === 0} onClick={() => go(-1)} className="flex-none">
        ← Back
      </Button>
      {i < n - 1 ? (
        <Button size="lg" className="flex-1" onClick={() => go(1)}>
          Next step →
        </Button>
      ) : (
        <Button size="lg" className="flex-1" onClick={onFinish}>
          {isLastRecipe ? "Done cooking ✓" : "Recipe done ✓"}
        </Button>
      )}
    </div>
  );

  const progress = (
    <div className="flex flex-none gap-1.5" aria-hidden>
      {recipe.steps.map((_, k) => (
        <span key={k} className={cn("h-2.5 flex-1 rounded-sm border-2 border-line", k <= i ? "bg-acc" : "bg-base")} />
      ))}
    </div>
  );

  return (
    <div ref={ref} className="relative flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4 md:px-8" onPointerDown={onPointerDown} onPointerUp={onPointerUp} data-layout={layout} data-testid="step-mode">
      {/* Tap the screen edges to move (R4.10); invisible but labelled for assistive tech. */}
      <button type="button" aria-label="Previous step" onClick={() => go(-1)} disabled={i === 0} className="absolute inset-y-0 left-0 z-10 w-[6%] min-w-6 cursor-w-resize bg-transparent opacity-0 disabled:hidden" tabIndex={-1} />
      <button type="button" aria-label="Next step" onClick={() => go(1)} disabled={i >= n - 1} className="absolute inset-y-0 right-0 z-10 w-[6%] min-w-6 cursor-e-resize bg-transparent opacity-0 disabled:hidden" tabIndex={-1} />
      <div className={cn("mx-auto flex w-full min-h-0 flex-1 flex-col gap-3", layout === "wide" ? "max-w-[120rem]" : "max-w-[70rem]")}>
        {progress}
        {layout === "wide" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(14rem,1fr)_minmax(0,2.4fr)_minmax(14rem,1fr)] gap-4">
            <IngredientChecklist recipe={recipe} lookup={lookup} factor={factor} current={s.ingredientRefs} checked={checked} setChecked={setChecked} />
            {stepCard}
            <aside className="flex min-h-0 flex-col gap-3" aria-label="Timers and next step">
              {s.timerSeconds ? <TimerBox timers={timers} recipeId={recipeId} step={i} seconds={s.timerSeconds} /> : null}
              <OtherTimers timers={timers} except={timerId(recipeId, i)} />
              {next ? <NextStep text={next.text} recipe={recipe} lookup={lookup} factor={factor} /> : null}
            </aside>
          </div>
        ) : layout === "phone-landscape" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(12rem,1fr)] gap-3">
            {stepCard}
            <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto" aria-label="This step's ingredients and timers">
              <StepIngredients lines={lines} lookup={lookup} factor={factor} boxed />
              {s.timerSeconds ? <TimerBox timers={timers} recipeId={recipeId} step={i} seconds={s.timerSeconds} /> : null}
              <OtherTimers timers={timers} except={timerId(recipeId, i)} />
            </aside>
          </div>
        ) : (
          <>
            {stepCard}
            {layout === "tablet-portrait" ? (
              <div className="grid flex-none grid-cols-2 gap-3">
                {next ? <NextStep text={next.text} recipe={recipe} lookup={lookup} factor={factor} /> : <span />}
                <IngredientChecklist recipe={recipe} lookup={lookup} factor={factor} current={s.ingredientRefs} checked={checked} setChecked={setChecked} compact />
              </div>
            ) : null}
          </>
        )}
        {nav}
      </div>
    </div>
  );
}

function StepIngredients({ lines, lookup, factor, big, boxed }: { lines: RecipeIngredient[]; lookup: IngredientLookup; factor: number; big?: boolean; boxed?: boolean }) {
  if (!lines.length) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", boxed ? "rounded-ui border-bw bg-base p-3 shadow-hard" : "border-t-2 border-dashed border-line pt-3")} data-testid="step-ingredients">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">FOR THIS STEP</span>
      {lines.map((l) => {
        const t = lineText(l, lookup, factor);
        return (
          <div key={l.id} className={cn("flex items-baseline justify-between gap-3 font-bold", big ? "text-[1.375rem]" : "text-[1rem]")}>
            <span className="first-letter:uppercase">{t.name}</span>
            <span className="text-right font-mono font-extrabold">{t.amount}</span>
          </div>
        );
      })}
    </div>
  );
}

function IngredientChecklist({ recipe, lookup, factor, current, checked, setChecked, compact }: { recipe: StoredRecipe; lookup: IngredientLookup; factor: number; current: string[]; checked: Set<string>; setChecked: (s: Set<string>) => void; compact?: boolean }) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-ui border-bw bg-base shadow-hard" aria-label="Ingredients">
      <div className="bg-ink px-3 py-1.5 font-mono text-[0.625rem] font-bold tracking-[0.06rem] text-base">INGREDIENTS</div>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {recipe.ingredients.map((l, k) => {
          const t = lineText(l, lookup, factor);
          const on = checked.has(l.id);
          const here = current.includes(l.id);
          return (
            <li key={l.id} className={cn(k && "border-t-2 border-line")}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setChecked(new Set(on ? [...checked].filter((x) => x !== l.id) : [...checked, l.id]))}
                className={cn("flex w-full cursor-pointer items-center gap-2 px-3 text-left text-ink", compact ? "py-1.5" : "py-2.5", here ? "bg-[color-mix(in_srgb,var(--acc)_35%,var(--base))]" : on ? "bg-mantle" : "bg-base")}
              >
                <span className={cn("grid size-5 flex-none place-items-center rounded-[calc(var(--r)*0.5)] border-2 border-line", on ? "bg-acc text-onc" : "bg-base")}>{on ? <Check aria-hidden className="size-3" strokeWidth={4} /> : null}</span>
                <span className={cn("min-w-0 flex-1 text-[0.875rem] font-bold first-letter:uppercase", on && "line-through")}>{t.name}</span>
                <span className="font-mono text-[0.6875rem] font-bold">{t.amount}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function NextStep({ text, recipe, lookup, factor }: { text: string; recipe: StoredRecipe; lookup: IngredientLookup; factor: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-ui border-2 border-dashed border-line bg-base p-3" data-testid="next-step">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">NEXT</span>
      <p className="m-0 text-[1rem] leading-snug font-semibold text-sub">{renderStep(text, recipe.ingredients, lookup, factor).map((s) => (s.kind === "text" ? s.text : s.name)).join("")}</p>
    </div>
  );
}

/** The step's timer: start, pause, ±1 min, cancel. Counts down on wall-clock time. */
export function TimerBox({ timers, recipeId, step, seconds }: { timers: Timers; recipeId: string; step: number; seconds: number }) {
  const id = timerId(recipeId, step);
  const t = timers.get(id);
  const label = `Step ${step + 1}: ${formatDuration(seconds * 1000)}`;
  const template = (): CookTimer => newTimer(id, label, seconds * 1000, { stepIndex: step, recipeId });
  const left = t ? remainingMs(t, timers.now) : seconds * 1000;
  const state = t?.state ?? "idle";
  return (
    <div className={cn("flex flex-col gap-2 rounded-ui border-bw p-3", state === "done" ? "bg-red-soft text-onc" : state === "running" ? "bg-yellow text-onc" : "bg-base")} data-testid="timer" data-state={state}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.875rem] font-extrabold">{state === "idle" ? `Start ${formatDuration(seconds * 1000)} timer` : state === "done" ? "Time's up!" : state === "paused" ? "Paused" : "Running"}</span>
        <span className="font-mono text-[clamp(2rem,4vw,3.5rem)] leading-none font-extrabold tabular-nums" role="timer" aria-label={`${formatClock(left)} left`}>
          {formatClock(left)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {state === "running" ? (
          <Button size="sm" variant="secondary" onClick={() => timers.pause(id)}>
            Pause
          </Button>
        ) : state === "done" ? (
          <Button size="sm" variant="secondary" onClick={() => timers.dismiss(id)}>
            Dismiss
          </Button>
        ) : (
          <Button size="sm" onClick={() => timers.start(id, template)}>
            {state === "paused" ? "Resume" : "Start timer"}
          </Button>
        )}
        {state === "running" || state === "paused" ? (
          <>
            <Button size="sm" variant="chip" onClick={() => timers.adjust(id, 60_000)} aria-label="Add a minute">
              +1 min
            </Button>
            <Button size="sm" variant="chip" onClick={() => timers.adjust(id, -60_000)} aria-label="Take off a minute">
              −1 min
            </Button>
            <Button size="sm" variant="chip" onClick={() => timers.cancel(id)}>
              Cancel
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Timers from other steps that are still going, so a propped-up tablet shows them all. */
function OtherTimers({ timers, except }: { timers: Timers; except: string }) {
  const list = timers.timers.filter((t) => t.id !== except && t.state !== "paused");
  if (!list.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Other timers">
      {list.map((t) => (
        <li key={t.id} className={cn("flex items-center justify-between gap-2 rounded-ui border-2 border-line px-2.5 py-1.5", t.state === "done" ? "bg-red-soft text-onc" : "bg-base")}>
          <span className="text-[0.8125rem] font-bold">{t.label}</span>
          <span className="font-mono text-[1.125rem] font-extrabold tabular-nums">{t.state === "done" ? "DONE" : formatClock(remainingMs(t, timers.now))}</span>
          {t.state === "done" ? (
            <Button size="sm" variant="chip" onClick={() => timers.dismiss(t.id)}>
              OK
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
