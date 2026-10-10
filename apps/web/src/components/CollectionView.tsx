// <CollectionView> (TECHNICAL_SPECS §12, PRD R4.2, R4.7): the shared search box, filter-and-sort sheet, and applied-
// filter chips for every list of recipes or meals (Recipes and Meals now; Plan and History later). Filter state lives
// in the URL. The page computes the results (core `applyCollection`) and renders them as children.
import * as React from "react";
import {
  ACTIVE_TIME_STEPS,
  activeFilterCount,
  CUISINES,
  MAIN_PROTEINS,
  MEAL_TYPES,
  PROTEIN_STEPS,
  RATING_STEPS,
  SORT_LABELS,
  SORTS,
  taxonomyLabel,
  TOTAL_TIME_STEPS,
  UNAVAILABLE_SORTS,
  type CollectionSearch,
  type CollectionSort,
  type FilterKey,
} from "@solving-food/core";
import { cn } from "@/lib/utils";
import { SectionLabel, ToggleChip } from "./ui/chip";
import { Sheet, SheetContent } from "./ui/sheet";
import { Input } from "./ui/input";

export interface CollectionViewProps {
  search: CollectionSearch;
  onSearchChange: (next: CollectionSearch, opts?: { replace?: boolean }) => void;
  placeholder: string;
  /** "recipes" / "meals": used in the apply button ("Show 14 recipes"). */
  noun: string;
  /** How many items a (draft) filter state would show. */
  countFor: (s: CollectionSearch) => number;
  /** How many items one option would show with the other current filters. */
  optionCount?: (key: FilterKey, value: unknown) => number;
  tags?: Array<[string, number]>;
  children?: React.ReactNode;
  /** Extra content between the search bar and the results (segment, banners). */
  header?: React.ReactNode;
}

type Draft = CollectionSearch;

function toggleIn<T extends string>(list: readonly T[] | undefined, v: T): T[] | undefined {
  const has = list?.includes(v);
  const next = has ? list!.filter((x) => x !== v) : [...(list ?? []), v];
  return next.length ? next : undefined;
}

/** Chips for the applied filters, each removable. */
function appliedChips(s: CollectionSearch): Array<{ key: string; label: string; remove: (s: CollectionSearch) => CollectionSearch }> {
  const out: Array<{ key: string; label: string; remove: (s: CollectionSearch) => CollectionSearch }> = [];
  for (const k of ["cuisine", "protein", "meal", "tags"] as const) {
    for (const v of s[k] ?? []) out.push({ key: `${k}:${v}`, label: taxonomyLabel(v), remove: (x) => ({ ...x, [k]: toggleIn(x[k] as string[] | undefined, v) }) });
  }
  if (s.fav) out.push({ key: "fav", label: "★ Favourites", remove: (x) => ({ ...x, fav: undefined }) });
  if (s.cooked) out.push({ key: "cooked", label: s.cooked === "before" ? "Cooked before" : "Never cooked", remove: (x) => ({ ...x, cooked: undefined }) });
  if (s.minProtein) out.push({ key: "minProtein", label: `≥ ${s.minProtein} g protein`, remove: (x) => ({ ...x, minProtein: undefined }) });
  if (s.maxTotal) out.push({ key: "maxTotal", label: `≤ ${s.maxTotal} min total`, remove: (x) => ({ ...x, maxTotal: undefined }) });
  if (s.maxActive) out.push({ key: "maxActive", label: `≤ ${s.maxActive} min active`, remove: (x) => ({ ...x, maxActive: undefined }) });
  if (s.minRating) out.push({ key: "minRating", label: `★ ${s.minRating}+`, remove: (x) => ({ ...x, minRating: undefined }) });
  return out;
}

function FilterIcon() {
  return (
    <span aria-hidden className="flex flex-col items-center gap-1">
      <span className="block h-[3px] w-[1.375rem] bg-onc" />
      <span className="block h-[3px] w-[0.9375rem] bg-onc" />
      <span className="block h-[3px] w-2 bg-onc" />
    </span>
  );
}

export function CollectionView(p: CollectionViewProps) {
  const { search, onSearchChange } = p;
  const urlQ = search.q ?? "";
  const [q, setQ] = React.useState(urlQ);
  const [seenUrlQ, setSeenUrlQ] = React.useState(urlQ);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(search);

  // The URL changed elsewhere (Back, a cleared filter): follow it.
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    setQ(urlQ);
  }
  // Typing updates the URL after a short pause (replace, so Back isn't flooded).
  React.useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => onSearchChange({ ...search, q: q || undefined }, { replace: true }), 200);
    return () => clearTimeout(t);
  }, [q, urlQ, search, onSearchChange]);

  const n = activeFilterCount(search);
  const chips = appliedChips(search);
  const openSheet = () => {
    setDraft(search);
    setOpen(true);
  };
  const apply = () => {
    onSearchChange({ ...draft, q: search.q });
    setOpen(false);
  };
  const count = (key: FilterKey, value: unknown) => p.optionCount?.(key, value);
  const sort = draft.sort ?? "suggested";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-2.5 bg-pg px-4 pt-1 pb-2 md:static md:mx-0 md:px-0 md:pt-0 md:pb-0">
        {p.header}
        <div className="flex max-w-[60rem] items-stretch gap-2.5">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={p.placeholder}
            aria-label={p.placeholder}
            className="flex-1"
          />
          <button
            type="button"
            onClick={openSheet}
            aria-label={n ? `Filter and sort, ${n} filters on` : "Filter and sort"}
            className="press relative grid w-[3.25rem] flex-none cursor-pointer place-items-center rounded-ui border-bw bg-acc shadow-hard"
          >
            <FilterIcon />
            {n ? (
              <span className="absolute -top-[0.5625rem] -right-[0.5625rem] box-border h-[1.375rem] min-w-[1.375rem] rounded-full border-2 border-line bg-ink px-1 text-center font-mono text-[0.6875rem] leading-[1.125rem] font-extrabold text-base">
                {n}
              </span>
            ) : null}
          </button>
        </div>
        {chips.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Applied filters">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onSearchChange(c.remove(search))}
                aria-label={`Remove filter ${c.label}`}
                className="flex flex-none cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line bg-acc px-2 py-1.5 text-xs font-extrabold whitespace-nowrap text-onc"
              >
                {c.label}
                <span aria-hidden className="font-mono">
                  ✕
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => onSearchChange({ q: search.q, sort: search.sort })}
              className="cursor-pointer bg-transparent px-1 py-1.5 text-xs font-extrabold text-ink underline"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {p.children}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title="Filter & sort"
          headerExtra={
            <button type="button" onClick={() => setDraft({ q: search.q })} className="cursor-pointer bg-transparent p-1.5 text-[0.8125rem] font-extrabold text-ink underline">
              Reset
            </button>
          }
          footer={
            <button
              type="button"
              onClick={apply}
              className="press w-full cursor-pointer rounded-ui border-bw bg-acc p-4 text-[1rem] font-extrabold text-onc shadow-hard"
            >
              Show {p.countFor({ ...draft, q: search.q })} {p.noun}
            </button>
          }
        >
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 p-0">
              <SectionLabel>Sort by</SectionLabel>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {SORTS.map((s: CollectionSort) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={sort === s}
                  onClick={() => setDraft((d) => ({ ...d, sort: s === "suggested" ? undefined : s }))}
                  className={cn(
                    "flex cursor-pointer justify-between rounded-ui border-2 border-line px-2 py-[0.6875rem] text-left text-[0.8125rem] font-extrabold",
                    sort === s ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm",
                  )}
                >
                  <span>{SORT_LABELS[s]}</span>
                  <span aria-hidden>{sort === s ? "●" : ""}</span>
                </button>
              ))}
              {UNAVAILABLE_SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  disabled
                  title={s.reason}
                  className="flex cursor-not-allowed flex-col rounded-ui border-2 border-dashed border-line bg-base px-2 py-1.5 text-left text-[0.8125rem] font-extrabold text-ink opacity-60"
                >
                  <span>{s.label}</span>
                  <span className="font-mono text-[0.5625rem] font-bold uppercase">{s.reason}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <Group title="Show" hint="Match all">
            <ToggleChip pressed={!!draft.fav} onClick={() => setDraft((d) => ({ ...d, fav: d.fav ? undefined : true }))} count={count("fav", true)}>
              ★ Favourites
            </ToggleChip>
            <ToggleChip pressed={draft.cooked === "before"} onClick={() => setDraft((d) => ({ ...d, cooked: d.cooked === "before" ? undefined : "before" }))} count={count("cooked", "before")}>
              Cooked before
            </ToggleChip>
            <ToggleChip pressed={draft.cooked === "never"} onClick={() => setDraft((d) => ({ ...d, cooked: d.cooked === "never" ? undefined : "never" }))} count={count("cooked", "never")}>
              Never cooked
            </ToggleChip>
            {["Can make", "Use what's left", "Uses expiring"].map((l) => (
              <ToggleChip key={l} pressed={false} disabled title="Available once Supply arrives (M3)" className="border-dashed shadow-none">
                {l}
              </ToggleChip>
            ))}
            <p className="m-0 w-full font-mono text-[0.625rem] font-bold text-sub uppercase">Supply filters arrive with Supply (M3)</p>
          </Group>

          <Group title="Total time" hint={draft.maxTotal ? `≤ ${draft.maxTotal} min` : "Any"}>
            {TOTAL_TIME_STEPS.map((m) => (
              <ToggleChip key={m} pressed={draft.maxTotal === m} onClick={() => setDraft((d) => ({ ...d, maxTotal: d.maxTotal === m ? undefined : m }))} count={count("maxTotal", m)}>
                ≤ {m} min
              </ToggleChip>
            ))}
          </Group>

          <Group title="Active time" hint={draft.maxActive ? `≤ ${draft.maxActive} min` : "Any"}>
            {ACTIVE_TIME_STEPS.map((m) => (
              <ToggleChip key={m} pressed={draft.maxActive === m} onClick={() => setDraft((d) => ({ ...d, maxActive: d.maxActive === m ? undefined : m }))} count={count("maxActive", m)}>
                ≤ {m} min
              </ToggleChip>
            ))}
          </Group>

          <Group title="Protein per serving" hint={draft.minProtein ? `≥ ${draft.minProtein} g` : "Any"}>
            {PROTEIN_STEPS.map((g) => (
              <ToggleChip key={g} pressed={draft.minProtein === g} onClick={() => setDraft((d) => ({ ...d, minProtein: d.minProtein === g ? undefined : g }))} count={count("minProtein", g)}>
                ≥ {g} g
              </ToggleChip>
            ))}
          </Group>

          <Group title="Cost per serving" hint="Prices arrive in M2">
            {["≤ $2", "≤ $4", "≤ $6"].map((l) => (
              <ToggleChip key={l} pressed={false} disabled title="Needs prices (M2)" className="border-dashed shadow-none">
                {l}
              </ToggleChip>
            ))}
          </Group>

          <Group title="Household rating" hint={draft.minRating ? `★ ${draft.minRating}+` : "Any"}>
            {RATING_STEPS.map((r) => (
              <ToggleChip key={r} pressed={draft.minRating === r} onClick={() => setDraft((d) => ({ ...d, minRating: d.minRating === r ? undefined : r }))} count={count("minRating", r)}>
                ★ {r}+
              </ToggleChip>
            ))}
          </Group>

          <Group title="Cuisine" hint={draft.cuisine?.length ? `${draft.cuisine.length} on` : "Any"}>
            {CUISINES.map((c) => {
              const k = count("cuisine", c);
              if (k === 0 && !draft.cuisine?.includes(c)) return null;
              return (
                <ToggleChip key={c} pressed={!!draft.cuisine?.includes(c)} onClick={() => setDraft((d) => ({ ...d, cuisine: toggleIn(d.cuisine, c) }))} count={k}>
                  {taxonomyLabel(c)}
                </ToggleChip>
              );
            })}
          </Group>

          <Group title="Main protein" hint={draft.protein?.length ? `${draft.protein.length} on` : "Any"}>
            {MAIN_PROTEINS.map((m) => {
              const k = count("protein", m);
              if (k === 0 && !draft.protein?.includes(m)) return null;
              return (
                <ToggleChip key={m} pressed={!!draft.protein?.includes(m)} onClick={() => setDraft((d) => ({ ...d, protein: toggleIn(d.protein, m) }))} count={k}>
                  {taxonomyLabel(m)}
                </ToggleChip>
              );
            })}
          </Group>

          <Group title="Meal type" hint={draft.meal?.length ? `${draft.meal.length} on` : "Any"}>
            {MEAL_TYPES.map((m) => (
              <ToggleChip key={m} pressed={!!draft.meal?.includes(m)} onClick={() => setDraft((d) => ({ ...d, meal: toggleIn(d.meal, m) }))} count={count("meal", m)}>
                {taxonomyLabel(m)}
              </ToggleChip>
            ))}
          </Group>

          {p.tags?.length ? (
            <Group title="Tags" hint={draft.tags?.length ? `${draft.tags.length} on` : "Any"}>
              {p.tags.map(([t]) => (
                <ToggleChip key={t} pressed={!!draft.tags?.includes(t)} onClick={() => setDraft((d) => ({ ...d, tags: toggleIn(d.tags, t) }))} count={count("tags", t)}>
                  {taxonomyLabel(t)}
                </ToggleChip>
              ))}
            </Group>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2.5">
      <SectionLabel id={id} hint={hint}>
        {title}
      </SectionLabel>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
