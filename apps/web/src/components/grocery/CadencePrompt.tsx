// Staples cadence prompt (PRD R7.7, R8.14; TECHNICAL_SPECS §8 "Staples cadence"): "Are you out of milk?" once 85 % of
// the household's usual interval has passed since the last purchase (the seed's typical interval until it has been
// bought twice). Yes adds it to the draft grocery list (source "cadence"); Not yet snoozes it for a quarter interval
// through the snoozeCadence command (cadence is function-only). One prompt at a time, the most overdue first. Shown
// on the Grocery and Plan pages.
import * as React from "react";
import { duePrompts, manualItem, snoozeUntil } from "@solving-food/core";
import { useNotify } from "@/components/notifications-context";
import { useIngredientsById } from "@/data/ingredients";
import { addLine, millis } from "@/data/plan";
import type { PlanModel } from "@/data/planModel";
import { sendCommand, useCadence } from "@/data/supply";
import { dateText } from "@/components/supply/format";
import { cn } from "@/lib/utils";

export function CadencePrompt({ m, uid, className }: { m: PlanModel; uid: string; className?: string }) {
  const notify = useNotify();
  const cadence = useCadence(m.hid);
  const ids = React.useMemo(() => (cadence.docs ?? []).map((d) => d.id), [cadence.docs]);
  const ingredients = useIngredientsById(ids);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const tz = m.household?.timezone ?? "America/Toronto";

  const onList = React.useMemo(() => {
    const s = new Set<string>();
    for (const it of Object.values(m.draft.data?.items ?? {})) if (it.ingredientId && it.source !== "plan") s.add(it.ingredientId);
    for (const id of Object.keys(m.built.items)) s.add(id);
    for (const l of m.ordered ?? []) for (const it of Object.values(l.data.items)) if (it.ingredientId) s.add(it.ingredientId);
    return s;
  }, [m.draft.data, m.built.items, m.ordered]);

  const prompts = React.useMemo(
    () =>
      duePrompts(
        (cadence.docs ?? []).map((d) => ({
          ingredientId: d.id,
          c: { avgIntervalDays: d.data.avgIntervalDays, lastPurchasedAtMs: millis(d.data.lastPurchasedAt), purchaseCount: d.data.purchaseCount ?? 1, snoozedUntilMs: millis(d.data.snoozedUntil) },
        })),
        (id) => ingredients.get(id),
        onList,
        m.supply.now,
      ).filter((p) => !hidden.has(p.ingredientId)),
    [cadence.docs, ingredients, onList, m.supply.now, hidden],
  );
  const p = prompts[0];
  if (!p || !m.periodId) return null;
  const ing = ingredients.get(p.ingredientId);
  if (!ing) return null;
  const doc = cadence.docs?.find((d) => d.id === p.ingredientId)?.data;

  const yes = async () => {
    setHidden((h) => new Set(h).add(p.ingredientId));
    const ctx = { ...m.ctx, ingredients: (id: string) => (id === ing.id ? ing : m.ctx.ingredients(id)) };
    const item = { ...manualItem({ ingredientId: ing.id, packs: 1 }, ctx), source: "cadence" as const };
    try {
      await addLine(m.hid, m.periodId!, `cadence_${ing.id}`, item, !!m.draft.data);
      notify({ kind: "success", message: `Added ${item.productName} to the list` });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't add it: ${(e as Error).message}` });
    }
  };
  const notYet = () => {
    setHidden((h) => new Set(h).add(p.ingredientId));
    const until = snoozeUntil(doc ? { avgIntervalDays: doc.avgIntervalDays, purchaseCount: doc.purchaseCount ?? 1 } : null, ing, Date.now());
    sendCommand(m.hid, uid, "snoozeCadence", { ingredientId: ing.id, until: Math.round(until) });
  };

  return (
    <section aria-label="Staples" data-testid="cadence-prompt" className={cn("flex max-w-[40rem] flex-col gap-2 rounded-ui border-bw bg-yellow p-3 text-onc shadow-hard", className)}>
      <span className="font-mono text-[0.625rem] font-extrabold tracking-[0.09rem]">STAPLES</span>
      <span className="text-[1rem] leading-snug font-extrabold">Are you out of {ing.name}?</span>
      <span className="text-[0.8125rem] leading-snug font-semibold">
        You usually buy it every {Math.round(p.intervalDays)} day{Math.round(p.intervalDays) === 1 ? "" : "s"}. Last bought {dateText(p.lastPurchasedAtMs, tz).toLowerCase().replace(/^(\d+) (\w)/, (_, d: string, c: string) => `${d} ${c.toUpperCase()}`)}.
      </span>
      <div className="flex gap-2">
        <button type="button" onClick={() => void yes()} className="cursor-pointer rounded-ui border-2 border-line bg-ink px-3 py-2 text-[0.8125rem] font-extrabold text-base">
          Yes, add it
        </button>
        <button type="button" onClick={notYet} className="cursor-pointer rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold text-ink">
          Not yet
        </button>
      </div>
    </section>
  );
}
