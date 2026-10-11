// The History page (PRD R10.1–R10.3, R4.7; TECHNICAL_SPECS §12; prototype page "History"): everything cooked, with
// the date, meal and recipes (deleted titles marked), who cooked it, everyone's ratings, deviations from the recipe,
// and notes, through the shared <CollectionView>; stat tiles for most-cooked recipes, average rating by cuisine, and
// spend per period (the estimated cost of grocery lists confirmed as received in each period).
import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { collection } from "firebase/firestore";
import {
  applyCollection,
  avgRatingByCuisine,
  collectionSearchSchema,
  combineSummaries,
  deviations,
  eventAverage,
  formatCanonical,
  sidesLine,
  formatCents,
  formatPeriodRange,
  mostCooked,
  optionCount,
  SORT_LABELS,
  spendPerPeriod,
  tagCounts,
  taxonomyLabel,
  toSearchParams,
  type CollectionSearch,
  type HouseholdFacts,
  type PeriodDoc,
} from "@solving-food/core";
import { db } from "@/firebase/app";
import { EmptyState, PageBody } from "@/components/AppShell";
import { CollectionView } from "@/components/CollectionView";
import { Badge } from "@/components/ui/chip";
import { useActiveHousehold, useMemberNames } from "@/data/households";
import { useLiveQuery } from "@/data/live";
import { millis, useRecipeDocs } from "@/data/plan";
import { useCookEvents, useRatings, useReceivedLists, type StoredEvent } from "@/data/supply";
import { useIngredientsById } from "@/data/ingredients";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/history")({
  validateSearch: (s) => collectionSearchSchema.parse(s),
  component: HistoryPage,
});

const DAY_FMT = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });

function HistoryPage() {
  const s = useReadySession();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const hh = useActiveHousehold();
  const tz = hh.data?.timezone ?? "America/Toronto";
  const events = useCookEvents(hh.id);
  const ratings = useRatings(hh.id);
  const lists = useReceivedLists(hh.id);
  const periods = useLiveQuery<PeriodDoc>(collection(db, "households", hh.id, "periods"), `households/${hh.id}/periods`);
  const members = useMemberNames(hh.id);
  const summaries = useRecipeIndex();
  const byId = React.useMemo(() => new Map((summaries ?? []).map((r) => [r.id, r])), [summaries]);
  const evs = React.useMemo(() => (events.docs ?? []).map((d) => ({ id: d.id, e: d.data, at: millis(d.data.cookedAt) ?? 0 })), [events.docs]);

  // Recipes the index doesn't have: trashed or deleted (their titles live on the events, R4.26).
  const missingIds = React.useMemo(() => [...new Set(evs.flatMap((x) => x.e.recipeIds))].filter((id) => summaries && !byId.has(id)), [evs, byId, summaries]);
  const missingDocs = useRecipeDocs(missingIds);
  const statusOf = (id: string): "active" | "trashed" | "deleted" => (byId.has(id) ? "active" : missingDocs.get(id)?.status === "trashed" ? "trashed" : "deleted");

  const ratingsBy = React.useMemo(() => {
    const m = new Map<string, Array<{ uid: string; score: number; targetType: string; targetId: string; cookEventId: string }>>();
    for (const r of ratings.docs ?? []) m.set(r.data.cookEventId, [...(m.get(r.data.cookEventId) ?? []), r.data]);
    return m;
  }, [ratings.docs]);

  // Sides as cooked (R5.9): named on the row and searchable.
  const sideIds = React.useMemo(() => [...new Set(evs.flatMap((x) => (x.e.sides ?? []).map((s) => s.ingredientId)))], [evs]);
  const sideIngredients = useIngredientsById(sideIds);
  const sideName = React.useCallback((id: string) => sideIngredients.get(id)?.name, [sideIngredients]);
  const rows = React.useMemo(
    () =>
      evs.map((x) => {
        const row = combineSummaries(x.id, x.e.title ?? x.e.titles.join(" + "), x.e.recipeIds.map((recipeId) => ({ recipeId, servingsMultiplier: 1 })), (id) => byId.get(id), x.at, x.e.mealType ? [x.e.mealType] : [], { sides: x.e.sides, sideName });
        // Search finds events by their recipe titles too, deleted ones included.
        row.ingredientNames = [...row.ingredientNames, ...x.e.titles];
        return row;
      }),
    [evs, byId, sideName],
  );
  const factsOf = React.useCallback(
    (id: string): HouseholdFacts => {
      const x = evs.find((v) => v.id === id);
      return { favourite: false, timesCooked: 1, lastCookedAtMs: x?.at ?? null, rating: eventAverage((ratingsBy.get(id) ?? []) as never) };
    },
    [evs, ratingsBy],
  );
  const matches = React.useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    if (!q) return null;
    return new Map(rows.filter((r) => [r.title, ...r.ingredientNames, ...r.tags].some((t) => t.toLowerCase().includes(q))).map((r) => [r.id, 1]));
  }, [rows, search.q]);
  // History defaults to newest first ("Recently cooked"); Suggested makes no sense here.
  const effective = React.useMemo(() => ({ ...search, sort: search.sort && search.sort !== "suggested" ? search.sort : ("recent" as const) }), [search]);
  const result = React.useMemo(() => applyCollection(rows, effective, factsOf, matches), [rows, effective, factsOf, matches]);
  const tags = React.useMemo(() => tagCounts(rows), [rows]);
  const onSearchChange = React.useCallback((next: CollectionSearch, opts?: { replace?: boolean }) => void navigate({ to: "/history", search: toSearchParams(next) as never, replace: opts?.replace ?? false }), [navigate]);

  // Stats (R10.3).
  const most = mostCooked(evs.map((x) => ({ id: x.id, recipeIds: x.e.recipeIds, titles: x.e.titles, cookedAtMs: x.at })), 5);
  const byCuisine = avgRatingByCuisine(
    (ratings.docs ?? []).map((r) => r.data),
    (id) => byId.get(id)?.cuisine ?? missingDocs.get(id)?.cuisine,
  );
  const spend = spendPerPeriod(
    (lists.docs ?? []).map((l) => ({ receivedAtMs: millis(l.data.receivedAt) ?? 0, cents: l.data.receivedCents ?? Object.values(l.data.items).reduce((a, it) => a + (it.estPriceCents ?? 0), 0) })),
    (periods.docs ?? []).map((p) => ({ id: p.id, startMs: millis(p.data.start) ?? 0, endMs: millis(p.data.end) ?? 0, budgetCents: p.data.budgetCents })),
  ).slice(-6);

  const devIds = React.useMemo(() => [...new Set(evs.flatMap((x) => (x.e.reviewStatus === "done" ? deviations(x.e.defaults ?? [], x.e.used).map((d) => d.ingredientId) : [])))], [evs]);
  const devIngredients = useIngredientsById(devIds);
  const viewById = new Map(evs.map((x) => [x.id, x]));
  const fmt = DAY_FMT(tz);

  return (
    <PageBody className="max-w-[80rem]">
      <CollectionView
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Search what you cooked…"
        noun="meals"
        countFor={(x) => applyCollection(rows, { ...x, sort: "recent" }, factsOf, x.q === search.q ? matches : null).items.length}
        optionCount={(key, value) => optionCount(rows, effective, factsOf, matches, key, value)}
        tags={tags}
        hide={["show", "tools", "cost", "supply"]}
      >
          <div className="flex flex-col gap-3.5">
            <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">History</h1>
            <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              <StatTile title="Most cooked" testId="stat-most-cooked">
                {most.length ? (
                  most.map((m) => (
                    <Bar key={m.recipeId} label={m.title + (statusOf(m.recipeId) === "deleted" ? " (deleted)" : "")} value={`${m.count}×`} fraction={m.count / (most[0]?.count ?? 1)} />
                  ))
                ) : (
                  <Empty />
                )}
              </StatTile>
              <StatTile title="Avg rating by cuisine" testId="stat-cuisine">
                {byCuisine.length ? byCuisine.map((c) => <Bar key={c.cuisine} label={taxonomyLabel(c.cuisine)} value={c.avg.toFixed(1)} fraction={c.avg / 10} teal inline />) : <Empty />}
              </StatTile>
              <StatTile title={`Spend per period${hh.data ? ` · budget ${formatCents(hh.data.budgetCents)}` : ""}`} testId="stat-spend">
                {spend.length ? (
                  spend.map((p) => (
                    <Bar key={p.id} label={formatPeriodRange(p.startMs, p.endMs, tz)} value={formatCents(p.cents)} fraction={p.budgetCents ? Math.min(1, p.cents / p.budgetCents) : 0} over={p.budgetCents > 0 && p.cents > p.budgetCents} inline mono />
                  ))
                ) : (
                  <Empty />
                )}
                <span className="text-[0.6875rem] font-semibold text-sub">Estimated cost of the groceries confirmed as received in each period.</span>
              </StatTile>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="m-0 font-display text-[1.375rem] font-normal">Cooked</h2>
              <span className="font-mono text-[0.65625rem] font-bold uppercase" data-testid="history-count">
                {events.docs === undefined ? "Loading…" : `${result.items.length} ${result.items.length === 1 ? "entry" : "entries"} · ${SORT_LABELS[effective.sort]}`}
              </span>
            </div>
          </div>
        {events.docs !== undefined && !evs.length ? (
          <EmptyState>Nothing cooked yet in this household. Cook a planned meal and it shows up here.</EmptyState>
        ) : events.docs !== undefined && !result.items.length ? (
          <EmptyState>Nothing matches these filters.</EmptyState>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Cooked">
            {result.items.map((r) => {
              const x = viewById.get(r.id)!;
              return <HistoryRow key={r.id} id={r.id} e={x.e} at={x.at} fmt={fmt} uid={s.user.uid} members={members} ratings={ratingsBy.get(r.id) ?? []} statusOf={statusOf} sides={sidesLine(x.e.sides, sideName)} ingredientName={(id) => devIngredients.get(id)?.name ?? sideIngredients.get(id)?.name ?? id.replace(/-/g, " ")} unitOf={(id) => ({ u: devIngredients.get(id)?.canonicalUnit ?? "g", w: devIngredients.get(id)?.unitWeightG })} />;
            })}
          </ol>
        )}
      </CollectionView>
    </PageBody>
  );
}

function StatTile({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-ui border-bw bg-base p-3.5 shadow-hard" data-testid={testId}>
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem] uppercase">{title}</span>
      {children}
    </section>
  );
}

function Empty() {
  return <span className="text-[0.8125rem] font-semibold text-sub">Nothing yet.</span>;
}

function Bar({ label, value, fraction, teal, inline, over, mono }: { label: string; value: string; fraction: number; teal?: boolean; inline?: boolean; over?: boolean; mono?: boolean }) {
  const bar = (
    <span className="block h-3 flex-1 overflow-hidden rounded-sm border-2 border-line bg-mantle" aria-hidden>
      <span className={cn("block h-full", over ? "bg-red" : teal ? "bg-[#8bd5ca]" : "bg-acc")} style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
    </span>
  );
  if (inline)
    return (
      <div className="flex items-center gap-2.5">
        <span className={cn("w-[7.5rem] flex-none truncate text-[0.8125rem] font-bold", mono && "font-mono text-[0.6875rem] uppercase")}>{label}</span>
        {bar}
        <span className="w-12 flex-none text-right font-mono text-[0.75rem] font-extrabold">{value}</span>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-[0.8125rem] font-bold">
        <span className="truncate">{label}</span>
        <span className="font-mono font-extrabold">{value}</span>
      </div>
      {bar}
    </div>
  );
}

function HistoryRow({
  id,
  e,
  at,
  fmt,
  uid,
  members,
  ratings,
  statusOf,
  ingredientName,
  unitOf,
  sides,
}: {
  /** "french fries, frozen peas" (R5.9). */
  sides: string;
  id: string;
  e: StoredEvent;
  at: number;
  fmt: Intl.DateTimeFormat;
  uid: string;
  members: Map<string, string>;
  ratings: Array<{ uid: string; score: number; targetType: string; targetId: string }>;
  statusOf: (id: string) => "active" | "trashed" | "deleted";
  ingredientName: (id: string) => string;
  unitOf: (id: string) => { u: string; w?: number | undefined };
}) {
  const avg = eventAverage(ratings as never);
  const byWho = new Map<string, number[]>();
  for (const r of ratings) byWho.set(r.uid, [...(byWho.get(r.uid) ?? []), r.score]);
  const devs = e.reviewStatus === "done" ? deviations(e.defaults ?? [], e.used) : [];
  const mineMissing = !byWho.has(uid);
  const name = (who: string) => (members.get(who) ?? "Someone").toUpperCase();
  const multi = e.recipeIds.length > 1;
  return (
    <li className="flex items-start gap-3 rounded-ui border-bw bg-base p-3 shadow-hard" data-testid="history-row" aria-label={e.title ?? e.titles.join(" + ")}>
      <span className={cn("grid size-[3.25rem] flex-none place-items-center rounded-ui border-2 border-line font-mono text-[1.125rem] font-extrabold", avg === null ? "bg-mantle" : avg >= 9 ? "bg-acc text-onc" : "bg-[#8bd5ca] text-onc")} aria-label={avg === null ? "Not rated" : `Average rating ${avg.toFixed(1)}`}>
        {avg === null ? "–" : avg.toFixed(1)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="font-mono text-[0.625rem] font-bold uppercase">{fmt.format(at)}</span>
        <span className="text-[1rem] leading-tight font-extrabold">{e.title ?? e.titles.join(" + ")}</span>
        {sides && !(e.title ?? "").toLowerCase().includes(sides.toLowerCase()) ? (
          <span className="font-mono text-[0.625rem] font-bold uppercase" data-testid="history-sides">
            With {sides}
          </span>
        ) : null}
        {multi || e.recipeIds.some((r) => statusOf(r) !== "active") ? (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[0.75rem] font-semibold">
            {e.recipeIds.map((rid, i) => {
              const st = statusOf(rid);
              const t = e.titles[i] ?? "Recipe";
              return st === "deleted" ? (
                <span key={rid} className="text-sub">
                  {t} (deleted)
                </span>
              ) : (
                <Link key={rid} to="/recipes/$id" params={{ id: rid }} className="text-ink">
                  {t}
                  {st === "trashed" ? " (in Trash)" : ""}
                </Link>
              );
            })}
          </span>
        ) : null}
        <span className="flex flex-wrap gap-1">
          <Badge className="bg-base uppercase">{e.savedMealId ? "Meal · " : ""}Cooked by {name(e.cookedBy)}</Badge>
          {[...byWho].map(([who, scores]) => (
            <Badge key={who} className="bg-s0 uppercase">
              {name(who)} {Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10}
            </Badge>
          ))}
          {e.reviewStatus === "pending" ? (
            <Badge className="bg-yellow text-onc uppercase">Not reviewed yet</Badge>
          ) : devs.length ? (
            devs.slice(0, 4).map((d) => {
              const u = unitOf(d.ingredientId);
              return (
                <Badge key={d.ingredientId} className="bg-peach-soft text-onc uppercase">
                  {d.delta > 0 ? "+" : "−"}
                  {formatCanonical(Math.abs(d.delta), u.u, u.w)} {ingredientName(d.ingredientId)}
                </Badge>
              );
            })
          ) : (
            <Badge className="bg-base uppercase">As written</Badge>
          )}
          {mineMissing && e.reviewStatus === "done" ? <Badge className="bg-yellow text-onc uppercase">Your rating missing</Badge> : null}
          {e.leftoverPortions ? <Badge className="bg-[color-mix(in_srgb,#c6a0f6_55%,white)] text-[#4c4f69] uppercase">{e.leftoverPortions} leftover{e.leftoverPortions === 1 ? "" : "s"}</Badge> : null}
        </span>
        {e.note ? <span className="text-[0.8125rem] font-semibold text-sub">“{e.note}”</span> : null}
      </span>
      {e.reviewStatus === "pending" || mineMissing ? (
        <Link to="/review/$eventId" params={{ eventId: id }} className="press flex-none self-center rounded-ui border-2 border-line bg-acc px-3 py-2 text-[0.8125rem] font-extrabold text-onc no-underline shadow-hard-sm">
          {e.reviewStatus === "pending" ? "Review" : "Rate"}
        </Link>
      ) : null}
    </li>
  );
}
