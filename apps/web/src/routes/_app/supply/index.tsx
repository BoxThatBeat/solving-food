// The Supply page (PRD R8.1–R8.15; TECHNICAL_SPECS §6, §12; prototype page "Supply"). Each ingredient as
// `current (projected)` in metric and imperial, where projected = unexpired − what the period's uncooked meals use;
// location tabs and category / expiring soon / low stock filters; expired lots prompt Still good / Threw it out;
// leftovers as prepared portions; free-use staples with when they were last bought. Tapping a row opens its purchases,
// correction, and history inline (the full history is /supply/:id).
import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  expectedRunOut,
  isLowStock,
  packToCanonical,
  recomputeAmount,
  STORAGE_LOCATIONS,
  taxonomyLabel,
  unexpiredAmount,
  type StorageLocation,
} from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { AddSupplySheet } from "@/components/supply/AddSupplySheet";
import { ExpiredLotPrompts } from "@/components/supply/ExpiredLotPrompt";
import { SupplyDetail } from "@/components/supply/SupplyDetail";
import { ExpiryBadge } from "@/components/supply/shared";
import { amountText, dateText, expiredEntries, itemExpiry, LOCATION_LABEL, shortAmount, unitFor } from "@/components/supply/format";
import { usePlanModel } from "@/data/planModel";
import { FREE_USE, sendCommand, useCadence, type SupplyItem } from "@/data/supply";
import { useIngredientsById, type IngredientEntry } from "@/data/ingredients";
import { useMemberNames } from "@/data/households";
import { millis } from "@/data/plan";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  loc: z.enum(["all", ...STORAGE_LOCATIONS]).catch("all").optional(),
  cat: z.string().max(40).catch("").optional(),
  exp: z.coerce.boolean().catch(false).optional(),
  low: z.coerce.boolean().catch(false).optional(),
});
type SupplySearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_app/supply/")({
  validateSearch: (s) => searchSchema.parse(s),
  component: SupplyPage,
});

interface Row {
  item: SupplyItem;
  ing: IngredientEntry | undefined;
  current: number;
  unexpired: number;
  projected: number;
  needed: number;
  locations: Set<StorageLocation>;
  category: string;
  exp: ReturnType<typeof itemExpiry>;
  low: boolean;
}

const SEVERITY = { expired: 0, soon: 1, fresh: 2, none: 3 } as const;

function SupplyPage() {
  const s = useReadySession();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const notify = useNotify();
  const m = usePlanModel();
  const tz = m.household?.timezone ?? "America/Toronto";
  const now = m.supply.now;
  const members = useMemberNames(m.hid);
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const set = (patch: Partial<SupplySearch>) => void navigate({ to: "/supply", search: { ...search, ...patch } as never, replace: true });

  const ingredients = m.supply.ingredients;
  const rows: Row[] = React.useMemo(() => {
    const out: Row[] = [];
    for (const item of m.supply.items.values()) {
      if (!item.ingredientId) continue;
      const ing = ingredients.get(item.ingredientId);
      const current = recomputeAmount(item.lots);
      const unexpired = unexpiredAmount(item.lots, now);
      const projected = m.projected.get(item.ingredientId) ?? unexpired;
      const pack = ing?.defaultPackAmount && ing.defaultPackMeasure ? packToCanonical(ing.defaultPackAmount, ing.defaultPackMeasure, ing) : null;
      out.push({
        item,
        ing,
        current,
        unexpired,
        projected,
        needed: unexpired - projected,
        locations: new Set(item.lots.map((l) => l.location)),
        category: ing?.category ?? "other",
        exp: itemExpiry(item.lots, now, tz),
        low: isLowStock(unexpired, pack, projected),
      });
    }
    return out.sort((a, b) => SEVERITY[a.exp.flag] - SEVERITY[b.exp.flag] || (a.exp.expiresMs ?? Infinity) - (b.exp.expiresMs ?? Infinity) || a.item.label.localeCompare(b.item.label));
  }, [m.supply.items, ingredients, m.projected, now, tz]);

  const leftovers = [...m.supply.items.values()].filter((i) => !i.ingredientId && recomputeAmount(i.lots) > 1e-6);
  const inStock = rows.filter((r) => r.current > 1e-6);
  const shown = rows.filter((r) => {
    if (!search.low && r.current <= 1e-6) return false;
    const loc = search.loc ?? "all";
    if (loc !== "all" && !r.locations.has(loc)) return false;
    if (search.cat && r.category !== search.cat) return false;
    if (search.exp && !(r.exp.flag === "expired" || r.exp.flag === "soon")) return false;
    if (search.low && !r.low) return false;
    return true;
  });
  const cats = [...new Set(inStock.map((r) => r.category))].sort();
  const soon = inStock.filter((r) => r.exp.flag === "soon" || r.exp.flag === "expired").length;
  const expired = expiredEntries(m.supply.items.values(), now, (it) => unitFor(it, it.ingredientId ? ingredients.get(it.ingredientId) : undefined));

  // Staples (R8.14): free-use ingredients the household has bought, with the cadence's expected run-out.
  const cadence = useCadence(m.hid);
  const stapleIds = (cadence.docs ?? []).map((d) => d.id).filter((id) => FREE_USE.has(id) || ingredients.get(id)?.freeUse);
  const stapleIngs = useIngredientsById(stapleIds);
  const staples = (cadence.docs ?? [])
    .filter((d) => stapleIds.includes(d.id))
    .map((d) => {
      const ing = stapleIngs.get(d.id);
      const last = millis(d.data.lastPurchasedAt);
      const runOut = expectedRunOut({ avgIntervalDays: d.data.avgIntervalDays ?? null, lastPurchasedAtMs: last, purchaseCount: d.data.purchaseCount ?? 1 }, ing?.defaultCadenceDays);
      return { id: d.id, name: ing?.name ?? d.id.replace(/-/g, " "), last, runOut };
    })
    .sort((a, b) => (a.runOut ?? Infinity) - (b.runOut ?? Infinity));

  const ateOne = (item: SupplyItem) => {
    const planned = m.items.find((i) => i.data.kind === "leftover" && i.data.leftoverSupplyId === item.id && i.data.status === "planned");
    if (planned) sendCommand(m.hid, s.user.uid, "markEaten", { planItemId: planned.id });
    else sendCommand(m.hid, s.user.uid, "correctSupply", { supplyId: item.id, target: Math.max(0, recomputeAmount(item.lots) - 1), note: "ate one" });
    notify({ kind: "success", message: `Ate a portion of ${item.label}` });
  };

  return (
    <PageBody className="max-w-[68.75rem]">
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="kicker" data-testid="supply-count">
            {m.supply.loading ? "LOADING…" : `${inStock.length} IN SUPPLY${soon ? ` · ${soon} USE SOON` : ""}${m.supply.pendingCount ? " · SYNCING" : ""}`}
          </span>
          <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">Supply</h1>
        </div>
        <Button onClick={() => setAdding(true)}>+ Add</Button>
      </div>
      <span className="font-mono text-[0.65625rem] leading-snug font-semibold uppercase">Now (after planned meals) · bought − cooked ± corrections · tap for detail</span>

      <div role="group" aria-label="Location" className="grid grid-cols-5 overflow-hidden rounded-ui border-2 border-line bg-base">
        {(["all", ...STORAGE_LOCATIONS] as const).map((l, i) => {
          const on = (search.loc ?? "all") === l;
          return (
            <button key={l} type="button" aria-pressed={on} onClick={() => set({ loc: l })} className={cn("min-h-10 min-w-0 cursor-pointer truncate px-0.5 text-[0.75rem] font-extrabold", i ? "border-l-2 border-line" : "", on ? "bg-acc text-onc" : "bg-base text-ink")}>
              {l === "all" ? "All" : LOCATION_LABEL[l]}
            </button>
          );
        })}
      </div>
      <div role="group" aria-label="Filters" className="flex flex-wrap gap-1.5">
        <FilterChip on={!!search.exp} onClick={() => set({ exp: !search.exp })}>
          Expiring soon
        </FilterChip>
        <FilterChip on={!!search.low} onClick={() => set({ low: !search.low })}>
          Low stock
        </FilterChip>
        {cats.map((c) => (
          <FilterChip key={c} on={search.cat === c} onClick={() => set({ cat: search.cat === c ? "" : c })}>
            {taxonomyLabel(c)}
          </FilterChip>
        ))}
      </div>

      <ExpiredLotPrompts entries={expired} hid={m.hid} uid={s.user.uid} tz={tz} nowMs={now} />

      {leftovers.length ? (
        <section aria-label="Leftovers" className="overflow-hidden rounded-ui border-bw bg-base shadow-hard">
          <div className="border-b-2 border-line bg-[#c6a0f6] px-3 py-1.5 font-mono text-[0.625rem] font-bold tracking-[0.0625rem] text-[#4c4f69]">LEFTOVERS · PREPARED PORTIONS</div>
          {leftovers.map((lo, i) => {
            const n = recomputeAmount(lo.lots);
            const e = itemExpiry(lo.lots, now, tz);
            return (
              <div key={lo.id} className={cn("flex items-center gap-2.5 px-3 py-2.5", i && "border-t-2 border-line")} data-testid="leftover-row">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[0.9375rem] font-extrabold">{lo.label}</span>
                  <span className="font-mono text-[0.65625rem] font-semibold text-sub uppercase">
                    {amountText(n, { canonicalUnit: "count", portions: true })}
                    {e.expiresMs ? ` · use by ${dateText(e.expiresMs - 1, tz)}` : ""}
                  </span>
                </span>
                <ExpiryBadge flag={e.flag} expiresMs={e.expiresMs} frozen={e.frozenOnly} nowMs={now} tz={tz} />
                <span className="font-mono text-[0.9375rem] font-extrabold">×{Math.round(n * 10) / 10}</span>
                <Button size="sm" variant="secondary" className="shadow-hard-sm" onClick={() => ateOne(lo)} aria-label={`Ate one portion of ${lo.label}`}>
                  Ate one
                </Button>
              </div>
            );
          })}
        </section>
      ) : null}

      {m.supply.loading ? null : shown.length ? (
        <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0 shadow-hard" aria-label="Supply">
          {shown.map((r, i) => (
            <SupplyRow key={r.item.id} r={r} first={i === 0} open={open === r.item.id} onToggle={() => setOpen(open === r.item.id ? null : r.item.id)} tz={tz} now={now}>
              <SupplyDetail item={r.item} ingredient={r.ing} hid={m.hid} uid={s.user.uid} tz={tz} nowMs={now} members={members} ledgerLimit={5} />
            </SupplyRow>
          ))}
        </ul>
      ) : (
        <EmptyState>{rows.length || leftovers.length ? "Nothing matches these filters." : "Supply starts empty. Add what you already have, or confirm a grocery order when it arrives."}</EmptyState>
      )}

      {staples.length ? (
        <section aria-labelledby="staples-h" className="flex flex-col gap-2">
          <h2 id="staples-h" className="m-0 font-display text-[1.375rem] font-normal">
            Staples
          </h2>
          <span className="text-[0.75rem] font-semibold text-sub">Used freely, so not tracked by amount. The app learns how long each lasts.</span>
          <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0 shadow-hard" data-testid="staples">
            {staples.map((st, i) => (
              <li key={st.id} className={cn("flex items-center justify-between gap-2 px-3 py-2.5", i && "border-t-2 border-line")}>
                <span className="text-[0.9375rem] font-extrabold">{st.name.charAt(0).toUpperCase() + st.name.slice(1)}</span>
                <span className="text-right font-mono text-[0.65625rem] font-semibold uppercase">
                  {st.last ? `Bought ${dateText(st.last, tz)}` : ""}
                  {st.runOut ? ` · ${st.runOut <= now ? "probably out" : `runs out ~${dateText(st.runOut, tz)}`}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AddSupplySheet open={adding} onOpenChange={setAdding} hid={m.hid} uid={s.user.uid} />
    </PageBody>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("min-h-10 cursor-pointer rounded-ui border-2 border-line px-2.5 py-1.5 text-[0.75rem] font-extrabold", on ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm")}>
      {children}
    </button>
  );
}

function SupplyRow({ r, first, open, onToggle, tz, now, children }: { r: Row; first: boolean; open: boolean; onToggle: () => void; tz: string; now: number; children: React.ReactNode }) {
  const unit = unitFor(r.item, r.ing);
  const name = r.item.label.charAt(0).toUpperCase() + r.item.label.slice(1);
  const frozenLots = r.item.lots.filter((l) => l.frozenAtMs).length;
  const purchases = new Set(r.item.lots.map((l) => l.acquiredAtMs)).size; // a freeze split is still one purchase
  const id = `supply-${r.item.id}`;
  return (
    <li className={cn(!first && "border-t-2 border-line")} data-testid="supply-row" aria-label={name}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className={cn("flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-ink", open ? "bg-mantle" : "bg-base", r.current <= 1e-6 && "opacity-70")}>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[0.9375rem] font-extrabold">{name}</span>
          <span className="flex flex-wrap gap-1">
            {[...r.locations].map((l) => (
              <Badge key={l} className="bg-base uppercase">
                {LOCATION_LABEL[l]}
              </Badge>
            ))}
            {r.current > 1e-6 ? <ExpiryBadge flag={r.exp.flag} expiresMs={r.exp.expiresMs} frozen={r.exp.frozenOnly} nowMs={now} tz={tz} /> : null}
            {frozenLots && !r.exp.frozenOnly ? <Badge className="bg-blue text-onc uppercase">❄ {frozenLots} frozen</Badge> : null}
            {r.low ? <Badge className="bg-yellow text-onc uppercase">Low</Badge> : null}
            {purchases > 1 ? <Badge className="bg-base uppercase">{purchases} purchases</Badge> : null}
            {r.item.shortAtMs ? <Badge className="bg-yellow text-onc uppercase">Check amount</Badge> : null}
            {r.item.pending ? <Badge className="bg-base uppercase">Syncing</Badge> : null}
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-0.5 text-right">
          <span className="font-mono text-[0.9375rem] font-extrabold" data-testid="supply-current">
            {amountText(r.current, unit)}
          </span>
          <span className="font-mono text-[0.6875rem] font-semibold text-sub" data-testid="supply-projected">
            {r.needed > 1e-6 && r.projected < -1e-6 ? `(need ${shortAmount(-r.projected, unit)} more)` : `(${shortAmount(r.projected, unit)} after plan)`}
          </span>
        </span>
      </button>
      {open ? (
        <div id={id} className="border-t-2 border-dashed border-line bg-mantle px-3 pt-2.5 pb-3">
          {children}
        </div>
      ) : null}
    </li>
  );
}

