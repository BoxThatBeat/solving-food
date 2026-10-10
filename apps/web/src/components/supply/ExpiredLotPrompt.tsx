// <ExpiredLotPrompt> (PRD R8.15, TECHNICAL_SPECS §12): one row per expired lot, on Supply and Plan. Still good extends
// the expiry (+3 days, or a picked date) with `extendExpiry`; Threw it out records a `discard`. Nothing is ever
// discarded automatically, and until one is chosen the lot shows as expired and doesn't count.
import * as React from "react";
import { addLocalDays, EXTEND_DEFAULT_DAYS, localDate, localMidnight, addDays } from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/components/notifications-context";
import { sendCommand } from "@/data/supply";
import { amountText, dateText, type ExpiredEntry } from "./format";

export function ExpiredLotPrompts({ entries, hid, uid, tz, nowMs }: { entries: ExpiredEntry[]; hid: string; uid: string; tz: string; nowMs: number }) {
  if (!entries.length) return null;
  return (
    <section aria-label="Expired in supply" className="flex flex-col overflow-hidden rounded-ui border-bw bg-base shadow-hard" data-testid="expired-prompts">
      <div className="border-b-2 border-line bg-red px-3 py-1.5 font-mono text-[0.625rem] font-bold tracking-[0.0625rem] text-onc uppercase">
        Expired · not counted until you say
      </div>
      {entries.map((e, i) => (
        <ExpiredRow key={`${e.item.id}/${e.lot.lotId}`} e={e} first={i === 0} hid={hid} uid={uid} tz={tz} nowMs={nowMs} />
      ))}
    </section>
  );
}

function ExpiredRow({ e, first, hid, uid, tz, nowMs }: { e: ExpiredEntry; first: boolean; hid: string; uid: string; tz: string; nowMs: number }) {
  const notify = useNotify();
  const [picking, setPicking] = React.useState(false);
  const defaultUntil = addLocalDays(nowMs, EXTEND_DEFAULT_DAYS, tz);
  const [date, setDate] = React.useState(localDate(defaultUntil, tz));
  const name = e.item.label.charAt(0).toUpperCase() + e.item.label.slice(1);
  const stillGood = (until?: number) => {
    sendCommand(hid, uid, "extendExpiry", { supplyId: e.item.id, lotId: e.lot.lotId, ...(until ? { until } : {}) });
    notify({ kind: "success", message: `${name} counts again until ${dateText(until ?? defaultUntil, tz)}` });
    setPicking(false);
  };
  const threw = () => {
    sendCommand(hid, uid, "discard", { supplyId: e.item.id, lotId: e.lot.lotId });
    notify({ kind: "success", message: `${name}: logged as thrown out` });
  };
  const minDate = localDate(addLocalDays(nowMs, 1, tz), tz);
  return (
    <div className={first ? "flex flex-col gap-2 px-3 py-2.5" : "flex flex-col gap-2 border-t-2 border-line px-3 py-2.5"} data-testid="expired-lot">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-[0.9375rem] font-extrabold">{name}</span>
        <span className="font-mono text-[0.6875rem] font-bold">{amountText(e.lot.amount, e.unit)}</span>
      </div>
      <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
        Bought {dateText(e.lot.acquiredAtMs, tz)} · expired{e.lot.expiryExtendedToMs ? " again" : ""} · is it still good?
      </span>
      {picking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (date >= minDate) stillGood(localMidnight(addDays(date, 1), tz));
          }}
        >
          <label className="flex flex-1 items-center gap-2 font-mono text-[0.6875rem] font-bold">
            GOOD UNTIL
            <Input type="date" value={date} min={minDate} onChange={(ev) => setDate(ev.target.value)} className="min-w-0 flex-1 py-2" aria-label={`${name} good until`} />
          </label>
          <Button size="sm" type="submit" disabled={date < minDate}>
            Save
          </Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => stillGood()} aria-label={`${name} is still good`}>
            Still good · +{EXTEND_DEFAULT_DAYS} days
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)} aria-label={`Pick a date for ${name}`}>
            Pick a date
          </Button>
          <Button size="sm" variant="secondary" onClick={threw} aria-label={`Threw out the ${name}`}>
            Threw it out
          </Button>
        </div>
      )}
    </div>
  );
}
