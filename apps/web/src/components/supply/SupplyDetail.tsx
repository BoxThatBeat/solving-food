// A supply item's detail (PRD R8.5–R8.9, R8.15; prototype sheet "sup"): its purchases (lots) with expiry and
// location, freeze / thaw with an amount, discard, the <SupplyAdjust> correction, and the <LedgerList> of changes.
// Every change is a command (TECHNICAL_SPECS §6); the shown numbers include pending commands.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  activeExpiry,
  enterableMeasures,
  expiryFlag,
  fromCanonical,
  isExpired,
  recomputeAmount,
  toCanonical,
  unitLabel,
  type LedgerLot,
  type Measure,
} from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/chip";
import { Stepper } from "@/components/ui/stepper";
import { useNotify } from "@/components/notifications-context";
import { sendCommand, useLedger, type StoredTx, type SupplyItem } from "@/data/supply";
import type { IngredientEntry } from "@/data/ingredients";
import { unitFor } from "./format";
import { millis } from "@/data/plan";
import { cn } from "@/lib/utils";
import { ExpiryBadge } from "./shared";
import { amountText, dateText, LOCATION_LABEL, type AmountUnit } from "./format";

export function SupplyDetail({
  item,
  ingredient,
  hid,
  uid,
  tz,
  nowMs,
  members,
  ledgerLimit,
}: {
  item: SupplyItem;
  ingredient: IngredientEntry | undefined;
  hid: string;
  uid: string;
  tz: string;
  nowMs: number;
  members: ReadonlyMap<string, string>;
  /** Show only the latest n changes with a link to the full history (inline on the Supply page). */
  ledgerLimit?: number;
}) {
  const unit = unitFor(item, ingredient);
  const lots = [...item.lots].sort((a, b) => (activeExpiry(a) ?? Infinity) - (activeExpiry(b) ?? Infinity));
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel hint={item.pending ? "Syncing…" : undefined}>Purchases · expiry per purchase</SectionLabel>
      {lots.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Purchases">
          {lots.map((l) => (
            <LotRow key={l.lotId} lot={l} item={item} ingredient={ingredient} unit={unit} hid={hid} uid={uid} tz={tz} nowMs={nowMs} />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[0.8125rem] font-semibold text-sub">None left. Correct it below if there is some.</p>
      )}
      {item.shortAtMs ? (
        <p className="m-0 rounded-ui border-2 border-line bg-yellow p-2.5 text-[0.8125rem] font-bold text-onc" role="note">
          A meal needed more than Supply had. Check the amount and correct it if it's off.
        </p>
      ) : null}
      <SupplyAdjust item={item} ingredient={ingredient} unit={unit} hid={hid} uid={uid} />
      <LedgerList hid={hid} supplyId={item.id} unit={unit} tz={tz} members={members} limitTo={ledgerLimit} />
    </div>
  );
}

function LotRow({ lot, item, ingredient, unit, hid, uid, tz, nowMs }: { lot: LedgerLot; item: SupplyItem; ingredient: IngredientEntry | undefined; unit: AmountUnit; hid: string; uid: string; tz: string; nowMs: number }) {
  const notify = useNotify();
  const [freezing, setFreezing] = React.useState<number | null>(null);
  const e = activeExpiry(lot);
  const expired = isExpired(lot, nowMs);
  const frozen = !!lot.frozenAtMs;
  const canFreeze = !frozen && !expired && (item.ingredientId ? !!ingredient?.freezable : true);
  const step = unit.canonicalUnit === "count" || unit.portions ? 1 : lot.amount > 1000 ? 250 : 50;
  const name = item.label;
  return (
    <li className="flex flex-col gap-2 rounded-ui border-2 border-line bg-base p-2.5" data-testid="lot">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-mono text-[0.8125rem] font-extrabold">
            {amountText(lot.amount, unit)} <span className="text-[0.625rem] font-semibold text-sub">BOUGHT {dateText(lot.acquiredAtMs, tz)}</span>
          </span>
          <span className="flex flex-wrap gap-1">
            <ExpiryBadge flag={expiryFlag(e, nowMs, tz)} expiresMs={e} frozen={frozen} nowMs={nowMs} tz={tz} />
            <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
              {LOCATION_LABEL[lot.location]}
              {e ? ` · use by ${dateText(e - 1, tz)}` : ""}
              {lot.expiryExtendedToMs ? " · extended" : ""}
            </span>
          </span>
        </span>
        {frozen ? (
          <Button
            size="sm"
            variant="chip"
            className="bg-blue-soft text-onc"
            onClick={() => {
              sendCommand(hid, uid, "thaw", { supplyId: item.id, lotId: lot.lotId });
              notify({ kind: "success", message: `${name} thawed · use within 2 days` });
            }}
          >
            Thaw
          </Button>
        ) : canFreeze ? (
          <Button size="sm" variant="chip" onClick={() => setFreezing(lot.amount)} aria-expanded={freezing !== null}>
            ❄ Freeze
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="chip"
          onClick={() => {
            sendCommand(hid, uid, "discard", { supplyId: item.id, lotId: lot.lotId });
            notify({ kind: "success", message: `Logged ${amountText(lot.amount, unit)} of ${name} as discarded` });
          }}
          aria-label={`Threw out this purchase of ${name}`}
        >
          Threw it out
        </Button>
      </div>
      {freezing !== null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-ui border-2 border-line bg-blue-soft p-2 text-onc">
          <span className="font-mono text-[0.625rem] font-bold">FREEZE HOW MUCH?</span>
          <Stepper label="Amount to freeze" value={freezing} min={Math.min(step, lot.amount)} max={lot.amount} step={step} onChange={setFreezing} format={(v) => amountText(v, unit)} className="bg-base text-ink" />
          <Button
            size="sm"
            onClick={() => {
              sendCommand(hid, uid, "freeze", { supplyId: item.id, lotId: lot.lotId, amount: freezing });
              notify({ kind: "success", message: `${amountText(freezing, unit)} of ${name} frozen` });
              setFreezing(null);
            }}
          >
            Freeze {amountText(freezing, unit)}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setFreezing(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </li>
  );
}

const ENTRY_UNITS: Record<Measure, string[]> = { weight: ["g", "oz"], volume: ["ml", "cup"], count: ["count"] };

/** <SupplyAdjust> (R8.8): "I actually have …" in any allowed measurement, ±5/±25 (or ±1), Apply → correctSupply. */
export function SupplyAdjust({ item, ingredient, unit, hid, uid }: { item: SupplyItem; ingredient: IngredientEntry | undefined; unit: AmountUnit; hid: string; uid: string }) {
  const notify = useNotify();
  const current = recomputeAmount(item.lots);
  const measures: Measure[] = ingredient ? enterableMeasures(ingredient) : ["count"];
  const units = unit.portions ? ["count"] : measures.flatMap((m) => ENTRY_UNITS[m]);
  // The ingredient may load after the first render: a unit it doesn't offer falls back to its first one.
  const [uPick, setU] = React.useState<string | null>(null);
  const u = uPick && units.includes(uPick) ? uPick : (units[0] ?? "g");
  const conv = ingredient ?? { allowedMeasures: ["count" as Measure], canonicalUnit: "count" as const };
  const shown = (canon: number) => {
    const v = fromCanonical(canon, u, conv);
    return v === null ? "" : String(Math.round(v * 100) / 100);
  };
  // The box follows the live amount until the person types; a new amount or unit resets it.
  const key = `${current}|${u}`;
  const [edit, setEdit] = React.useState<{ key: string; text: string } | null>(null);
  const text = edit?.key === key ? edit.text : shown(current);
  const setText = (t: string) => setEdit({ key, text: t });
  const value = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(value) && value >= 0;
  const steps = u === "count" ? [-2, -1, 1, 2] : u === "g" || u === "ml" ? [-25, -5, 5, 25] : [-1, -0.5, 0.5, 1];
  const id = React.useId();
  const apply = () => {
    if (!valid) return;
    const c = unit.portions ? { ok: true as const, canonicalAmount: value } : toCanonical(value, u, conv);
    if (!c.ok) return;
    sendCommand(hid, uid, "correctSupply", { supplyId: item.id, target: c.canonicalAmount, ...(item.ingredientId ? { ingredientId: item.ingredientId } : {}), note: `I actually have ${amountText(c.canonicalAmount, unit)}` });
    notify({ kind: "success", message: `${item.label} corrected to ${amountText(c.canonicalAmount, unit)}` });
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <SectionLabel id={id}>Correct it · I actually have</SectionLabel>
      <div className="flex items-center gap-2">
        <Input aria-labelledby={id} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className="flex-1 font-mono text-[1.125rem] font-extrabold" aria-invalid={!valid || undefined} />
        {units.length > 1 ? (
          <div role="group" aria-label="Unit" className="flex gap-1">
            {units.map((x) => (
              <button key={x} type="button" aria-pressed={u === x} onClick={() => setU(x)} className={cn("min-h-11 cursor-pointer rounded-ui border-2 border-line px-2.5 font-mono text-[0.8125rem] font-extrabold", u === x ? "bg-acc text-onc" : "bg-base text-ink")}>
                {x === "count" ? "×" : unitLabel(x, 2)}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-mono text-[0.8125rem] font-bold">{unit.portions ? "portions" : u === "count" ? "×" : unitLabel(u, 2)}</span>
        )}
        <Button type="submit" disabled={!valid}>
          Apply
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {steps.map((s) => (
          <Button
            key={s}
            type="button"
            variant="chip"
            size="sm"
            onClick={() => setText(String(Math.max(0, Math.round(((valid ? value : 0) + s) * 100) / 100)))}
            aria-label={`${s > 0 ? "Add" : "Take off"} ${Math.abs(s)} ${u === "count" ? "" : unitLabel(u, Math.abs(s))}`.replace(/\s+/g, " ").trim()}
            className="font-mono"
          >
            {s > 0 ? "+" : "−"}
            {Math.abs(s)}
            {u === "count" ? "" : ` ${unitLabel(u, Math.abs(s))}`}
          </Button>
        ))}
      </div>
    </form>
  );
}

const KIND_LABEL: Record<string, string> = {
  purchase: "Bought",
  cook: "Cooked",
  correction: "Correction",
  discard: "Threw out",
  freeze: "Moved to freezer",
  thaw: "Thawed",
  leftover: "Leftovers made",
  eaten: "Eaten",
  extendExpiry: "Still good",
};

/** <LedgerList> (R8.7): every change with its date and who did it; loads more as you scroll (25 per page). */
export function LedgerList({ hid, supplyId, unit, tz, members, limitTo }: { hid: string; supplyId: string; unit: AmountUnit; tz: string; members: ReadonlyMap<string, string>; limitTo?: number | undefined }) {
  const l = useLedger(hid, supplyId);
  const sentinel = React.useRef<HTMLDivElement>(null);
  const { hasMore, loadMore } = l;
  React.useEffect(() => {
    if (limitTo || !hasMore || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void loadMore());
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [limitTo, hasMore, loadMore]);
  const rows = limitTo ? l.rows.slice(0, limitTo) : l.rows;
  return (
    <section aria-label="History" className="flex flex-col gap-1">
      <SectionLabel hint={limitTo && l.rows.length > limitTo ? <Link to="/supply/$id" params={{ id: supplyId }} className="text-ink">Full history →</Link> : undefined}>History</SectionLabel>
      {l.loading ? <span className="font-mono text-[0.6875rem] text-sub">LOADING…</span> : null}
      {!l.loading && !rows.length ? <span className="text-[0.8125rem] font-semibold text-sub">No changes yet.</span> : null}
      <ol className="m-0 flex list-none flex-col p-0" data-testid="ledger">
        {rows.map((r) => (
          <LedgerRow key={r.id} t={r.data} unit={unit} tz={tz} who={members.get(r.data.uid) ?? ""} />
        ))}
      </ol>
      {!limitTo && l.hasMore ? (
        <div ref={sentinel}>
          <Button variant="ghost" size="sm" onClick={() => void l.loadMore()} disabled={l.busy}>
            {l.busy ? "Loading…" : "Load older changes"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function LedgerRow({ t, unit, tz, who }: { t: StoredTx; unit: AmountUnit; tz: string; who: string }) {
  const ms = millis(t.createdAt);
  const sign = t.delta > 0 ? "+" : t.delta < 0 ? "−" : "";
  return (
    <li className="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-dashed border-line/40 py-1.5 font-mono text-[0.6875rem]" data-testid="ledger-row">
      <span className="font-bold text-sub">{ms ? dateText(ms, tz) : "NOW"}</span>
      <span className="min-w-0 font-semibold">
        <span className="font-sans text-[0.8125rem] font-bold">{KIND_LABEL[t.kind] ?? t.kind}</span>
        {t.note ? <span className="text-sub"> · {t.note}</span> : null}
        {who ? <span className="text-sub uppercase"> · {who}</span> : null}
      </span>
      <span className="font-extrabold whitespace-nowrap">{t.delta ? `${sign}${amountText(Math.abs(t.delta), unit)}` : "±0"}</span>
    </li>
  );
}
