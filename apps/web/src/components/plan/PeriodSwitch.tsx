// "This period · Next period" (M26, R3.2, R7.18): the segmented control at the top of the Plan and Grocery pages. The
// choice lives in the URL (`?period=next`), so a reload or a shared link keeps it. Built from the Create meal sheet's
// segmented tabs (the prototype has no next period): two toggle buttons, the chosen one in the accent.
import { formatPeriodRange, type PeriodView } from "@solving-food/core";
import { cn } from "@/lib/utils";

export function PeriodSwitch({
  view,
  onChange,
  current,
  next,
  tz,
  className,
}: {
  view: PeriodView;
  onChange: (v: PeriodView) => void;
  current: { startMs: number; endMs: number } | null;
  next: { startMs: number; endMs: number } | null;
  tz: string;
  className?: string;
}) {
  const opts: Array<{ v: PeriodView; label: string; range: { startMs: number; endMs: number } | null }> = [
    { v: "current", label: "This period", range: current },
    { v: "next", label: "Next period", range: next },
  ];
  return (
    <div role="group" aria-label="Period" className={cn("grid w-full max-w-[28rem] grid-cols-2 overflow-hidden rounded-ui border-2 border-line bg-base", className)} data-testid="period-switch">
      {opts.map((o, i) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={view === o.v}
          onClick={() => view !== o.v && onChange(o.v)}
          className={cn("flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-center", i && "border-l-2 border-line", view === o.v ? "bg-acc text-onc" : "bg-transparent text-ink")}
        >
          <span className="text-[0.875rem] leading-tight font-extrabold">{o.label}</span>
          {o.range ? <span className="tabular-nums text-[0.625rem] leading-tight font-bold">{formatPeriodRange(o.range.startMs, o.range.endMs, tz)}</span> : null}
        </button>
      ))}
    </div>
  );
}
