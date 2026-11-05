// <DealChip> (M27, PRD R6.33): a product on sale, at least 15 % below its usual price (core `priceDeal`). The app's small
// mono badge in the accent (the "good" colour of the suggestion chips), with the usual price when asked for.
import { dealLabel, formatCents, type PriceDeal } from "@solving-food/core";
import { Badge } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

export function DealChip({ deal, usual, className }: { deal: Pick<PriceDeal, "dealPct" | "usualCents">; usual?: boolean; className?: string }) {
  return (
    <Badge className={cn("w-fit bg-acc text-onc uppercase", className)} data-testid="deal-chip" title={`Usually ${formatCents(deal.usualCents)}`}>
      {dealLabel(deal)}
      {usual ? ` · usual ${formatCents(deal.usualCents)}` : ""}
    </Badge>
  );
}
