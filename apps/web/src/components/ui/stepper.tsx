import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** The prototype's − value + stepper (servings, period length, budget). */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
  label,
  labelledBy,
  className,
  decLabel,
  incLabel,
  compact,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** Accessible name of the group, e.g. "Servings". Used for the buttons too ("Fewer servings"). */
  label: string;
  labelledBy?: string;
  className?: string;
  /** Button names; default "Decrease <label>" / "Increase <label>". */
  decLabel?: string;
  incLabel?: string;
  /** The recipe page's smaller control: a narrower value (M24: buttons stay 44 px). */
  compact?: boolean;
}) {
  const lower = label.toLowerCase();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
  return (
    <div role="group" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className={cn("flex flex-none overflow-hidden rounded-ui border-2 border-line bg-base", className)}>
      <button
        type="button"
        aria-label={decLabel ?? `Decrease ${lower}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        className={cn("grid cursor-pointer place-items-center bg-pg text-ink disabled:cursor-not-allowed disabled:opacity-40", "size-11")}
      >
        <Minus aria-hidden className="size-4" strokeWidth={3} />
      </button>
      <output aria-live="polite" aria-label={label} className={cn("grid place-items-center border-x-2 border-line px-2 tabular-nums text-[1rem] font-extrabold whitespace-nowrap", compact ? "min-w-11" : "min-w-14")}>
        {format(value)}
      </output>
      <button
        type="button"
        aria-label={incLabel ?? `Increase ${lower}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        className={cn("grid cursor-pointer place-items-center bg-pg text-ink disabled:cursor-not-allowed disabled:opacity-40", "size-11")}
      >
        <Plus aria-hidden className="size-4" strokeWidth={3} />
      </button>
    </div>
  );
}
