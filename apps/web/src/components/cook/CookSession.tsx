// <MealCookView> and the cooking session (PRD R5.6, R9.1, R9.3, R4.10–R4.12, R4.23; TECHNICAL_SPECS §12; prototype
// cook phases). A planned meal, a saved meal, or a single recipe: choose the order (recipes with their total time,
// ▲/▼), cook each through mise en place and step mode, check it off. Done cooking (or the last recipe checked off)
// sends `finishCooking`, which deducts the recipe defaults right away, and opens the review. One-recipe meals skip the
// ordering step. The screen stays awake while cooking (Screen Wake Lock).
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { formatDuration, missingTools, scaleFactor, type MealType, type RecipeRef } from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useNotify } from "@/components/notifications-context";
import { lookupFromMap, useIngredientsById } from "@/data/ingredients";
import { useRecipeDocs } from "@/data/plan";
import { newId, sendCommand } from "@/data/supply";
import type { StoredRecipe } from "@/data/recipes";
import { useOnline } from "@/hooks/useOnline";
import { useInstallPrompt, isStandalone } from "@/pwa/install";
import { isIos } from "@/pwa/push";
import { cn } from "@/lib/utils";
import { MiseEnPlace, StepMode } from "./StepMode";
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
  /** Where ✕ goes. */
  exitTo: string;
  /** Base path of this cook view, for timer notification links. */
  path: string;
}

type Phase = { kind: "order" } | { kind: "mise"; recipe: number } | { kind: "steps"; recipe: number; step: number };

const PROGRESS = (k: string) => `sf.cook.${k}`;

function loadProgress(key: string): { phase: Phase; order: string[]; done: string[] } | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function CookSession({ target, hid, uid, tools, initialStep }: { target: CookTarget; hid: string; uid: string; tools: readonly string[]; initialStep?: { recipeId?: string | undefined; step: number } | undefined }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const online = useOnline();
  const recipeMap = useRecipeDocs(target.recipes.map((r) => r.recipeId));
  const ingredientIds = React.useMemo(() => [...recipeMap.values()].flatMap((r) => r.ingredientIds), [recipeMap]);
  const ingredients = useIngredientsById(ingredientIds);
  const lookup = lookupFromMap(ingredients);
  const saved = loadProgress(target.key);
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
  const [installAsk, setInstallAsk] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const awake = useWakeLock(true);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(PROGRESS(target.key), JSON.stringify({ phase, order, done }));
    } catch {
      /* ignore */
    }
  }, [phase, order, done, target.key]);

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
    sendCommand(hid, uid, "finishCooking", {
      cookEventId,
      recipes: target.recipes,
      servings: target.servings,
      title: target.title,
      ...(target.planItemId ? { planItemId: target.planItemId } : {}),
      ...(target.savedMealId ? { savedMealId: target.savedMealId } : {}),
      ...(target.mealType ? { mealType: target.mealType } : {}),
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
    if (done.length + 1 < target.recipes.length) setPhase({ kind: "order" });
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
        <button type="button" onClick={() => void navigate({ to: target.exitTo })} aria-label="Stop cooking" className="grid size-10 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink shadow-hard-sm">
          <X aria-hidden className="size-5" strokeWidth={3} />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem] uppercase">{label}</span>
          <span className="truncate text-[0.9375rem] font-extrabold">{current && !single ? current.title : target.title}</span>
        </span>
        {awake ? (
          <span className="rounded-ui border-2 border-line bg-yellow px-1.5 py-0.5 font-mono text-[0.5625rem] font-bold text-onc" title="The screen stays on while you cook" data-testid="awake">
            ☀ AWAKE
          </span>
        ) : null}
        {!online ? <span className="rounded-ui border-2 border-line bg-peach px-1.5 py-0.5 font-mono text-[0.5625rem] font-bold text-onc">OFFLINE</span> : null}
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
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`${r.title} done`} onClick={() => checkOff(id)} className={cn("grid size-10 flex-none cursor-pointer place-items-center rounded-ui border-bw", on ? "bg-acc text-onc" : "bg-base")}>
                      {on ? <Check aria-hidden className="size-5" strokeWidth={4} /> : null}
                    </button>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={cn("text-[1.0625rem] leading-tight font-extrabold", on && "line-through decoration-2")}>{r.title}</span>
                      <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                        {formatDuration((r.prepMin + r.cookMin) * 60_000)} total · {r.prepMin} active
                      </span>
                    </span>
                    <span className="flex flex-none flex-col gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.title} earlier`} className="grid h-8 w-10 cursor-pointer place-items-center rounded-[calc(var(--r)*0.67)] border-2 border-line bg-pg text-[0.75rem] disabled:opacity-40">
                        ▲
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${r.title} later`} className="grid h-8 w-10 cursor-pointer place-items-center rounded-[calc(var(--r)*0.67)] border-2 border-line bg-pg text-[0.75rem] disabled:opacity-40">
                        ▼
                      </button>
                    </span>
                    <Button onClick={() => setPhase({ kind: "mise", recipe: i })} aria-label={`Cook ${r.title}`} className="flex-none px-3">
                      Cook →
                    </Button>
                  </li>
                );
              })}
            </ol>
            <p className="m-0 text-[0.8125rem] font-semibold text-sub">The review opens once every recipe is checked off, or when you tap Done cooking.</p>
          </div>
        ) : phase.kind === "mise" && current ? (
          <MiseEnPlace recipe={current} lookup={lookup} factor={factorFor(order[phase.recipe]!)} missingTools={tools.length ? missingTools(current.tools, tools) : []} onStart={() => setPhase({ kind: "steps", recipe: phase.recipe, step: 0 })} />
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
