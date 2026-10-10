import * as React from "react";
import { cn } from "@/lib/utils";

/** The prototype's toggle chip (filter options, cuisine picker): accent when on, base with a hard shadow when off. */
export function ToggleChip({
  pressed,
  className,
  count,
  children,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & { pressed: boolean; count?: number | string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-[2.375rem] cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line px-3 py-2 text-[0.8125rem] font-extrabold disabled:cursor-not-allowed disabled:opacity-50",
        pressed ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="font-mono text-[0.625rem] font-bold opacity-75">{count}</span> : null}
    </button>
  );
}

/** Small mono badge (card badges, tags): 2px border, half radius. */
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-block rounded-[calc(var(--r)*0.5)] border-2 border-line px-1 py-0.5 font-mono text-[0.625rem] leading-[1.2] font-bold whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

/** Mono section label with optional right-hand hint, as the prototype's "SORT BY · MATCH ALL". */
export function SectionLabel({ children, hint, id }: { children: React.ReactNode; hint?: React.ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span id={id} className="font-mono text-[0.65625rem] font-bold tracking-[0.09rem] uppercase">
        {children}
      </span>
      {hint ? <span className="font-mono text-[0.65625rem] font-bold text-sub uppercase">{hint}</span> : null}
    </div>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "box-border w-full min-w-0 rounded-ui border-bw bg-base px-3.5 py-3 font-sans text-[0.9375rem] leading-normal font-semibold text-ink shadow-hard outline-none focus-visible:outline-[0.1875rem] focus-visible:outline-offset-2 focus-visible:outline-ink aria-invalid:border-red",
        className,
      )}
      {...props}
    />
  );
}
