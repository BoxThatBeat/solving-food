// <MiseEnPlace> and <StepMode> (PRD R4.10–R4.12, R4.23, R4.24; TECHNICAL_SPECS §12 "Cooking layouts", "Cooking
// timers"; prototype phases "mise" and "steps"). Step mode shows one step in large text (clamp(1.5rem, 3vw, 4rem)),
// its ingredients with inline amounts, and its timer; swipe, tap the screen edges, or use the arrow keys to move.
// The layout follows the container: phone portrait (one column), phone landscape (step | ingredients and timers),
// tablet portrait (step, next step, all ingredients), and landscape tablet/desktop (ingredient checklist | step |
// timers and next step).
import * as React from "react";
import { ArrowLeft, Check, ChevronDown, NotebookPen } from "lucide-react";
import {
  ingredientSpeech,
  formatClock,
  formatDuration,
  lineText,
  newTimer,
  remainingMs,
  renderStep,
  STEP_NOTE_MAX,
  type CookNote,
  type CookTimer,
  type IngredientLookup,
  type RecipeIngredient,
  toolLabel,
} from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/chip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { StoredRecipe } from "@/data/recipes";
import type { useCookTimers } from "./useCookTimers";
import { layoutFor, prepList, timerId } from "./helpers";
import { useVoiceScript } from "@/voice/handsFree";
import { LastTimeNotes } from "./LastTimeNotes";

/** A swap offered on mise en place (M28, R4.40): what it says and whether it was accepted. */
export interface MiseSwap {
  ingredientId: string;
  /** "Garlic: use 0.8 g garlic powder from Supply". */
  text: string;
  note?: string | undefined;
  accepted: boolean;
}

/** The last cook's notes for mise en place (M28, R4.38). */
export interface MiseNotes {
  notes: readonly CookNote[];
  names: ReadonlyMap<string, string>;
  tz: string;
}

type Timers = ReturnType<typeof useCookTimers>;

export function MiseEnPlace({
  recipe,
  recipeId,
  lookup,
  factor,
  missingTools,
  onStart,
  notes,
  swaps = [],
  onSwap,
  back,
}: {
  recipe: StoredRecipe;
  recipeId: string;
  lookup: IngredientLookup;
  factor: number;
  missingTools: string[];
  onStart: () => void;
  notes?: MiseNotes | undefined;
  swaps?: readonly MiseSwap[];
  onSwap?: (ingredientId: string, accept: boolean) => void;
  /** M29 (R4.41): the Back button: to the recipe page (one recipe) or the meal's list of recipes. */
  back?: { label: string; onClick: () => void } | undefined;
}) {
  const items = prepList(recipe, lookup, factor);
  const [done, setDone] = React.useState<Set<number>>(new Set());
  // Hands-free (R4.33): mise en place reads its prep list; "next" starts step mode.
  const prep = items.map((it) => `${it.speech}.`);
  useVoiceScript({
    id: `mise:${recipeId}`,
    intro: prep,
    ingredients: recipe.ingredients.map((l) => {
      const t = lineText(l, lookup, factor);
      return `${ingredientSpeech(t.amount, t.name)}.`;
    }),
    steps: prep,
    next: onStart,
  });
  return (
    <div className="mx-auto flex w-full max-w-[60rem] flex-1 flex-col gap-3 px-4 pt-4 pb-4">
      {back ? (
        <button
          type="button"
          onClick={back.onClick}
          aria-label={back.label}
          className="flex min-h-11 cursor-pointer items-center gap-1 self-start rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold text-ink shadow-[3px_3px_0_var(--line)]"
          data-testid="mise-back"
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
          Back
        </button>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="kicker" data-testid="mise-count">
          {done.size} OF {items.length} READY
        </span>
        <h1 className="m-0 font-display text-[2rem] leading-[0.95] font-extrabold md:text-[2.5rem]">Mise en place</h1>
        <span className="text-[0.9375rem] font-bold">{recipe.title}</span>
      </div>
      {recipe.tools.length ? (
        <div className={cn("rounded-ui border-2 border-dashed border-line px-3 py-2 tabular-nums text-[0.6875rem] font-bold", missingTools.length && "border-solid bg-red-soft text-onc")}>
          Get out · <span>{recipe.tools.map(toolLabel).join(" · ")}</span>
          {missingTools.length ? (
            <>
              {" "}
              · not in your kitchen: <span>{missingTools.map(toolLabel).join(", ")}</span>
            </>
          ) : null}
        </div>
      ) : null}
      {notes?.notes.length ? <LastTimeNotes notes={notes.notes} names={notes.names} tz={notes.tz} /> : null}
      {swaps.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Swaps from Supply">
          {swaps.map((sw) => (
            <li key={sw.ingredientId} className={cn("flex items-center gap-3 rounded-ui border-2 border-line px-3 py-2", sw.accepted ? "bg-[color-mix(in_srgb,var(--acc)_35%,var(--base))]" : "bg-base")} data-testid="swap">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="tabular-nums text-[0.5625rem] font-bold tracking-[0.045rem]">{sw.accepted ? "Swapped · Done cooking takes this from Supply" : "Not in Supply · swap"}</span>
                <span className="text-[0.9375rem] leading-snug font-bold first-letter:uppercase">{sw.text}</span>
                {sw.note ? <span className="text-[0.8125rem] font-semibold text-sub first-letter:uppercase">{sw.note}</span> : null}
              </span>
              {onSwap ? (
                sw.accepted ? (
                  <Button size="sm" variant="secondary" className="flex-none" onClick={() => onSwap(sw.ingredientId, false)}>
                    Undo
                  </Button>
                ) : (
                  <Button size="sm" className="flex-none" onClick={() => onSwap(sw.ingredientId, true)}>
                    Use it
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
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
                  {/* M29 (R4.42): every ingredient the task names with its amount inline, as in step mode (R4.11). */}
                  <span className={cn("text-[0.9375rem] font-bold first-letter:uppercase", on && "line-through decoration-2")} data-testid="prep-task">
                    {it.segments.map((seg, k) =>
                      seg.kind === "text" ? (
                        <React.Fragment key={k}>{seg.text}</React.Fragment>
                      ) : (
                        <React.Fragment key={k}>
                          {seg.name}
                          {seg.amount ? <span className="mx-1 inline-block rounded-[calc(var(--r)*0.5)] border-2 border-line bg-acc px-1 align-middle tabular-nums text-[0.75rem] leading-[1.4] font-extrabold whitespace-nowrap text-onc" data-testid="prep-amount">{seg.amount}</span> : null}
                        </React.Fragment>
                      ),
                    )}
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
  stepNotes,
  onNote,
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
  /** M28 (R4.39): the notes on this recipe's steps (carried from the last cook, with this cook's edits), by step. */
  stepNotes?: ReadonlyMap<number, string> | undefined;
  /** Save (or, with "", clear) a step's note; it goes with Done cooking. */
  onNote?: ((step: number, text: string) => void) | undefined;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const layout = layoutFor(size.w, size.h);
  const n = recipe.steps.length;
  const i = Math.min(step, Math.max(0, n - 1));
  const s = recipe.steps[i];
  const next = recipe.steps[i + 1];
  const go = React.useCallback((d: number) => onStep(Math.min(Math.max(0, i + d), Math.max(0, n - 1))), [i, n, onStep]);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [noting, setNoting] = React.useState(false);
  const stepNote = stepNotes?.get(i);

  // Hands-free (R4.33): entering a step reads its ingredients, then its instructions (names only: the amounts were
  // just read); "next" / "previous" move like the buttons, but never past the last step (finishing stays a tap).
  const voiceLines = s ? s.ingredientRefs.map((id) => recipe.ingredients.find((l) => l.id === id)).filter((l): l is RecipeIngredient => !!l) : [];
  const voiceIngredients = voiceLines.length
    ? [`For step ${i + 1}:`, ...voiceLines.map((l) => { const t = lineText(l, lookup, factor); return `${ingredientSpeech(t.amount, t.name)}.`; })]
    : [];
  const voiceSteps = s ? [`Step ${i + 1}.`, renderStep(s.text, recipe.ingredients, lookup, factor).map((seg) => (seg.kind === "text" ? seg.text : seg.name)).join("")] : [];
  useVoiceScript(
    s
      ? {
          id: `step:${recipeId}:${i}`,
          intro: [...voiceIngredients, ...voiceSteps],
          ingredients: voiceIngredients.length ? voiceIngredients : [`No ingredients in step ${i + 1}.`],
          steps: voiceSteps,
          next: () => i < n - 1 && go(1),
          previous: () => i > 0 && go(-1),
        }
      : null,
  );

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
    <section aria-label={`Step ${i + 1} of ${n}`} className="flex min-h-0 flex-1 flex-col gap-4 rounded-ui border-bw bg-base p-[clamp(1rem,2.5vw,2.25rem)] shadow-hard" data-testid="step-card">
      <div className="flex flex-none items-center justify-between gap-2">
        <span className="rounded-ui border-2 border-line bg-acc px-2.5 py-1 font-extrabold text-[0.8125rem] text-onc">
          Step {i + 1} of {n}
          {s.section ? ` · ${s.section}` : ""}
        </span>
        {/* M28 (R4.39): a note on this step for next time. */}
        {onNote ? (
          <Button size="sm" variant="chip" onClick={() => setNoting(true)} aria-label={stepNote ? `Edit the note on step ${i + 1}` : `Add a note to step ${i + 1}`} className="relative z-20">
            <NotebookPen aria-hidden />
            {stepNote ? "Edit note" : "Note"}
          </Button>
        ) : null}
      </div>
      {/* M9 (owner review): a long step scrolls inside the card; the controls below never move under it. */}
      {/* M10 (owner review 3): an arrow at the bottom while there's more text below (StepScroll). */}
      <StepScroll resetKey={i}>
      <p className="step-text m-0 font-extrabold text-pretty" data-testid="step-text">
        {renderStep(s.text, recipe.ingredients, lookup, factor).map((seg, k) =>
          seg.kind === "text" ? (
            <React.Fragment key={k}>{seg.text}</React.Fragment>
          ) : (
            <React.Fragment key={k}>
              {seg.name}
              {seg.amount ? <span className="mx-1 inline-block rounded-ui border-2 border-line bg-acc px-1.5 align-middle tabular-nums text-[0.55em] leading-[1.5] font-extrabold whitespace-nowrap text-onc">{seg.amount}</span> : null}
            </React.Fragment>
          ),
        )}
      </p>
      {stepNote ? (
        <p className="mt-3 mb-0 rounded-ui border-2 border-dashed border-line bg-mantle px-3 py-2 text-[clamp(0.9375rem,1.6vw,1.375rem)] leading-snug font-bold" data-testid="step-note">
          <span className="tabular-nums text-[0.625rem] font-bold tracking-[0.045rem]">Note · </span>
          {stepNote}
        </p>
      ) : null}
      </StepScroll>
      {layout !== "wide" && layout !== "phone-landscape" ? <StepIngredients lines={lines} lookup={lookup} factor={factor} big={layout === "tablet-portrait"} /> : null}
      {layout === "phone" || layout === "tablet-portrait" ? (
        <div className="flex flex-none flex-col gap-3">
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
      {/* M24: the one live region of step mode: the step number when it changes (the card itself isn't live, so the
          ticking timers inside it aren't announced every second). */}
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="step-announce">
        Step {i + 1} of {n}
        {s.section ? `, ${s.section}` : ""}
      </p>
      {/* Tap the screen edges to move (R4.10); invisible but labelled for assistive tech. */}
      <button type="button" aria-label="Previous step" onClick={() => go(-1)} disabled={i === 0} className="absolute inset-y-0 left-0 z-10 w-[6%] min-w-6 cursor-w-resize bg-transparent opacity-0 disabled:hidden" tabIndex={-1} data-hit-exempt="full-height edge strip; Back and Next are the 44 px controls" />
      <button type="button" aria-label="Next step" onClick={() => go(1)} disabled={i >= n - 1} className="absolute inset-y-0 right-0 z-10 w-[6%] min-w-6 cursor-e-resize bg-transparent opacity-0 disabled:hidden" tabIndex={-1} data-hit-exempt="full-height edge strip; Back and Next are the 44 px controls" />
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
      {onNote ? <StepNoteSheet open={noting} onOpenChange={setNoting} step={i} text={stepNote ?? ""} onSave={(t) => onNote(i, t)} /> : null}
    </div>
  );
}

/** The step note sheet (M28, R4.39): one short text field; Save, or Remove an existing note. */
function StepNoteSheet({ open, onOpenChange, step, text, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; step: number; text: string; onSave: (t: string) => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}>{open ? <StepNoteBody step={step} text={text} onSave={(t) => (onSave(t.trim()), onOpenChange(false))} /> : null}</Sheet>;
}

/** Mounted each time the sheet opens, so the draft starts from the saved note. */
function StepNoteBody({ step, text, onSave }: { step: number; text: string; onSave: (t: string) => void }) {
  const [draft, setDraft] = React.useState(text);
  return (
    <SheetContent
      title={`Note on step ${step + 1}`}
      footer={
        <div className="flex gap-2.5">
          {text ? (
            <Button variant="secondary" className="flex-none" onClick={() => onSave("")}>
              Remove
            </Button>
          ) : null}
          <Button className="flex-1" onClick={() => onSave(draft)} disabled={!draft.trim() && !text}>
            Save note
          </Button>
        </div>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="tabular-nums text-[0.625rem] font-bold tracking-[0.045rem]">SHOWN UNDER THIS STEP NEXT TIME</span>
        <Textarea rows={3} maxLength={STEP_NOTE_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Pan hotter than you think." autoFocus aria-label={`Note on step ${step + 1}`} />
      </label>
      <p className="m-0 text-[0.8125rem] font-semibold text-sub">Saved with Done cooking, for everyone in the household.</p>
    </SheetContent>
  );
}

function StepIngredients({ lines, lookup, factor, big, boxed }: { lines: RecipeIngredient[]; lookup: IngredientLookup; factor: number; big?: boolean; boxed?: boolean }) {
  if (!lines.length) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", boxed ? "rounded-ui border-bw bg-base p-3 shadow-hard" : "max-h-[35%] flex-none overflow-y-auto border-t-2 border-dashed border-line pt-3")} data-testid="step-ingredients" {...(boxed ? {} : { tabIndex: 0, role: "group", "aria-label": "This step's ingredients" })}>
      <span className="tabular-nums text-[0.625rem] font-bold tracking-[0.045rem]">FOR THIS STEP</span>
      {lines.map((l) => {
        const t = lineText(l, lookup, factor);
        return (
          <div key={l.id} className={cn("flex items-baseline justify-between gap-3 font-bold", big ? "text-[1.375rem]" : "text-[1rem]")}>
            <span className="first-letter:uppercase">{t.name}</span>
            <span className="text-right tabular-nums font-extrabold">{t.amount}</span>
          </div>
        );
      })}
    </div>
  );
}

function IngredientChecklist({ recipe, lookup, factor, current, checked, setChecked, compact }: { recipe: StoredRecipe; lookup: IngredientLookup; factor: number; current: string[]; checked: Set<string>; setChecked: (s: Set<string>) => void; compact?: boolean }) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-ui border-bw bg-base shadow-hard" aria-label="Ingredients">
      <div className="bg-ink px-3 py-1.5 tabular-nums text-[0.625rem] font-bold tracking-[0.03rem] text-base">INGREDIENTS</div>
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
                <span className="tabular-nums text-[0.6875rem] font-bold">{t.amount}</span>
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
      <span className="tabular-nums text-[0.625rem] font-bold tracking-[0.045rem]">NEXT</span>
      <p className="m-0 text-[1rem] leading-snug font-semibold text-sub">{renderStep(text, recipe.ingredients, lookup, factor).map((s) => (s.kind === "text" ? s.text : s.name)).join("")}</p>
    </div>
  );
}

/** The step's timer: start, pause, ±1 min, cancel. Counts down on wall-clock time. */
function TimerBox({ timers, recipeId, step, seconds }: { timers: Timers; recipeId: string; step: number; seconds: number }) {
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
        <span className="tabular-nums text-[clamp(2rem,4vw,3.5rem)] leading-none font-extrabold tabular-nums" role="timer" aria-label={`${formatClock(left)} left`}>
          {formatClock(left)}
        </span>
      </div>
      {/* Above the edge strips (z-10), like the Note button: in the wide and phone-landscape layouts the timers sit at
          the right edge, under the invisible Next step strip, which otherwise takes the tap and moves the step. */}
      <div className="relative z-20 flex flex-wrap gap-2">
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

/** Timers from other steps that are still going (or finished and not yet dismissed), so a propped-up tablet shows them all. */
function OtherTimers({ timers, except }: { timers: Timers; except: string }) {
  const list = timers.timers.filter((t) => t.id !== except && t.state !== "paused");
  if (!list.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Other timers">
      {list.map((t) => (
        <li key={t.id} className={cn("flex items-center justify-between gap-2 rounded-ui border-2 border-line px-2.5 py-1.5", t.state === "done" ? "bg-red-soft text-onc" : "bg-base")}>
          <span className="text-[0.8125rem] font-bold">{t.label}</span>
          <span className="tabular-nums text-[1.125rem] font-extrabold tabular-nums">{t.state === "done" ? "DONE" : formatClock(remainingMs(t, timers.now))}</span>
          {t.state === "done" ? (
            <Button size="sm" variant="chip" onClick={() => timers.dismiss(t.id)} className="relative z-20" aria-label={`Dismiss ${t.label}`}>
              Dismiss
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The step text's own scroll area (M9, R4.10) with a "more below" arrow (M10): a chevron on a fade pinned to the bottom
 * edge while the text overflows and isn't scrolled to the end. The arrow is decoration (the region itself is focusable
 * and labelled, and scrolls by touch, wheel and keys); tapping it scrolls most of a screenful.
 */
function StepScroll({ resetKey, children }: { resetKey: unknown; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [more, setMore] = React.useState(false);
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 4);
  }, []);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [resetKey, measure]);
  return (
    <div className="relative flex min-h-[4.5rem] flex-1 flex-col">
      <div ref={ref} onScroll={measure} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="step-scroll" data-more={more ? "true" : "false"} tabIndex={0} aria-label="Step text">
        {children}
      </div>
      {more ? (
        // M24: the arrow is a real button (it was a clickable span); the fade behind it stays decorative.
        <div data-testid="step-more" className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center">
          <div aria-hidden className="absolute inset-0 bg-linear-to-t from-base from-35% to-transparent" />
          <button
            type="button"
            aria-label="Scroll down for more of this step"
            onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.8, behavior: "smooth" })}
            className="pointer-events-auto relative grid size-11 cursor-pointer place-items-center rounded-full border-2 border-line bg-ink text-base shadow-hard-sm"
          >
            <ChevronDown aria-hidden className="size-6" strokeWidth={3} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
