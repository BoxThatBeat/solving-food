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
}) {
  const lower = label.toLowerCase();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
  return (
    <div role="group" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className={cn("flex flex-none overflow-hidden rounded-ui border-2 border-line bg-base", className)}>
      <button
        type="button"
        aria-label={`Less ${lower}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        className="grid size-11 cursor-pointer place-items-center bg-pg text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus aria-hidden className="size-4" strokeWidth={3} />
      </button>
      <output aria-live="polite" aria-label={label} className="grid min-w-14 place-items-center border-x-2 border-line px-2 font-mono text-[1rem] font-extrabold whitespace-nowrap">
        {format(value)}
      </output>
      <button
        type="button"
        aria-label={`More ${lower}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        className="grid size-11 cursor-pointer place-items-center bg-pg text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus aria-hidden className="size-4" strokeWidth={3} />
      </button>
    </div>
  );
}
