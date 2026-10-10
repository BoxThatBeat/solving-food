// <BudgetMeter> (PRD R6.3–R6.5; TECHNICAL_SPECS §7 "Budget", §12): budget − what the next order will cost. Red and
// negative when over; never blocks adding. "n prices unknown" when an ingredient has no price (counted as $0).
import { formatCents, type BudgetState } from "@solving-food/core";
import { cn } from "@/lib/utils";

function Bar({ b, className }: { b: BudgetState; className?: string }) {
  return (
    <div
      role="meter"
      aria-label="Budget left"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, b.budgetCents / 100)}
      aria-valuenow={Math.max(0, b.remainingCents / 100)}
      aria-valuetext={`${formatCents(b.remainingCents)} left of ${formatCents(b.budgetCents)}`}
      className={cn("h-5 overflow-hidden rounded-[calc(var(--r)*0.67)] border-2 border-line bg-s0", className)}
    >
      <div className={cn("h-full border-r-2 border-line", b.over ? "bg-red" : "bg-acc")} style={{ width: `${b.over ? 100 : Math.round(b.fractionLeft * 100)}%`, borderRightWidth: b.fractionLeft >= 1 || b.over ? 0 : undefined }} />
    </div>
  );
}

/** The phone's sticky meter under the header (the prototype's top card). */
export function BudgetMeterCompact({ b, className }: { b: BudgetState; className?: string }) {
  return (
    <section aria-label="Budget" data-testid="budget-meter" data-over={b.over || undefined} className={cn("flex items-center gap-3 rounded-ui border-bw bg-base px-3.5 py-2.5 shadow-hard", b.over && "bg-red", className)}>
      <div className="flex flex-none flex-col">
        <span className="font-mono text-[1.375rem] leading-none font-extrabold" data-testid="budget-left">
          {formatCents(b.remainingCents)}
        </span>
        <span className="font-mono text-[0.59375rem] font-bold uppercase">{b.over ? "over" : "left"} of {formatCents(b.budgetCents)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Bar b={b} />
        {b.unknownPrices ? <span className="font-mono text-[0.59375rem] font-bold uppercase">{b.unknownPrices} price{b.unknownPrices === 1 ? "" : "s"} unknown</span> : null}
      </div>
    </section>
  );
}

/** The desktop card ("Budget · this period"). */
export function BudgetMeterCard({ b, className }: { b: BudgetState; className?: string }) {
  return (
    <section aria-label="Budget" data-testid="budget-meter" data-over={b.over || undefined} className={cn("@container flex flex-col gap-2 rounded-ui border-bw bg-base p-4 shadow-hard", b.over && "bg-red", className)}>
      <span className="font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">Budget · this period</span>
      <span className="font-display text-[2.25rem] leading-none @[22rem]:text-[2.5rem]" data-testid="budget-left">
        {formatCents(b.remainingCents)}
      </span>
      <span className="text-[0.8125rem] font-bold">
        {b.over ? "over" : "left of"} {b.over ? `the ${formatCents(b.budgetCents)} budget` : `${formatCents(b.budgetCents)} for this period`}
      </span>
      <Bar b={b} />
      <span className="font-mono text-[0.625rem] leading-relaxed font-bold uppercase">
        Next order {formatCents(b.spentCents)} · only what supply and ordered lists don't cover counts
        {b.unknownPrices ? ` · ${b.unknownPrices} price${b.unknownPrices === 1 ? "" : "s"} unknown` : ""}
      </span>
    </section>
  );
}
