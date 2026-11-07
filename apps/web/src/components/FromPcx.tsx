// <FromPcx> (PRD R6.29): a small tag on everything shown from PC Express (stores, products, live prices), so its data
// is never mistaken for the app's estimates.
import { cn } from "@/lib/utils";

export function FromPcx({ className }: { className?: string }) {
  return (
    <span data-testid="from-pcx" className={cn("inline-flex w-fit flex-none items-center rounded border-2 border-line bg-mantle px-1.5 py-px tabular-nums text-[0.5625rem] font-bold tracking-[0.03rem] whitespace-nowrap text-ink", className)}>
      From PC Express
    </span>
  );
}
