// Confirm groceries (PRD R7.8, R7.9; TECHNICAL_SPECS §8 "Confirming a purchase"; prototype sheet "conf"). The ordered
// list's items, all assumed bought: change pack counts, swap a substitution for another ingredient, or mark one as
// "didn't come". A bulk-store item that freezes asks "Freeze some of this?" next. One `receiveGroceries` command
// adds it all to supply, updates the staples cadence, and marks the list received.
import * as React from "react";
import { formatCanonical, type GroceryItem, type StoreEntry } from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useNotify } from "@/components/notifications-context";
import { useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { sendCommand } from "@/data/supply";
import { cn } from "@/lib/utils";

interface Line {
  id: string;
  item: GroceryItem;
  /** Packs (or multiples of the raw amount) that arrived. */
  packs: number;
  missing: boolean;
  /** A substitution: the ingredient actually bought. */
  swap?: IngredientEntry | undefined;
  freeze?: number;
}

const perPack = (it: GroceryItem) => (it.packAmount && it.packAmount > 0 ? it.packAmount : it.packs > 0 ? it.amount / it.packs : it.amount);

export function ReceiveSheet({
  open,
  onOpenChange,
  listId,
  items,
  stores,
  ingredients,
  hid,
  uid,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listId: string;
  items: Record<string, GroceryItem>;
  stores: readonly StoreEntry[];
  ingredients: Map<string, IngredientEntry>;
  hid: string;
  uid: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? <ReceiveBody listId={listId} items={items} stores={stores} ingredients={ingredients} hid={hid} uid={uid} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function ReceiveBody({ listId, items, stores, ingredients, hid, uid, close }: { listId: string; items: Record<string, GroceryItem>; stores: readonly StoreEntry[]; ingredients: Map<string, IngredientEntry>; hid: string; uid: string; close: () => void }) {
  const notify = useNotify();
  const [lines, setLines] = React.useState<Line[]>(() =>
    Object.entries(items)
      .sort(([, a], [, b]) => a.storeId.localeCompare(b.storeId) || a.productName.localeCompare(b.productName))
      .map(([id, item]) => ({ id, item, packs: item.packs || 1, missing: false })),
  );
  const [step, setStep] = React.useState<"list" | "freeze">("list");
  const [freezeQueue, setFreezeQueue] = React.useState<string[]>([]);
  const [swapping, setSwapping] = React.useState<string | null>(null);
  const storeOf = (id: string) => stores.find((s) => s.id === id);
  const ingOf = (l: Line) => l.swap ?? (l.item.ingredientId ? ingredients.get(l.item.ingredientId) : undefined);
  const amountOf = (l: Line) => {
    if (l.missing) return 0;
    const a = perPack(l.item) * l.packs;
    // A substitute counted differently (eggs by count for a weighed item): count the packs, or weigh them by unit weight.
    const from = l.item.measure === "count" ? "count" : "g";
    if (l.swap && l.swap.canonicalUnit !== from) return l.swap.canonicalUnit === "count" ? l.packs : l.packs * (l.swap.unitWeightG ?? 100);
    return Math.round(a * 1000) / 1000;
  };
  const changed = lines.some((l) => l.missing || l.swap || l.packs !== (l.item.packs || 1));
  const update = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = (ls: Line[]) => {
    sendCommand(hid, uid, "receiveGroceries", {
      listId,
      items: ls.map((l) => {
        const ing = ingOf(l);
        return {
          itemId: l.id,
          ...(ing ? { ingredientId: ing.id } : {}),
          amount: amountOf(l),
          ...(l.missing ? { missing: true } : {}),
          ...(l.freeze && l.freeze > 0 ? { freezeAmount: Math.min(l.freeze, amountOf(l)) } : {}),
        };
      }),
    });
    const n = ls.filter((l) => !l.missing).length;
    notify({ kind: "success", message: `Supply updated · ${n} item${n === 1 ? "" : "s"} added`, link: { to: "/supply", label: "See supply" } });
    close();
  };

  const confirm = () => {
    // Bulk buys of freezable food ask about freezing first (R7.9).
    const queue = lines.filter((l) => !l.missing && storeOf(l.item.storeId)?.bulk && ingOf(l)?.freezable && ingOf(l)?.defaultLocation !== "freezer" && amountOf(l) > 0).map((l) => l.id);
    if (queue.length) {
      setLines((ls) => ls.map((l) => (queue.includes(l.id) ? { ...l, freeze: Math.round(amountOf(l) / 2 / 250) * 250 || amountOf(l) } : l)));
      setFreezeQueue(queue);
      setStep("freeze");
    } else submit(lines);
  };

  const current = step === "freeze" ? lines.find((l) => l.id === freezeQueue[0]) : undefined;
  const nextFreeze = (patch: Partial<Line>) => {
    const ls = lines.map((l) => (l.id === current!.id ? { ...l, ...patch } : l));
    setLines(ls);
    const rest = freezeQueue.slice(1);
    if (rest.length) setFreezeQueue(rest);
    else submit(ls);
  };

  if (step === "freeze" && current) {
    const ing = ingOf(current)!;
    const total = amountOf(current);
    const unit = { u: ing.canonicalUnit, w: ing.unitWeightG };
    const stepAmt = ing.canonicalUnit === "count" ? 1 : 250;
    const keeps = ing.shelfLifeDays.freezer;
    return (
      <SheetContent
        title="Bulk buy"
        description="Freeze some of this?"
        footer={
          <div className="flex gap-2.5">
            <Button variant="secondary" size="lg" className="flex-none" onClick={() => nextFreeze({ freeze: 0 })}>
              Don't freeze
            </Button>
            <Button size="lg" className="flex-1" onClick={() => nextFreeze({})}>
              Freeze {formatCanonical(current.freeze ?? 0, unit.u, unit.w)}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2.5 rounded-ui border-bw bg-blue p-4 text-onc shadow-hard" data-testid="freeze-prompt">
          <span className="font-mono text-[0.65625rem] font-extrabold tracking-[0.09rem]">BULK BUY · {storeOf(current.item.storeId)?.name.toUpperCase()}</span>
          <span className="font-display text-[1.5rem] leading-[1.05]">Freeze some of this?</span>
          <span className="text-[0.875rem] font-semibold">
            {formatCanonical(total, unit.u, unit.w)} of {ing.name} arrived. Whatever you freeze keeps {keeps ? `about ${Math.round(keeps / 30)} months` : "much longer"}; the rest stays in the {ing.defaultLocation}.
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <Stepper label="Amount to freeze" value={current.freeze ?? 0} min={0} max={total} step={stepAmt} onChange={(v) => update(current.id, { freeze: v })} format={(v) => formatCanonical(v, unit.u, unit.w)} className="bg-base text-ink" />
          </div>
        </div>
      </SheetContent>
    );
  }

  return (
    <SheetContent
      title="Confirm groceries"
      description="Fix anything that changed; change nothing and it all arrived"
      footer={
        <Button size="lg" className="w-full" onClick={confirm} disabled={!lines.length}>
          {changed ? "Confirm with changes" : "Everything arrived · add to supply"}
        </Button>
      }
    >
      <p className="m-0 text-[0.8125rem] leading-snug font-semibold">Fix anything that changed: substitutions, out-of-stock, different pack counts. Change nothing and we assume it all arrived.</p>
      <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0" aria-label="Items in this order">
        {lines.map((l, i) => {
          const ing = ingOf(l);
          const st = storeOf(l.item.storeId);
          const label = l.swap ? `${l.swap.name.charAt(0).toUpperCase()}${l.swap.name.slice(1)}` : `${l.item.productName}${l.item.packLabel && !l.item.productName.includes(l.item.packLabel) ? `, ${l.item.packLabel}` : ""}`;
          return (
            <li key={l.id} className={cn("flex flex-col gap-2 px-3 py-2.5", i && "border-t-2 border-line", l.missing && "opacity-60")} data-testid="receive-line">
              <div className="flex items-center gap-2">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-[0.875rem] leading-tight font-extrabold", l.missing && "line-through decoration-2")}>{label}</span>
                  <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                    {l.swap ? `instead of ${l.item.productName} · ` : ing ? `${ing.name} · ` : ""}
                    {st?.name.replace(/ \(.*\)$/, "") ?? ""}
                    {ing && !l.missing ? ` · ${formatCanonical(amountOf(l), ing.canonicalUnit, ing.unitWeightG)}` : ""}
                  </span>
                </span>
                <Stepper label={`Packs of ${l.item.productName}`} decLabel={`Fewer ${l.item.productName}`} incLabel={`More ${l.item.productName}`} value={l.packs} min={1} max={99} onChange={(v) => update(l.id, { packs: v })} className={cn(l.missing && "invisible")} />
                <button
                  type="button"
                  aria-pressed={l.missing}
                  onClick={() => update(l.id, { missing: !l.missing })}
                  aria-label={`${l.item.productName} ${l.missing ? "didn't come" : "arrived"}`}
                  className={cn("h-11 min-w-[4.25rem] flex-none cursor-pointer rounded-ui border-2 border-line px-1.5 font-mono text-[0.625rem] font-bold", l.missing ? "bg-ink text-base" : "bg-base text-ink")}
                >
                  {l.missing ? "DIDN'T COME" : "GOT IT"}
                </button>
              </div>
              {l.item.ingredientId && !l.missing ? (
                swapping === l.id ? (
                  <SwapPicker uid={uid} onPick={(x) => (update(l.id, { swap: x }), setSwapping(null))} onCancel={() => setSwapping(null)} />
                ) : (
                  <button type="button" onClick={() => (l.swap ? update(l.id, { swap: undefined }) : setSwapping(l.id))} className="cursor-pointer self-start bg-transparent p-0 text-[0.75rem] font-extrabold text-ink underline">
                    {l.swap ? "Undo substitution" : "Got something else instead"}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </SheetContent>
  );
}

function SwapPicker({ uid, onPick, onCancel }: { uid: string; onPick: (i: IngredientEntry) => void; onCancel: () => void }) {
  const ing = useAllIngredients();
  return (
    <div className="flex flex-col gap-2 rounded-ui border-2 border-dashed border-line p-2">
      <IngredientPicker ingredients={ing.list ?? []} onPick={(i) => onPick(i)} uid={uid} label="What arrived instead" autoFocus />
      <Button size="sm" variant="ghost" className="self-start" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
