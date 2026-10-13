// The Plan page (PRD R6.1–R6.10, R5.1–R5.7, R9.4, R8.15; TECHNICAL_SPECS §7, §12). M3 adds pending reviews, expired-lot
// prompts, Cook / eaten actions, expiry badges, and leftover items. Phone: sticky budget meter, header with Create
// meal, coverage strip, the period's meals by meal type, then Suggested (+ See more), protein, optimiser. lg: two
// columns; xl: plan · suggestions/protein/optimiser · budget/expiry, as the prototype's desktop mode. M7 (owner review):
// no Grocery list button (the tab stays), no "not a schedule" hint, protein directly above the optimiser.
import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  applyCollection,
  collectionSearchSchema,
  combinedSuggestion,
  NO_FACTS,
  dayOfPeriod,
  imageVariant,
  daysLeft,
  earliestExpiringUse,
  soonestUseDays,
  expiresPhrase,
  mealRequirements,
  USE_SOON_DAYS,
  formatPeriodRange,
  MEAL_TYPE_ORDER,
  MEAL_TYPES,
  periodCells,
  planItemRow,
  planItemTitle,
  proteinSummary,
  SORT_LABELS,
  stripModel,
  toSearchParams,
  type CollectionSearch,
  type HouseholdFacts,
  type MealType,
} from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CollectionView } from "@/components/CollectionView";
import { Button } from "@/components/ui/button";
import { BudgetMeterCard, BudgetMeterCompact } from "@/components/plan/BudgetMeter";
import { CoverageStrip } from "@/components/plan/CoverageStrip";
import { PlanItemCard, PlanItemSheet, type PlanItemView } from "@/components/plan/PlanItem";
import { MEAL_LABEL, useCreateMeal } from "@/components/plan/plan-sheet-context";
import { SuggestedSection } from "@/components/plan/Suggested";
import { ExpiryAlerts } from "@/components/plan/ExpiryAlerts";
import { UseItUp } from "@/components/plan/UseItUp";
import { OptimiserCard } from "@/components/plan/Optimiser";
import { usePlanModel } from "@/data/planModel";
import { dismissExpiryAlert, millis } from "@/data/plan";
import { useScoringSnapshot, useSuggestions } from "@/data/suggestions";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { publicUrl } from "@/firebase/app";
import { useNotify } from "@/components/notifications-context";
import { ExpiredLotPrompts } from "@/components/supply/ExpiredLotPrompt";
import { dateText, expiredEntries, itemExpiry, unitFor } from "@/components/supply/format";
import { PendingReviews } from "@/components/cook/PendingReviews";
import { usePendingReviews } from "@/components/cook/helpers";
import { useOnline } from "@/hooks/useOnline";
import { useReadySession } from "@/session/useSession";
import { useNutrition, useNutritionSearch } from "@/data/nutrition";

/** M9 (owner review, R6.24): planned meals whose ingredients expire soonest first; ties by Suggested. */
const PLAN_DEFAULT_SORT = "expiry" as const;

export const Route = createFileRoute("/_app/plan")({
  validateSearch: (s) => collectionSearchSchema.parse(s),
  component: PlanPage,
});

function PlanPage() {
  const s = useReadySession();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const openCreateMeal = useCreateMeal()!;
  const online = useOnline();
  const m = usePlanModel();
  const summaries = useRecipeIndex();
  const byId = React.useMemo(() => new Map((summaries ?? []).map((r) => [r.id, r])), [summaries]);
  const [openItem, setOpenItem] = React.useState<string | null>(null);
  const [now] = React.useState(() => Date.now());

  const tz = m.household?.timezone ?? "America/Toronto";
  const startMs = millis(m.period?.start);
  const endMs = millis(m.period?.end);
  const cells = React.useMemo(() => (startMs && endMs ? periodCells(startMs, endMs, tz) : []), [startMs, endMs, tz]);
  const ended = endMs !== null && now >= endMs;

  const titleOf = React.useCallback((id: string) => m.recipes.get(id)?.title ?? byId.get(id)?.title, [m.recipes, byId]);
  // Sides (R5.9) by ingredient name: "Salmon + french fries, frozen peas" on unnamed rows, searchable by name.
  const sideNameOf = React.useCallback((id: string) => m.ingredients.get(id)?.name, [m.ingredients]);
  // Pending commands show at once: a finished meal reads as cooked, an eaten one as eaten (§6 optimistic view).
  const optimistic = React.useMemo(() => {
    const out = new Map<string, "cooked" | "eaten">();
    for (const p of m.supply.pendingCommands) {
      if (p.command.type === "finishCooking" && p.command.payload.planItemId) out.set(p.command.payload.planItemId, "cooked");
      if (p.command.type === "markEaten") out.set(p.command.payload.planItemId, "eaten");
    }
    return out;
  }, [m.supply.pendingCommands]);
  const supplyNow = m.supply.now;
  // Cooked meals waiting for their review (M9, R9.5): the card's Review button; the review marks them eaten.
  const pending = usePendingReviews(m.hid, s.user.uid);
  const reviewOf = React.useMemo(() => new Map(pending.filter((e) => e.reason === "review" && e.planItemId).map((e) => [e.planItemId!, e.id])), [pending]);
  const views: PlanItemView[] = React.useMemo(
    () =>
      m.items.map((i) => {
        const status = optimistic.get(i.id) ?? i.data.status;
        const v: PlanItemView = { id: i.id, item: i.data, title: planItemTitle(i.data, titleOf, sideNameOf), cost: m.ready ? m.costs.get(i.id) : undefined, status, review: reviewOf.get(i.id) };
        if (status === "planned" && i.data.kind === "meal") {
          // R6.7: the soonest-expiring lot this meal would use, when it expires within the period (or within days).
          const needs = mealRequirements(i.data.recipes, i.data.servings, m.ctx, i.data.sides);
          const e = earliestExpiringUse(needs, (id) => m.lotsByIngredient.get(id), supplyNow);
          // M9 (R6.24): the list's default order is the soonest-expiring ingredient first; the badge says why.
          v.soonDays = soonestUseDays(needs, (id) => m.lotsByIngredient.get(id), supplyNow)?.days;
          if (e && (e.expiresMs <= (endMs ?? 0) || daysLeft(e.expiresMs, supplyNow, tz) <= USE_SOON_DAYS)) {
            const name = m.ingredients.get(e.ingredientId)?.name ?? e.ingredientId.replace(/-/g, " ");
            v.expiry = `${name} ${expiresPhrase(e.expiresMs, supplyNow, tz)}`;
          }
        }
        if (i.data.kind === "leftover" && i.data.leftoverSupplyId) {
          const lo = m.supply.items.get(i.data.leftoverSupplyId);
          const exp = lo ? itemExpiry(lo.lots, supplyNow, tz) : null;
          v.leftover = { useBy: exp?.expiresMs ? dateText(exp.expiresMs - 1, tz) : null, expired: exp?.flag === "expired" };
        }
        return v;
      }),
    [m.items, titleOf, sideNameOf, m.costs, m.ready, optimistic, reviewOf, m.ctx, m.lotsByIngredient, m.ingredients, m.supply.items, supplyNow, endMs, tz],
  );
  const rows = React.useMemo(
    () => stripModel(views.map((v) => ({ coverage: v.item.coverage, status: v.status, kind: v.item.kind })), cells.length, m.household?.plannedMealTypes ?? []),
    [views, cells.length, m.household?.plannedMealTypes],
  );
  const listRows = React.useMemo(() => views.map((v) => planItemRow(v.id, v.item, (id) => byId.get(id), v.title, sideNameOf)), [views, byId, sideNameOf]);
  const suggestions = useSuggestions();
  // The list's Suggested and Expiring first sorts: each item's recipes' scores, combined (M5).
  const factsOf = React.useCallback(
    (id: string): HouseholdFacts => {
      const v = views.find((x) => x.id === id);
      const c = v ? combinedSuggestion(v.item.recipes.map((r) => r.recipeId), suggestions.byId) : null;
      // Expiring first (the default, M9) uses the meal's own soonest-expiring ingredient, ties by the suggestion score.
      return { ...NO_FACTS, ...(c ? { suggestion: { raw: c.raw, blocked: c.blocked } } : {}), expiryDays: v?.soonDays ?? null };
    },
    [views, suggestions.byId],
  );
  const nut = useNutritionSearch();
  const result = React.useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    const matches = q ? new Map(listRows.filter((r) => [r.title, ...r.ingredientNames, ...r.tags].some((t) => t.toLowerCase().includes(q))).map((r) => [r.id, 1])) : null;
    return applyCollection(listRows, nut({ ...search, sort: search.sort ?? PLAN_DEFAULT_SORT }), factsOf, matches);
  }, [listRows, search, factsOf, nut]);
  const viewById = new Map(views.map((v) => [v.id, v]));
  const groups = MEAL_TYPES.map((t) => ({ type: t, items: result.items.map((r) => viewById.get(r.id)!).filter((v) => v && v.item.mealType === t) })).filter((g) => g.items.length);

  const onSearchChange = React.useCallback(
    (next: CollectionSearch, opts?: { replace?: boolean }) => void navigate({ to: "/plan", search: toSearchParams(next) as never, replace: opts?.replace ?? false }),
    [navigate],
  );
  const planned = views.filter((v) => v.status === "planned" && v.item.kind === "meal").length;
  const expired = expiredEntries(m.supply.items.values(), supplyNow, (it) => unitFor(it, it.ingredientId ? m.ingredients.get(it.ingredientId) : undefined));
  const protein = proteinSummary(
    m.items.map((i) => i.data),
    (id) => m.recipes.get(id)?.proteinPerServingG ?? null,
  );
  const fibre = proteinSummary(
    m.items.map((i) => i.data),
    (id) => m.recipes.get(id)?.fibrePerServingG ?? null,
  );
  const nutrition = useNutrition();
  const open = openItem ? (views.find((v) => v.id === openItem) ?? null) : null;
  const notify = useNotify();
  const wide = useMediaQuery("(min-width: 80rem)");
  const snapshot = useScoringSnapshot(m);
  const plannedIds = React.useMemo(() => new Set(m.items.filter((i) => i.data.status === "planned" || i.data.status === "cooked").flatMap((i) => i.data.recipes.map((r) => r.recipeId))), [m.items]);
  const goals = nutrition.proteinGoals;
  const dismissed = React.useMemo(() => new Set(m.period?.dismissedLots ?? []), [m.period?.dismissedLots]);

  // Offline (§12): warm the service worker's image cache with the planned recipes' photos.
  const imageKey = [...m.recipes.values()].map((r) => r.imagePaths[0] ?? "").filter(Boolean).sort().join("|");
  React.useEffect(() => {
    if (!imageKey || !navigator.onLine) return;
    const t = setTimeout(() => {
      for (const base of imageKey.split("|")) for (const size of [480, 960] as const) new Image().src = publicUrl(imageVariant(base, size));
    }, 2000);
    return () => clearTimeout(t);
  }, [imageKey]);

  return (
    <PageBody className="max-w-[112.5rem]">
      <BudgetMeterCompact b={m.budget} className="sticky top-1 z-20 lg:hidden" />
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div className="flex flex-col gap-1">
          <span className="kicker" data-testid="period-range">
            {startMs && endMs ? `${formatPeriodRange(startMs, endMs, tz)} · DAY ${dayOfPeriod(now, startMs, endMs, tz)} OF ${cells.length}` : "SETTING UP THE PERIOD…"}
          </span>
          <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">Plan</h1>
        </div>
        <Button onClick={() => openCreateMeal()}>+ Create meal</Button>
      </div>
      <PendingReviews hid={m.hid} uid={s.user.uid} />
      <ExpiredLotPrompts entries={expired} hid={m.hid} uid={s.user.uid} tz={tz} nowMs={supplyNow} />
      {ended && !online ? (
        <div role="status" className="rounded-ui border-2 border-dashed border-line bg-base p-3 text-sm font-bold">
          This period has ended. It will roll over when you're back online; uncooked meals carry into the next one.
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-[1.125rem] [grid-template-areas:'c'_'a'_'b'] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:[grid-template-areas:'a_c'_'a_b'] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.85fr)] xl:[grid-template-areas:'a_b_c']">
        <div className="flex min-w-0 flex-col gap-3.5 [grid-area:a]">
          {cells.length ? <CoverageStrip rows={rows} cells={cells} todayIndex={dayOfPeriod(now, startMs!, endMs!, tz) - 1} /> : null}
          <CollectionView
            search={search}
            onSearchChange={onSearchChange}
            placeholder="Search this period's meals…"
            noun="planned meals"
            countFor={(x) => applyCollection(listRows, x, factsOf, null).items.length}
            defaultSort={PLAN_DEFAULT_SORT}
            hide={["tools", "cost", "supply"]}
            courses={MEAL_TYPES}
            sticky={false}
            header={
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="m-0 font-display text-[1.375rem] font-normal">This period</h2>
                <span className="font-mono text-[0.65625rem] font-bold" data-testid="plan-count">
                  {m.loading ? "LOADING…" : `${planned} TO COOK · ${SORT_LABELS[search.sort ?? PLAN_DEFAULT_SORT].toUpperCase()}`}
                </span>
              </div>
            }
          >
            {!m.loading && m.items.length === 0 ? (
              <EmptyState>
                <p className="m-0 mb-3">Nothing planned yet. Create a meal from one or more recipes, or a saved meal.</p>
                <Button onClick={() => openCreateMeal()}>+ Create meal</Button>
              </EmptyState>
            ) : !m.loading && result.items.length === 0 ? (
              <EmptyState>No planned meals match.</EmptyState>
            ) : (
              groups.map((g) => (
                <section key={g.type} aria-label={MEAL_LABEL[g.type]} className="flex flex-col gap-2.5">
                  <div className="flex justify-between border-b-2 border-line pb-1 font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">
                    <span>{MEAL_LABEL[g.type]}</span>
                    <span>
                      {g.items.length} item{g.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {g.items
                    .sort((a, b) => MEAL_TYPE_ORDER[a.item.mealType] - MEAL_TYPE_ORDER[b.item.mealType])
                    .map((v) => (
                      <PlanItemCard key={v.id} v={v} recipes={m.recipes} ingredients={m.ingredients} hid={m.hid} uid={s.user.uid} onOpen={() => setOpenItem(v.id)} />
                    ))}
                </section>
              ))
            )}
          </CollectionView>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 [grid-area:b]">
          <SuggestedSection ranked={suggestions.ranked} summaries={byId} plannedIds={plannedIds} weights={m.household?.settings?.scoreWeights} wide={wide} onAdd={(id) => openCreateMeal({ recipeIds: [id] })} />
          {/* M7: the protein summary sits at the bottom, directly above the optimiser, at every width. */}
          {nutrition.on ? <ProteinCard protein={protein} fibre={fibre} plannedTypes={m.household?.plannedMealTypes ?? []} goals={goals} fibreGoals={nutrition.fibreGoals} /> : null}
          <OptimiserCard snapshot={snapshot} summaries={byId} hid={m.hid} periodId={m.periodId} uid={s.user.uid} servings={m.household?.defaultServings ?? 4} remainingCents={m.budget.remainingCents} goals={goals} />
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 [grid-area:c] lg:sticky lg:top-4">
          <BudgetMeterCard b={m.budget} className="hidden lg:flex" />
          <ExpiryAlerts
            spare={m.expiring}
            dismissed={dismissed}
            ingredient={(id) => {
              const i = m.ingredients.get(id);
              return i ? { name: i.name, canonicalUnit: i.canonicalUnit, unitWeightG: i.unitWeightG } : undefined;
            }}
            summaries={summaries ?? []}
            scores={suggestions.byId}
            plannedIds={plannedIds}
            servings={m.household?.defaultServings ?? 4}
            nowMs={supplyNow}
            tz={tz}
            onAdd={(id) => openCreateMeal({ recipeIds: [id] })}
            onDismiss={(lots) => {
              if (m.periodId) void dismissExpiryAlert(m.hid, m.periodId, lots).catch((e) => notify({ kind: "error", message: `Couldn't dismiss it: ${(e as Error).message}` }));
            }}
          />
          {/* M9 (R6.25): what the next order will bring that won't keep and no planned meal uses. */}
          {m.ready ? (
            <UseItUp
              items={m.useItUp}
              dismissed={dismissed}
              ingredient={(id) => {
                const i = m.ingredients.get(id);
                return i ? { name: i.name, canonicalUnit: i.canonicalUnit, unitWeightG: i.unitWeightG } : undefined;
              }}
              summaries={summaries ?? []}
              scores={suggestions.byId}
              plannedIds={plannedIds}
              servings={m.household?.defaultServings ?? 4}
              onAdd={(id) => openCreateMeal({ recipeIds: [id] })}
              onDismiss={(key) => {
                if (m.periodId) void dismissExpiryAlert(m.hid, m.periodId, [key]).catch((e) => notify({ kind: "error", message: `Couldn't dismiss it: ${(e as Error).message}` }));
              }}
            />
          ) : null}
        </div>
      </div>

      <PlanItemSheet v={open} hid={m.hid} uid={s.user.uid} recipes={m.recipes} ingredients={m.ingredients} plannedMealTypes={m.household?.plannedMealTypes ?? []} onOpenChange={(o) => !o && setOpenItem(null)} />
    </PageBody>
  );
}

/**
 * <ProteinSummary> (R6.17, R6.14; M9: R6.26 fibre): average protein and fibre per serving of the planned meals per meal
 * type, each next to its goal, with a bar (green at or above the goal, peach below). Goals are set in Settings →
 * Preferences. Not rendered while nutrition tracking is off (R6.27).
 */
function ProteinCard({
  protein,
  fibre,
  plannedTypes,
  goals,
  fibreGoals,
}: {
  protein: Partial<Record<MealType, { avg: number; items: number }>>;
  fibre: Partial<Record<MealType, { avg: number; items: number }>>;
  plannedTypes: readonly string[];
  goals: Partial<Record<MealType, number>>;
  fibreGoals: Partial<Record<MealType, number>>;
}) {
  const types = MEAL_TYPES.filter((t) => plannedTypes.includes(t) || protein[t] || fibre[t]);
  const bar = (key: string, label: string, p: { avg: number } | undefined, goal: number | undefined) => {
    const avg = p ? Math.round(p.avg) : null;
    const met = goal !== undefined && avg !== null && avg >= goal;
    const pct = goal !== undefined ? (avg !== null ? Math.min(100, (avg / goal) * 100) : 0) : avg !== null ? 100 : 0;
    return (
      <div className="flex flex-col gap-1" data-testid={key}>
        <div className="flex justify-between gap-2 font-mono text-[0.6875rem] font-bold uppercase">
          <span>{label}</span>
          <span>
            {avg !== null ? `${avg} g` : "—"} · {goal !== undefined ? `goal ${goal} g` : "no goal"}
            {goal !== undefined && avg !== null ? (met ? " ✓" : " ↓") : ""}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-[0.1875rem] border-2 border-line bg-pg" aria-hidden>
          <div className={goal === undefined ? "h-full bg-s0" : met ? "h-full bg-acc" : "h-full bg-peach"} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };
  return (
    <section aria-label="Protein and fibre per serving" data-testid="protein-summary" className="flex flex-col gap-2.5 rounded-ui border-bw bg-base px-3.5 py-3 shadow-hard">
      <div className="flex justify-between font-mono text-[0.65625rem] font-bold tracking-[0.09rem] uppercase">
        <span>Protein &amp; fibre / serving</span>
        <span className="text-sub">Plan avg</span>
      </div>
      {types.map((t) => (
        <div key={t} className="flex flex-col gap-1.5">
          {bar(`protein-${t}`, `${MEAL_LABEL[t]} · protein`, protein[t], goals[t])}
          {/* A fibre row only says something with planned meals or a goal (design pass: no empty rows twice). */}
          {fibre[t] || fibreGoals[t] !== undefined ? bar(`fibre-${t}`, `${MEAL_LABEL[t]} · fibre`, fibre[t], fibreGoals[t]) : null}
        </div>
      ))}
      <Link to="/settings/preferences" className="text-[0.75rem] font-bold text-ink underline">
        Protein and fibre goals
      </Link>
    </section>
  );
}
