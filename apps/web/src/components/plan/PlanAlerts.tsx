// The Plan page's alerts, compact once seen (M24, PRD R6.31): expired lots (R8.15), Use it or lose it (R6.13) and Use it
// up before ordering (R6.25) show in full the first time this device sees them; after that they fold into one summary
// line with a chevron ("1 lot expired · 3 expiring soon") that opens them, so the coverage strip and the plan stay in
// the first screen on a phone (below lg; wide screens show them in their own column, as the prototype does). Anything new (a lot, an alert, a spare item this device hasn't seen) shows them in full
// again. What's been seen is per household, in localStorage; nothing is written to Firestore.
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY = "sf.planAlertsSeen";
const MAX_KEPT = 300;

function readSeen(hid: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const v = all[hid];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(hid: string, keys: readonly string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string[]>;
    const prev = Array.isArray(all[hid]) ? all[hid] : [];
    const next = [...new Set([...prev, ...keys])].slice(-MAX_KEPT);
    if (next.length === prev.length && next.every((k, i) => k === prev[i])) return;
    localStorage.setItem(KEY, JSON.stringify({ ...all, [hid]: next }));
  } catch {
    /* storage blocked: the alerts always show in full */
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 lot expired · 3 expiring soon · 2 to use up" */
function alertsSummary(c: { expired: number; expiring: number; useUp: number }): string {
  return [
    c.expired ? `${plural(c.expired, "lot", "lots")} expired` : "",
    c.expiring ? `${c.expiring} expiring soon` : "",
    c.useUp ? `${plural(c.useUp, "thing", "things")} to use up` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PlanAlerts({
  hid,
  keys,
  counts,
  foldable,
  children,
}: {
  hid: string;
  /** One stable key per alert item shown (lot, expiring ingredient, spare item). */
  keys: readonly string[];
  counts: { expired: number; expiring: number; useUp: number };
  /** Below lg only: on wide screens the alerts sit in their own column, as in the prototype, and never fold. */
  foldable: boolean;
  children: React.ReactNode;
}) {
  // What this device had seen when the page opened: alerts seen before fold; ones arriving now show in full.
  const [seenAtOpen] = React.useState(() => readSeen(hid));
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const keyList = keys.join("|");
  React.useEffect(() => {
    if (keyList) writeSeen(hid, keyList.split("|"));
  }, [hid, keyList]);
  if (!keys.length) return null;
  const folded = foldable && keys.every((k) => seenAtOpen.has(k));
  if (!folded) return <>{children}</>;
  return (
    <div className="flex flex-col gap-3.5" data-testid="plan-alerts">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="press flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-ui border-bw bg-peach px-3 py-2 text-left text-[0.875rem] font-extrabold text-onc shadow-hard"
        data-testid="plan-alerts-summary"
      >
        <span>{alertsSummary(counts)}</span>
        <ChevronDown aria-hidden className={cn("size-5 flex-none transition-transform", open && "rotate-180")} strokeWidth={3} />
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-3.5">
        {open ? children : null}
      </div>
    </div>
  );
}
