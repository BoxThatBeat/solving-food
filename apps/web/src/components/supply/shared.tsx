// <ExpiryBadge> for supply rows and lots (R8.5, R8.6).
import { daysLeft, shortDuration, type ExpiryFlag } from "@solving-food/core";
import { Badge } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

const FLAG_CLASS: Record<ExpiryFlag, string> = {
  expired: "bg-red text-onc",
  soon: "bg-peach text-onc",
  fresh: "bg-s0 text-ink",
  none: "bg-s0 text-ink",
};

/** "FRESH · 4D", "USE SOON · 2D", "EXPIRED", "❄ FROZEN · 5MO", "KEEPS" (R8.5, R8.6). */
export function ExpiryBadge({ flag, expiresMs, frozen, nowMs, tz, className }: { flag: ExpiryFlag; expiresMs: number | null; frozen?: boolean; nowMs: number; tz: string; className?: string }) {
  const d = expiresMs !== null ? Math.max(0, daysLeft(expiresMs, nowMs, tz)) : null;
  let text: string;
  if (flag === "expired") text = "Expired";
  else if (flag === "none") text = frozen ? "❄ Frozen" : "Keeps";
  else text = `${frozen ? "❄ Frozen" : flag === "soon" ? "Use soon" : "Fresh"} · ${d === 0 ? "today" : shortDuration(d!)}`;
  return <Badge className={cn("uppercase", frozen && flag !== "expired" ? "bg-blue text-onc" : FLAG_CLASS[flag], className)}>{text}</Badge>;
}
