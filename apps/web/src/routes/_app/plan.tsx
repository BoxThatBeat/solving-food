// The Plan page (PRD R6.1–R6.6, R5.1–R5.7; TECHNICAL_SPECS §7, §12). Phone: sticky budget meter, header with Create
// meal, coverage strip, the period's meals by meal type. lg: two columns; xl: plan · suggestions · budget/protein,
// as the prototype's desktop mode.
import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  applyCollection,
  collectionSearchSchema,
  dayOfPeriod,
  formatPeriodRange,
  formatProtein,
  MEAL_TYPE_ORDER,
  MEAL_TYPES,
  periodCells,
  planItemRow,
  planItemTitle,
  proteinSummary,
  SORT_LABELS,
  stripModel,
  taxonomyLabel,
  toSearchParams,
  type CollectionSearch,
  type MealType,
} from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CollectionView } from "@/components/CollectionView";
import { Button } from "@/components/ui/button";
import { BudgetMeterCard, BudgetMeterCompact } from "@/components/plan/BudgetMeter";
import { CoverageStrip } from "@/components/plan/CoverageStrip";
import { PlanItemCard, PlanItemSheet, type PlanItemView } from "@/components/plan/PlanItem";
import { MEAL_LABEL, useCreateMeal } from "@/components/plan/plan-sheet-context";
import { RecipeImage } from "@/components/recipes/RecipeImage";
import { usePlanModel } from "@/data/planModel";
import { useHouseholdFacts } from "@/data/householdRecipes";
import { millis } from "@/data/plan";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { useOnline } from "@/hooks/useOnline";
import { useReadySession } from "@/session/useSession";

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
  const rows = React.useMemo(() => stripModel(m.items.map((i) => i.data), cells.length, m.household?.plannedMealTypes ?? []), [m.items, cells.length, m.household?.plannedMealTypes]);
  const ended = endMs !== null && now >= endMs;

  const titleOf = React.useCallback((id: string) => m.recipes.get(id)?.title ?? byId.get(id)?.title, [m.recipes, byId]);
  const views: PlanItemView[] = React.useMemo(
    () => m.items.map((i) => ({ id: i.id, item: i.data, title: planItemTitle(i.data, titleOf), cost: m.ready ? m.costs.get(i.id) : undefined })),
    [m.items, titleOf, m.costs, m.ready],
  );
  const listRows = React.useMemo(() => views.map((v) => planItemRow(v.id, v.item, (id) => byId.get(id), v.title)), [views, byId]);
  const factsOf = useHouseholdFacts(null);
  const result = React.useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    const matches = q ? new Map(listRows.filter((r) => [r.title, ...r.ingredientNames, ...r.tags].some((t) => t.toLowerCase().includes(q))).map((r) => [r.id, 1])) : null;
    return applyCollection(listRows, search, factsOf, matches);
  }, [listRows, search, factsOf]);
  const viewById = new Map(views.map((v) => [v.id, v]));
  const groups = MEAL_TYPES.map((t) => ({ type: t, items: result.items.map((r) => viewById.get(r.id)!).filter((v) => v && v.item.mealType === t) })).filter((g) => g.items.length);

  const onSearchChange = React.useCallback(
    (next: CollectionSearch, opts?: { replace?: boolean }) => void navigate({ to: "/plan", search: toSearchParams(next) as never, replace: opts?.replace ?? false }),
    [navigate],
  );
  const groceryCount = Object.keys(m.built.items).length + Object.values(m.draft.data?.items ?? {}).filter((it) => it.source !== "plan").length;
  const planned = m.items.filter((i) => i.data.status === "planned").length;
  const protein = proteinSummary(
    m.items.map((i) => i.data),
    (id) => m.recipes.get(id)?.proteinPerServingG ?? null,
  );
  const open = openItem ? (views.find((v) => v.id === openItem) ?? null) : null;

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
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to="/grocery" className="no-underline">
              Grocery list{groceryCount ? ` · ${groceryCount}` : ""} →
            </Link>
          </Button>
          <Button onClick={() => openCreateMeal()}>+ Create meal</Button>
        </div>
      </div>
      {ended && !online ? (
        <div role="status" className="rounded-ui border-2 border-dashed border-line bg-base p-3 text-sm font-bold">
          This period has ended. It will roll over when you're back online; uncooked meals carry into the next one.
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-[1.125rem] [grid-template-areas:'a'_'c'_'b'] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:[grid-template-areas:'a_c'_'a_b'] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.85fr)] xl:[grid-template-areas:'a_b_c']">
        <div className="flex min-w-0 flex-col gap-3.5 [grid-area:a]">
          {cells.length ? <CoverageStrip rows={rows} cells={cells} todayIndex={dayOfPeriod(now, startMs!, endMs!, tz) - 1} /> : null}
          <CollectionView
            search={search}
            onSearchChange={onSearchChange}
            placeholder="Search this period's meals…"
            noun="planned meals"
            countFor={(x) => applyCollection(listRows, x, factsOf, null).items.length}
            hide={["tools", "cost", "supply"]}
            sticky={false}
            header={
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="m-0 font-display text-[1.375rem] font-normal">This period</h2>
                <span className="font-mono text-[0.65625rem] font-bold" data-testid="plan-count">
                  {m.loading ? "LOADING…" : `${planned} TO COOK · ${SORT_LABELS[search.sort ?? "suggested"].toUpperCase()}`}
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
                      <PlanItemCard key={v.id} v={v} recipes={m.recipes} hid={m.hid} onOpen={() => setOpenItem(v.id)} />
                    ))}
                </section>
              ))
            )}
          </CollectionView>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 [grid-area:b]">
          <Suggested onAdd={(id) => openCreateMeal({ recipeIds: [id] })} plannedIds={new Set(m.items.flatMap((i) => i.data.recipes.map((r) => r.recipeId)))} />
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 [grid-area:c] lg:sticky lg:top-4">
          <BudgetMeterCard b={m.budget} className="hidden lg:flex" />
          <ProteinCard protein={protein} plannedTypes={m.household?.plannedMealTypes ?? []} />
        </div>
      </div>

      <PlanItemSheet v={open} hid={m.hid} uid={s.user.uid} recipes={m.recipes} plannedMealTypes={m.household?.plannedMealTypes ?? []} onOpenChange={(o) => !o && setOpenItem(null)} />
    </PageBody>
  );
}

/** Suggestions arrive in M5 (scoring); until then the newest recipes not yet planned, each one tap from Create meal. */
function Suggested({ onAdd, plannedIds }: { onAdd: (id: string) => void; plannedIds: Set<string> }) {
  const summaries = useRecipeIndex();
  const list = (summaries ?? []).filter((r) => !plannedIds.has(r.id)).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 5);
  return (
    <section aria-labelledby="suggested-h" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="suggested-h" className="m-0 font-display text-[1.375rem] font-normal">
          Suggested
        </h2>
        <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">Newest first · scoring arrives in M5</span>
      </div>
      {list.map((r) => (
        <div key={r.id} className="flex items-stretch gap-3 rounded-ui border-bw bg-base p-2.5 shadow-hard">
          <Link to="/recipes/$id" params={{ id: r.id }} className="flex min-w-0 flex-1 items-center gap-3 text-ink no-underline">
            <span className="relative block size-16 flex-none overflow-hidden rounded-[calc(var(--r)*0.67)] border-2 border-line">
              <RecipeImage base={r.thumb} cuisine={r.cuisine} alt="" sizes="4rem" className="absolute inset-0" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-[0.9375rem] leading-tight font-extrabold">{r.title}</span>
              <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                {r.totalMin} min · {taxonomyLabel(r.cuisine)} · {formatProtein(r.proteinPerServingG, r.proteinApproximate)}
              </span>
            </span>
          </Link>
          <button type="button" onClick={() => onAdd(r.id)} aria-label={`Add ${r.title} to plan`} className="press grid w-11 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-acc text-xl font-extrabold text-onc shadow-hard-sm">
            +
          </button>
        </div>
      ))}
      {summaries && !list.length ? <EmptyState>Every recipe is already planned.</EmptyState> : null}
    </section>
  );
}

/** R6.17's shape: average protein per serving per planned meal type. Goals (R6.14) arrive in M5. */
function ProteinCard({ protein, plannedTypes }: { protein: Partial<Record<MealType, { avg: number; items: number }>>; plannedTypes: readonly string[] }) {
  const types = MEAL_TYPES.filter((t) => plannedTypes.includes(t) || protein[t]);
  return (
    <section aria-label="Protein per serving" className="flex flex-col gap-2.5 rounded-ui border-bw bg-base p-3.5 shadow-hard">
      <div className="flex justify-between font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">
        <span>Protein / serving</span>
        <span className="text-sub">Plan avg</span>
      </div>
      {types.map((t) => (
        <div key={t} className="flex items-center justify-between font-mono text-[0.6875rem] font-bold uppercase">
          <span>{MEAL_LABEL[t]}</span>
          <span>{protein[t] ? `${Math.round(protein[t]!.avg)} g` : "—"}</span>
        </div>
      ))}
      <span className="text-[0.75rem] font-semibold text-sub">Protein goals per meal type arrive with Preferences (M5).</span>
    </section>
  );
}
