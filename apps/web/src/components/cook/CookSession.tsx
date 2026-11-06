// <MealCookView> and the cooking session (PRD R5.6, R9.1, R9.3, R4.10–R4.12, R4.23; TECHNICAL_SPECS §12; prototype
// cook phases). A planned meal, a saved meal, or a single recipe: choose the order (recipes with their total time,
// ▲/▼), cook each through mise en place and step mode, check it off. Done cooking (or the last recipe checked off)
// sends `finishCooking`, which deducts the recipe defaults right away, and opens the review. One-recipe meals skip the
// ordering step. The screen stays awake while cooking (Screen Wake Lock).
// M9 (owner review): each phase is a browser history entry (`?mode=mise|steps`, pushed going forward), so the back
// button goes from step mode to mise en place, and from a meal's mise en place to its order list.
import { RecipeThumb } from "@/components/recipes/RecipeThumb";
import { thumbOf } from "@/components/recipes/helpers";
import * as React from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import {
  findSwaps,
  formatCanonical,
  formatMinutes,
  isBaking,
  latestStepNotes,
  mealRequirements,
  missingTools,
  recipeNotes,
  scaleFactor,
  stepNotesToSend,
  substitutionsOn,
  swapText,
  type MealSide,
  type MealType,
  type RecipeRef,
  type StepNote,
} from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useNotify } from "@/components/notifications-context";
import { lookupFromMap, useIngredientsById } from "@/data/ingredients";
import { useRecipeDocs } from "@/data/plan";
import { usePlanModel } from "@/data/planModel";
import { useCookNotes } from "@/data/cookNotes";
import { useMemberNames } from "@/data/households";
import { newId, sendCommand } from "@/data/supply";
import type { StoredRecipe } from "@/data/recipes";
import { useOnline } from "@/hooks/useOnline";
import { useInstallPrompt, isStandalone } from "@/pwa/install";
import { setUpdateDeferred } from "@/pwa/update";
import { isIos } from "@/pwa/push";
import { cn } from "@/lib/utils";
import { HandsFreeToggle } from "@/voice/HandsFreeToggle";
import { MiseEnPlace, StepMode, type MiseSwap } from "./StepMode";
import { useWakeLock } from "./helpers";
import { useCookTimers } from "./useCookTimers";

export interface CookTarget {
  /** Stable key for this session (timers, progress survive a reload). */
  key: string;
  title: string;
  kicker: string;
  recipes: RecipeRef[];
  servings: number;
  planItemId?: string | undefined;
  savedMealId?: string | undefined;
  mealType?: MealType | undefined;
  /** The meal's sides (R5.10): Done cooking deducts their portions too. */
  sides?: MealSide[] | undefined;
  /** Where ✕ goes. */
  exitTo: string;
  /** Base path of this cook view, for timer notification links. */
  path: string;
}

type Phase = { kind: "order" } | { kind: "mise"; recipe: number } | { kind: "steps"; recipe: number; step: number };
type Mode = "mise" | "steps" | undefined;

/** The history entry a phase lives in: the first phase (order, or a single recipe's mise en place) has no mode. */
function modeOf(p: Phase, single: boolean): Mode {
  return p.kind === "steps" ? "steps" : p.kind === "mise" && !single ? "mise" : undefined;
}
/** How deep a mode is in the cook session's own history entries. */
function depthOf(m: Mode, single: boolean): number {
  return m === "steps" ? (single ? 1 : 2) : m === "mise" ? 1 : 0;
}

const PROGRESS = (k: string) => `sf.cook.${k}`;

interface Progress {
  phase: Phase;
  order: string[];
  done: string[];
  /** M28 (R4.39): this cook's step note edits, by recipe and step ("" = cleared). */
  notes?: Record<string, Record<string, string>>;
  /** M28 (R4.40): ingredients whose swap was accepted on mise en place. */
  swaps?: string[];
}

function loadProgress(key: string): Progress | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function CookSession({ target, hid, uid, tools, initialStep }: { target: CookTarget; hid: string; uid: string; tools: readonly string[]; initialStep?: { recipeId?: string | undefined; step: number } | undefined }) {
  const navigate = useNavigate();
  const router = useRouter();
  const notify = useNotify();
  const online = useOnline();
  const recipeMap = useRecipeDocs(target.recipes.map((r) => r.recipeId));
  const ingredientIds = React.useMemo(() => [...new Set([...[...recipeMap.values()].flatMap((r) => r.ingredientIds), ...(target.sides ?? []).map((x) => x.ingredientId)])], [recipeMap, target.sides]);
  const recipeIngredients = useIngredientsById(ingredientIds);
  const saved = loadProgress(target.key);
  const plan = usePlanModel();
  const tz = plan.household?.timezone ?? "America/Toronto";
  const names = useMemberNames(hid);
  const recipeIds = React.useMemo(() => target.recipes.map((r) => r.recipeId), [target.recipes]);
  const noted = useCookNotes(hid, recipeIds);
  const [noteEdits, setNoteEdits] = React.useState<Record<string, Record<string, string>>>(() => saved?.notes ?? {});
  const [accepted, setAccepted] = React.useState<string[]>(() => saved?.swaps ?? []);
  // M28 (R4.40): what the meal needs that Supply (unexpired, now) doesn't hold, covered by a substitute it does hold.
  const loaded = target.recipes.every((r) => recipeMap.has(r.recipeId)) && ingredientIds.every((id) => recipeIngredients.has(id));
  const swaps = React.useMemo(() => {
    if (!loaded || plan.supply.loading || !substitutionsOn(plan.household?.settings)) return [];
    const needs = mealRequirements(target.recipes, target.servings, { recipes: (id) => recipeMap.get(id), ingredients: (id) => recipeIngredients.get(id) }, target.sides ?? []);
    return findSwaps(needs, plan.unexpired, { baking: [...recipeMap.values()].some((r) => isBaking(r.tags)) });
  }, [loaded, plan.supply.loading, plan.household?.settings, plan.unexpired, target.recipes, target.servings, target.sides, recipeMap, recipeIngredients]);
  const swapIds = React.useMemo(() => swaps.map((x) => x.withIngredientId).filter((id) => !ingredientIds.includes(id)), [swaps, ingredientIds]);
  const swapIngredients = useIngredientsById(swapIds);
  const ingredients = React.useMemo(() => (swapIngredients.size ? new Map([...recipeIngredients, ...swapIngredients]) : recipeIngredients), [recipeIngredients, swapIngredients]);
  const lookup = lookupFromMap(ingredients);
  const single = target.recipes.length === 1;
  const [order, setOrder] = React.useState<string[]>(() => (saved?.order?.length === target.recipes.length ? saved.order : target.recipes.map((r) => r.recipeId)));
  const [done, setDone] = React.useState<string[]>(() => saved?.done ?? []);
  const [phase, setPhase] = React.useState<Phase>(() => {
    // Opened from a timer notification: straight to that recipe's step.
    if (initialStep !== undefined) {
      const ids = saved?.order?.length === target.recipes.length ? saved.order : target.recipes.map((r) => r.recipeId);
      return { kind: "steps", recipe: Math.max(0, initialStep.recipeId ? ids.indexOf(initialStep.recipeId) : 0), step: initialStep.step };
    }
    if (saved?.phase) return saved.phase;
    return single ? { kind: "mise", recipe: 0 } : { kind: "order" };
  });
  // Phase history (M9): forward moves push an entry, the back button pops it and the phase follows the URL.
  const location = useLocation();
  const mode = (location.search as { mode?: Mode }).mode;
  const lastRecipe = React.useRef(phase.kind === "order" ? 0 : phase.recipe);
  React.useEffect(() => {
    if (phase.kind !== "order") lastRecipe.current = phase.recipe;
  }, [phase]);
  const go = (next: Phase, how: "push" | "replace" = "push") => {
    setPhase(next);
    const m = modeOf(next, single);
    if (m === mode) return;
    const { step: _s, recipe: _r, ...rest } = location.search as Record<string, unknown>;
    void navigate({ to: location.pathname, search: { ...rest, mode: m } as never, replace: how === "replace" });
  };
  /** Back to an earlier phase by popping our own entries, so Back afterwards doesn't land on a stale phase. */
  const back = (to: Phase) => {
    const n = depthOf(mode, single) - depthOf(modeOf(to, single), single);
    setPhase(to);
    if (n > 0) router.history.go(-n);
  };
  const seenMode = React.useRef(mode);
  React.useEffect(() => {
    if (seenMode.current === mode) return;
    seenMode.current = mode;
    setPhase((p) => {
      if (modeOf(p, single) === mode) return p;
      const recipe = lastRecipe.current;
      if (mode === "steps") return { kind: "steps", recipe, step: 0 };
      if (mode === "mise") return { kind: "mise", recipe };
      return single ? { kind: "mise", recipe: 0 } : { kind: "order" };
    });
  }, [mode, single]);
  const [installAsk, setInstallAsk] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const awake = useWakeLock(true);
  // A new build never reloads the page mid-cook; it waits (with a Reload banner) until this session is gone.
  React.useEffect(() => {
    setUpdateDeferred(true);
    return () => setUpdateDeferred(false);
  }, []);
  // Load the review screen's code now, so Done cooking works with no signal even before the service worker has it.
  React.useEffect(() => {
    void router.preloadRoute({ to: "/review/$eventId", params: { eventId: "preload" } }).catch(() => undefined);
  }, [router]);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(PROGRESS(target.key), JSON.stringify({ phase, order, done, notes: noteEdits, swaps: accepted } satisfies Progress));
    } catch {
      /* ignore */
    }
  }, [phase, order, done, noteEdits, accepted, target.key]);

  // M28 (R4.39): the step notes a recipe shows: the last cook's (carried forward) with this cook's edits on top.
  const editsOf = (id: string) => new Map(Object.entries(noteEdits[id] ?? {}).map(([k, v]) => [Number(k), v] as const));
  const shownOf = (id: string) => latestStepNotes(noted ?? [], id);
  const stepNotesOf = (id: string) => {
    const m = shownOf(id);
    for (const [k, v] of editsOf(id)) {
      if (v.trim()) m.set(k, v.trim());
      else m.delete(k);
    }
    return m;
  };
  const setStepNote = (id: string, step: number, text: string) => setNoteEdits((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [String(step)]: text } }));
  const nameOf = (id: string) => ingredients.get(id)?.name ?? id.replace(/-/g, " ");
  const amountOf = (id: string, n: number) => formatCanonical(n, ingredients.get(id)?.canonicalUnit ?? "g", ingredients.get(id)?.unitWeightG);

  const ref = (id: string) => target.recipes.find((r) => r.recipeId === id)!;
  const recipeAt = (i: number): StoredRecipe | undefined => recipeMap.get(order[i] ?? "");
  const factorFor = (id: string) => {
    const r = recipeMap.get(id);
    return r ? scaleFactor(r, target.servings * ref(id).servingsMultiplier) : 1;
  };
  const timers = useCookTimers(target.key, {
    uid,
    title: target.title,
    linkFor: (t) => `${target.path}?${new URLSearchParams({ ...(t.recipeId ? { recipe: t.recipeId } : {}), step: String(t.stepIndex ?? 0) })}`,
    onFinished: (t) => notify({ kind: "info", message: `⏰ ${t.label} · time's up` }),
    onNeedsInstall: () => setInstallAsk(true),
    onOfflineStart: () => notify({ kind: "error", message: "You're offline: this timer runs here but won't alert while the phone is locked." }),
  });

  const finish = () => {
    if (finished) return;
    setFinished(true);
    timers.cancelAll();
    const cookEventId = newId(hid, "cookEvents");
    // M28: accepted swaps (R4.40) and the step notes (R4.39) go with Done cooking.
    const substitutions = swaps.filter((x) => accepted.includes(x.ingredientId)).map((x) => ({ ingredientId: x.ingredientId, withIngredientId: x.withIngredientId, amount: Math.round(x.amount * 1000) / 1000 })).filter((x) => x.amount > 0);
    const stepNotes: StepNote[] = target.recipes.flatMap((r) => stepNotesToSend(r.recipeId, shownOf(r.recipeId), editsOf(r.recipeId)));
    sendCommand(hid, uid, "finishCooking", {
      cookEventId,
      recipes: target.recipes,
      servings: target.servings,
      title: target.title,
      ...(target.planItemId ? { planItemId: target.planItemId } : {}),
      ...(target.savedMealId ? { savedMealId: target.savedMealId } : {}),
      ...(target.mealType ? { mealType: target.mealType } : {}),
      ...(target.sides?.length ? { sides: target.sides } : {}),
      ...(substitutions.length ? { substitutions } : {}),
      ...(stepNotes.length ? { stepNotes } : {}),
    });
    try {
      sessionStorage.removeItem(PROGRESS(target.key));
      sessionStorage.removeItem(`sf.timers.${target.key}`);
    } catch {
      /* ignore */
    }
    notify({ kind: "success", message: "Supply updated with what the recipe uses · review when you're ready" });
    void navigate({ to: "/review/$eventId", params: { eventId: cookEventId }, replace: true });
  };

  const checkOff = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    // R9.1: the review opens once every recipe is checked off.
    if (next.length === target.recipes.length) finish();
  };

  const recipeDone = (i: number) => {
    const id = order[i]!;
    if (single) return finish();
    if (!done.includes(id)) checkOff(id);
    if (done.length + 1 < target.recipes.length) back({ kind: "order" });
  };

  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const j = i + d;
    if (j < 0 || j >= o.length) return o;
    const n = [...o];
    [n[i], n[j]] = [n[j]!, n[i]!];
    return n;
  });

  const label = phase.kind === "order" ? `Meal · ${target.recipes.length} recipes` : phase.kind === "mise" ? "Mise en place" : "Step mode";
  const current = phase.kind === "order" ? undefined : recipeAt(phase.recipe);
  const loading = target.recipes.some((r) => !recipeMap.has(r.recipeId));

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-pg text-ink" role="region" aria-label={`Cooking ${target.title}`}>
      <header className="flex flex-none items-center gap-3 border-b-bw bg-base px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <button type="button" onClick={() => void navigate({ to: target.exitTo })} aria-label="Stop cooking" className="grid size-11 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink shadow-hard-sm">
          <X aria-hidden className="size-5" strokeWidth={3} />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem] uppercase" data-testid="cook-kicker">
            {/* M29 (R9.7): a planned meal says so, however the cook was started. */}
            {target.planItemId ? `Planned · ${label}` : label}
          </span>
          <span className="truncate text-[0.9375rem] font-extrabold">{current && !single ? current.title : target.title}</span>
        </span>
        {awake ? (
          <span className="rounded-ui border-2 border-line bg-yellow px-1.5 py-0.5 font-mono text-[0.5625rem] font-bold text-onc" title="The screen stays on while you cook" data-testid="awake">
            ☀<span className="max-sm:sr-only"> AWAKE</span>
          </span>
        ) : null}
        {!online ? <span className="rounded-ui border-2 border-line bg-peach-soft px-1.5 py-0.5 font-mono text-[0.5625rem] font-bold text-onc">OFFLINE</span> : null}
        {/* M11 (R4.31): hands-free from mise en place on; not on a meal's order list. */}
        {phase.kind !== "order" ? <HandsFreeToggle /> : null}
        <Button variant="ink" size="sm" onClick={finish} disabled={finished}>
          Done cooking
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {loading ? (
          <p className="p-6 text-sm font-bold">Loading the recipes…</p>
        ) : phase.kind === "order" ? (
          <div className="mx-auto flex w-full max-w-[50rem] flex-col gap-3 px-4 pt-4 pb-6">
            <div className="flex flex-col gap-1">
              <span className="kicker">Choose the order · check each one off</span>
              <h1 className="m-0 font-display text-[2rem] leading-[0.95] font-normal">{target.title}</h1>
            </div>
            <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Recipes in cooking order">
              {order.map((id, i) => {
                const r = recipeMap.get(id)!;
                const on = done.includes(id);
                return (
                  <li key={id} className={cn("flex items-center gap-3 rounded-ui border-bw bg-base p-3 shadow-hard", on && "bg-mantle")} data-testid="cook-recipe">
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`${r.title} done`} onClick={() => checkOff(id)} className={cn("grid size-11 flex-none cursor-pointer place-items-center rounded-ui border-bw", on ? "bg-acc text-onc" : "bg-base")}>
                      {on ? <Check aria-hidden className="size-5" strokeWidth={4} /> : null}
                    </button>
                    <RecipeThumb base={thumbOf(r)} cuisine={r.cuisine} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={cn("text-[1.0625rem] leading-tight font-extrabold", on && "line-through decoration-2")}>{r.title}</span>
                      <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                        {formatMinutes(r.prepMin + r.cookMin)} total · {formatMinutes(r.prepMin)} active
                      </span>
                    </span>
                    <span className="flex flex-none flex-col gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.title} earlier`} className="grid size-11 cursor-pointer place-items-center rounded-[calc(var(--r)*0.67)] border-2 border-line bg-pg text-[0.75rem] disabled:opacity-40">
                        ▲
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${r.title} later`} className="grid size-11 cursor-pointer place-items-center rounded-[calc(var(--r)*0.67)] border-2 border-line bg-pg text-[0.75rem] disabled:opacity-40">
                        ▼
                      </button>
                    </span>
                    <Button onClick={() => go({ kind: "mise", recipe: i })} aria-label={`Cook ${r.title}`} className="flex-none px-3">
                      Cook →
                    </Button>
                  </li>
                );
              })}
            </ol>
            <p className="m-0 text-[0.8125rem] font-semibold text-sub">The review opens once every recipe is checked off, or when you tap Done cooking.</p>
          </div>
        ) : phase.kind === "mise" && current ? (
          <MiseEnPlace
            recipe={current}
            recipeId={order[phase.recipe]!}
            lookup={lookup}
            factor={factorFor(order[phase.recipe]!)}
            missingTools={tools.length ? missingTools(current.tools, tools) : []}
            onStart={() => go({ kind: "steps", recipe: phase.recipe, step: 0 })}
            notes={{ notes: recipeNotes(noted ?? [], order[phase.recipe]!), names, tz }}
            swaps={swaps
              .filter((x) => current.ingredientIds.includes(x.ingredientId))
              .map((x): MiseSwap => ({ ingredientId: x.ingredientId, text: swapText(x, nameOf, amountOf), note: x.note, accepted: accepted.includes(x.ingredientId) }))}
            onSwap={(id, on) => setAccepted((a) => (on ? [...new Set([...a, id])] : a.filter((x) => x !== id)))}
            // M29 (R4.41): one recipe goes back to its recipe page; a meal goes back to its list of recipes (R4.12).
            back={single ? { label: "Back to the recipe", onClick: () => void navigate({ to: "/recipes/$id", params: { id: order[0]! } }) } : { label: "Back to the meal's recipes", onClick: () => back({ kind: "order" }) }}
          />
        ) : phase.kind === "steps" && current ? (
          <StepMode
            recipe={current}
            recipeId={order[phase.recipe]!}
            lookup={lookup}
            factor={factorFor(order[phase.recipe]!)}
            step={phase.step}
            onStep={(step) => setPhase({ kind: "steps", recipe: phase.recipe, step })}
            onFinish={() => recipeDone(phase.recipe)}
            timers={timers}
            isLastRecipe={single || done.length + 1 >= target.recipes.length}
            stepNotes={stepNotesOf(order[phase.recipe]!)}
            onNote={(step, text) => setStepNote(order[phase.recipe]!, step, text)}
          />
        ) : null}
      </main>

      <InstallSheet open={installAsk} onOpenChange={setInstallAsk} />
    </div>
  );
}

/** First timer on an iPhone in Safari: web push needs the app on the home screen (R4.23, iOS 16.4+). */
function InstallSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const install = useInstallPrompt();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <SheetContent
          title="Install for timer alerts"
          footer={
            <Button className="w-full" onClick={() => (install.canPrompt ? void install.prompt().then(() => onOpenChange(false)) : onOpenChange(false))}>
              {install.canPrompt ? "Install" : "Got it"}
            </Button>
          }
        >
          <p className="m-0 text-[0.9375rem] font-semibold" data-testid="install-prompt">
            {isIos() && !isStandalone()
              ? "On iPhone, timers can only alert you while the phone is locked when Solving Food is on your home screen. Tap Share, then “Add to Home Screen”, and open it from there."
              : "Install Solving Food so timers can alert you while the phone is locked."}
          </p>
          <p className="m-0 text-[0.8125rem] font-semibold text-sub">This timer still runs here, with a sound and vibration while the screen is on.</p>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
