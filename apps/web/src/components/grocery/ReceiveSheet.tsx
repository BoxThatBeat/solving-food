// Confirm groceries (PRD R7.8, R7.9; TECHNICAL_SPECS §8 "Confirming a purchase"; prototype sheet "conf"). The ordered
// list's items, all assumed bought: change pack counts, swap a substitution for another ingredient, or mark one as
// "didn't come". A bulk-store item that freezes asks "Freeze some of this?" next. One `receiveGroceries` command
// adds it all to supply, updates the staples cadence, and marks the list received.
// M25 (R7.15–R7.17): **From a receipt** reads a receipt photo or the order email's text with Gemini (`readReceipt`) and
// prefills the sheet: pack counts, substitutions, didn't-come lines and the price paid per line, each marked "from
// receipt" and editable; receipt lines that weren't on the list can be added to Supply or ignored. Nothing is written
// until Confirm, which sends the same receiveGroceries command with the paid prices.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Camera, ImageUp, ReceiptText } from "lucide-react";
import { extraAmount, formatCanonical, formatCents, receiptArrival, type GroceryItem, type MatchedLine, type StoreEntry } from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useNotify } from "@/components/notifications-context";
import { useAllIngredients, useIngredientsById, type IngredientEntry } from "@/data/ingredients";
import { sendCommand } from "@/data/supply";
import { readReceipt, useAiStatus, type ReceiptResult } from "@/data/ai";
import { callError } from "@/data/pcx";
import { photoForGemini } from "@/lib/images";
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
  /** An exact canonical amount from the receipt (sold by weight, or sizes that aren't whole packs); null = packs. */
  amount?: number | null;
  /** The line total paid, cents, from the receipt or typed. */
  paidCents?: number | null;
  /** Fields the receipt set and nobody has changed since (each is marked "from receipt"). */
  from?: ReceiptFields;
}

type ReceiptField = "packs" | "missing" | "swap" | "paid";
type ReceiptFields = Partial<Record<ReceiptField, true>>;

/** A receipt line that wasn't on the list (R7.16): added to Supply as a line of its own, or ignored (the default). */
interface Extra {
  id: string;
  line: MatchedLine;
  ingredient?: IngredientEntry | undefined;
  add: boolean;
  paidCents: number | null;
  picking?: boolean;
}

const RECEIPT_FIELD_LABEL: Record<ReceiptField, string> = { packs: "packs", missing: "didn't come", swap: "substitution", paid: "price" };
const receiptMark = "outline-2 outline-dashed outline-offset-2 outline-peach";

/** "$4.99" → 499; "" → null; nonsense → undefined (keep what was there). */
function parseDollars(text: string): number | null | undefined {
  const t = text.replace(/[$\s]/g, "");
  if (!t) return null;
  if (!/^\d{1,5}(\.\d{0,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

const without = (from: ReceiptFields | undefined, f: ReceiptField): ReceiptFields | undefined => {
  if (!from?.[f]) return from;
  const next = { ...from };
  delete next[f];
  return next;
};

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
  ingredients: ReadonlyMap<string, IngredientEntry>;
  hid: string;
  uid: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? <ReceiveBody listId={listId} items={items} stores={stores} ingredients={ingredients} hid={hid} uid={uid} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function ReceiveBody({ listId, items, stores, ingredients: given, hid, uid, close }: { listId: string; items: Record<string, GroceryItem>; stores: readonly StoreEntry[]; ingredients: ReadonlyMap<string, IngredientEntry>; hid: string; uid: string; close: () => void }) {
  const notify = useNotify();
  // The list's own ingredients (freezable? default location?), whatever the page happened to load.
  const ids = Object.values(items).flatMap((it) => (it.ingredientId ? [it.ingredientId] : []));
  const own = useIngredientsById(ids);
  const ingredients = own.size >= new Set(ids).size ? own : given;
  // Stores too: the freeze prompt depends on the store being a bulk one.
  const ready = ids.every((id) => ingredients.has(id)) && stores.length > 0;
  const [lines, setLines] = React.useState<Line[]>(() =>
    Object.entries(items)
      .sort(([, a], [, b]) => a.storeId.localeCompare(b.storeId) || a.productName.localeCompare(b.productName))
      .map(([id, item]) => ({ id, item, packs: item.packs || 1, missing: false })),
  );
  const [step, setStep] = React.useState<"list" | "receipt" | "freeze">("list");
  const [receipt, setReceipt] = React.useState<ReceiptResult | null>(null);
  const [extras, setExtras] = React.useState<Extra[]>([]);
  // Ingredients the receipt named that the list didn't (substitutes, lines not on the list): loaded, then applied.
  const receiptIds = React.useMemo(() => [...new Set((receipt?.lines ?? []).flatMap((l) => (l.ingredientId ? [l.ingredientId] : [])))], [receipt]);
  const receiptIngs = useIngredientsById(receiptIds);
  const [applied, setApplied] = React.useState<ReceiptResult | null>(null);
  // An ingredient that never loads (deleted since) mustn't hold the prefill up: after a few seconds it goes without it.
  const [overdue, setOverdue] = React.useState<ReceiptResult | null>(null);
  React.useEffect(() => {
    if (!receipt) return;
    const t = setTimeout(() => setOverdue(receipt), 5000);
    return () => clearTimeout(t);
  }, [receipt]);
  const [freezeQueue, setFreezeQueue] = React.useState<string[]>([]);
  const [swapping, setSwapping] = React.useState<string | null>(null);
  const storeOf = (id: string) => stores.find((s) => s.id === id);
  const ingOf = (l: Line) => l.swap ?? (l.item.ingredientId ? ingredients.get(l.item.ingredientId) : undefined);
  const amountOf = (l: Line) => {
    if (l.missing) return 0;
    if (l.amount != null) return l.amount;
    const a = perPack(l.item) * l.packs;
    // A substitute counted differently (eggs by count for a weighed item): count the packs, or weigh them by unit weight.
    const from = l.item.measure === "count" ? "count" : "g";
    if (l.swap && l.swap.canonicalUnit !== from) return l.swap.canonicalUnit === "count" ? l.packs : l.packs * (l.swap.unitWeightG ?? 100);
    return Math.round(a * 1000) / 1000;
  };
  const changed = !!receipt || lines.some((l) => l.missing || l.swap || l.packs !== (l.item.packs || 1));
  const update = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  /** A person's edit: the field is theirs now, no longer "from receipt". */
  const edit = (id: string, f: ReceiptField, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch, from: without(l.from, f) } : l)));

  // Prefill from the receipt once its ingredients are here (R7.16): matched lines get packs, a substitution and the
  // price; ordered lines it doesn't mention didn't come; its other lines wait under "Not on the list".
  // (State adjusted while rendering, React's pattern for state derived from a new value: no effect, no extra commit.)
  if (receipt && applied !== receipt && ((ready && receiptIds.every((id) => receiptIngs.has(id))) || overdue === receipt)) {
    setApplied(receipt);
    const missing = new Set(receipt.missing);
    setLines((ls) =>
      ls.map((l): Line => {
        const base: Line = { id: l.id, item: l.item, packs: l.item.packs || 1, missing: false };
        if (missing.has(l.id)) return { ...base, missing: true, from: { missing: true } };
        const got = receipt.lines.filter((r) => r.itemId === l.id);
        if (!got.length) return base;
        const sub = got.find((r) => r.substitutedFor && r.ingredientId && r.ingredientId !== l.item.ingredientId);
        const swap = sub ? receiptIngs.get(sub.ingredientId!) : undefined;
        const ing = swap ?? (l.item.ingredientId ? ingredients.get(l.item.ingredientId) : undefined);
        const a = receiptArrival(l.item, got, ing);
        return { ...base, packs: a.packs, amount: a.amount, swap, paidCents: a.paidCents, from: { packs: true, ...(swap ? { swap: true } : {}), ...(a.paidCents !== null ? { paid: true } : {}) } };
      }),
    );
    setExtras(
      receipt.lines
        .filter((r) => !r.itemId && !r.notAvailable && r.quantity > 0)
        .map((r, i) => ({ id: `receipt-${i + 1}`, line: r, ingredient: r.ingredientId ? receiptIngs.get(r.ingredientId) : undefined, add: false, paidCents: r.lineTotalCents })),
    );
  }
  const extraAmountOf = (x: Extra) => (x.ingredient ? extraAmount(x.line, x.ingredient) : null);
  const updateExtra = (id: string, patch: Partial<Extra>) => setExtras((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const added = extras.filter((x) => x.add && x.ingredient && extraAmountOf(x));
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
          ...(!l.missing && l.paidCents != null ? { paidCents: l.paidCents } : {}),
        };
      }).concat(
        added.map((x) => ({ itemId: x.id, ingredientId: x.ingredient!.id, amount: extraAmountOf(x)!, extra: true, name: x.line.description, ...(x.paidCents != null ? { paidCents: x.paidCents } : {}) })),
      ),
      ...(receipt ? { receipt: receipt.totalCents != null ? { totalCents: receipt.totalCents } : {} } : {}),
    });
    const n = ls.filter((l) => !l.missing).length + added.length;
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
        <div className="flex flex-col gap-2.5 rounded-ui border-bw bg-blue-soft p-4 text-onc shadow-hard" data-testid="freeze-prompt">
          <span className="tabular-nums text-[0.65625rem] font-extrabold tracking-[0.045rem]">BULK BUY · {storeOf(current.item.storeId)?.name.toUpperCase()}</span>
          <span className="font-display font-extrabold text-[1.5rem] leading-[1.05]">Freeze some of this?</span>
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

  if (step === "receipt") {
    return (
      <ReceiptStep
        hid={hid}
        listId={listId}
        onBack={() => setStep("list")}
        onRead={(r) => {
          setApplied(null);
          setReceipt(r);
          setStep("list");
        }}
      />
    );
  }

  const fromCount = lines.filter((l) => l.from && Object.keys(l.from).length).length;
  const waiting = !!receipt && applied !== receipt;
  return (
    <SheetContent
      title="Confirm groceries"
      description="Fix anything that changed; change nothing and it all arrived"
      footer={
        <Button size="lg" className="w-full" onClick={confirm} disabled={!lines.length || !ready || waiting}>
          {changed ? "Confirm with changes" : "Everything arrived · add to supply"}
        </Button>
      }
    >
      <p className="m-0 text-[0.8125rem] leading-snug font-semibold">Fix anything that changed: substitutions, out-of-stock, different pack counts. Change nothing and we assume it all arrived.</p>
      {receipt ? (
        <div role="status" className="flex flex-col gap-1 rounded-ui border-bw bg-peach-soft px-3 py-2.5 text-onc shadow-hard-sm" data-testid="receipt-summary">
          <span className="tabular-nums text-[0.625rem] font-extrabold tracking-[0.045rem]">
            From receipt{receipt.store ? ` · ${receipt.store}` : ""}
            {receipt.date ? ` · ${receipt.date}` : ""}
            {receipt.totalCents != null ? ` · total ${formatCents(receipt.totalCents)}` : ""}
          </span>
          <span className="text-[0.8125rem] leading-snug font-bold">
            {waiting
              ? "Filling in the list…"
              : `${receipt.lines.filter((r) => r.itemId && !r.notAvailable).length} matched · ${receipt.missing.length} didn't come · ${extras.length} not on the list. Check the marked fields, then confirm: nothing is added until you do.`}
          </span>
        </div>
      ) : (
        <button type="button" onClick={() => setStep("receipt")} className="press flex min-h-11 cursor-pointer items-center gap-3 rounded-ui border-bw bg-base p-3 text-left text-ink shadow-hard">
          <ReceiptText aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[1rem] font-extrabold">From a receipt</span>
            <span className="text-xs font-semibold text-sub">A photo of the receipt, or the order email: Gemini fills this in for you to check.</span>
          </span>
        </button>
      )}
      <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0" aria-label="Items in this order">
        {lines.map((l, i) => {
          const ing = ingOf(l);
          const st = storeOf(l.item.storeId);
          const label = l.swap ? `${l.swap.name.charAt(0).toUpperCase()}${l.swap.name.slice(1)}` : `${l.item.productName}${l.item.packLabel && !l.item.productName.includes(l.item.packLabel) ? `, ${l.item.packLabel}` : ""}`;
          const from = (Object.keys(l.from ?? {}) as ReceiptField[]).filter((f) => f !== "missing" || l.missing);
          return (
            <li key={l.id} className={cn("flex flex-col gap-2 px-3 py-2.5", i && "border-t-2 border-line")} data-testid="receive-line" data-item={l.id}>
              <div className="flex items-center gap-2">
                <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", l.missing && "opacity-60")}>
                  <span className={cn("text-[0.875rem] leading-tight font-extrabold", l.missing && "line-through decoration-2", l.from?.swap && receiptMark)}>{label}</span>
                  <span className="tabular-nums text-[0.625rem] font-semibold text-sub">
                    {l.swap ? `instead of ${l.item.productName} · ` : ing ? `${ing.name} · ` : ""}
                    {st?.name.replace(/ \(.*\)$/, "") ?? ""}
                    {ing && !l.missing ? ` · ${formatCanonical(amountOf(l), (l.swap ?? ing).canonicalUnit, (l.swap ?? ing).unitWeightG)}` : ""}
                  </span>
                </span>
                <Stepper
                  label={`Packs of ${l.item.productName}`}
                  decLabel={`Fewer ${l.item.productName}`}
                  incLabel={`More ${l.item.productName}`}
                  value={l.packs}
                  min={1}
                  max={99}
                  onChange={(v) => edit(l.id, "packs", { packs: v, amount: null })}
                  className={cn(l.missing && "invisible", l.from?.packs && receiptMark)}
                />
                <button
                  type="button"
                  aria-pressed={l.missing}
                  onClick={() => edit(l.id, "missing", { missing: !l.missing })}
                  aria-label={`${l.item.productName} ${l.missing ? "didn't come" : "arrived"}`}
                  className={cn("h-11 min-w-[4.25rem] flex-none cursor-pointer rounded-ui border-2 border-line px-1.5 tabular-nums text-[0.625rem] font-bold", l.missing ? "bg-ink text-base" : "bg-base text-ink", l.from?.missing && l.missing && receiptMark)}
                >
                  {l.missing ? "DIDN'T COME" : "GOT IT"}
                </button>
              </div>
              {receipt && !l.missing ? (
                <PaidField key={l.paidCents ?? "none"} label={`Paid for ${l.item.productName}`} cents={l.paidCents ?? null} marked={!!l.from?.paid} onChange={(c) => edit(l.id, "paid", { paidCents: c })} />
              ) : null}
              {from.length ? (
                <span className="self-start rounded-ui border-2 border-line bg-peach-soft px-1.5 py-0.5 tabular-nums text-[0.5625rem] font-extrabold tracking-[0.03rem] text-onc" data-testid="from-receipt">
                  From receipt: {from.map((f) => RECEIPT_FIELD_LABEL[f]).join(" · ")}
                </span>
              ) : null}
              {l.item.ingredientId && !l.missing ? (
                swapping === l.id ? (
                  <SwapPicker uid={uid} onPick={(x) => (edit(l.id, "swap", { swap: x, amount: null }), setSwapping(null))} onCancel={() => setSwapping(null)} />
                ) : (
                  <button type="button" onClick={() => (l.swap ? edit(l.id, "swap", { swap: undefined, amount: null }) : setSwapping(l.id))} className="min-h-11 cursor-pointer self-start bg-transparent p-0 text-[0.75rem] font-extrabold text-ink underline">
                    {l.swap ? "Undo substitution" : "Got something else instead"}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      {extras.length ? (
        <section aria-labelledby="not-on-list-h" className="flex flex-col gap-2">
          <h3 id="not-on-list-h" className="m-0 tabular-nums text-[0.6875rem] font-extrabold tracking-[0.045rem]">
            Not on the list · {extras.length}
          </h3>
          <p className="m-0 text-[0.75rem] font-semibold text-sub">On the receipt but not in this order. Add any you want in Supply; the rest are ignored.</p>
          <ul className="m-0 list-none overflow-hidden rounded-ui border-bw bg-base p-0" aria-label="Not on the list">
            {extras.map((x, i) => {
              const amt = extraAmountOf(x);
              return (
                <li key={x.id} className={cn("flex flex-col gap-2 px-3 py-2.5", i && "border-t-2 border-line")} data-testid="receipt-extra">
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[0.875rem] leading-tight font-extrabold">{x.line.description}</span>
                      <span className="tabular-nums text-[0.625rem] font-semibold text-sub">
                        {x.ingredient ? `${x.ingredient.name}${amt ? ` · ${formatCanonical(amt, x.ingredient.canonicalUnit, x.ingredient.unitWeightG)}` : " · no size on the receipt"}` : "no ingredient matched"}
                        {x.paidCents != null ? ` · ${formatCents(x.paidCents)}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-pressed={x.add}
                      disabled={!x.ingredient || !amt}
                      onClick={() => updateExtra(x.id, { add: !x.add })}
                      aria-label={`Add ${x.line.description} to Supply`}
                      className={cn("h-11 min-w-[5.5rem] flex-none cursor-pointer rounded-ui border-2 border-line px-1.5 tabular-nums text-[0.625rem] font-bold disabled:cursor-not-allowed disabled:opacity-50", x.add ? "bg-acc text-onc" : "bg-base text-ink")}
                    >
                      {x.add ? "✓ ADD TO SUPPLY" : "IGNORE"}
                    </button>
                  </div>
                  {x.picking ? (
                    <SwapPicker uid={uid} label="Which ingredient is it?" onPick={(ing) => updateExtra(x.id, { ingredient: ing, picking: false })} onCancel={() => updateExtra(x.id, { picking: false })} />
                  ) : (
                    <button type="button" onClick={() => updateExtra(x.id, { picking: true, add: false })} className="min-h-11 cursor-pointer self-start bg-transparent p-0 text-[0.75rem] font-extrabold text-ink underline">
                      {x.ingredient ? "A different ingredient" : "Pick the ingredient"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {fromCount ? <span className="sr-only">{fromCount} lines prefilled from the receipt</span> : null}
    </SheetContent>
  );
}

/** A line's paid price (M25): prefilled from the receipt, editable; empty = no paid price (the estimate counts). */
function PaidField({ label, cents, marked, onChange }: { label: string; cents: number | null; marked: boolean; onChange: (c: number | null) => void }) {
  // Remounted (key) when the price changes from outside, so the text starts from it.
  const [text, setText] = React.useState(cents != null ? (cents / 100).toFixed(2) : "");
  return (
    <label className="flex items-center gap-2 self-start tabular-nums text-[0.6875rem] font-bold">
      Paid $
      <Input
        aria-label={label}
        inputMode="decimal"
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const c = parseDollars(text);
          if (c === undefined) setText(cents != null ? (cents / 100).toFixed(2) : "");
          else if (c !== cents) onChange(c);
        }}
        className={cn("h-11 w-24 tabular-nums", marked && receiptMark)}
      />
    </label>
  );
}

/** From a receipt (R7.15): a photo (uploaded or taken) or the order email's text, read by Gemini. */
function ReceiptStep({ hid, listId, onBack, onRead }: { hid: string; listId: string; onBack: () => void; onRead: (r: ReceiptResult) => void }) {
  const ai = useAiStatus(hid);
  const off = ai !== null && !ai.connected;
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<null | "photo" | "text">(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (kind: "photo" | "text", input: () => Promise<{ image: { mimeType: string; data: string } } | { text: string }>) => {
    setBusy(kind);
    setError(null);
    try {
      onRead(await readReceipt(hid, listId, await input()));
    } catch (e) {
      setError(callError(e));
    } finally {
      setBusy(null);
    }
  };
  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void run("photo", async () => ({ image: await photoForGemini(f) }));
  };
  const optionClass = "flex min-h-11 cursor-pointer items-center gap-3 rounded-ui border-bw bg-base p-3.5 text-ink shadow-hard has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-55";
  return (
    <SheetContent
      title="From a receipt"
      description="A photo of the receipt, or the order email's text"
      footer={
        <Button variant="secondary" size="lg" className="w-full" onClick={onBack} disabled={!!busy}>
          Back to the list
        </Button>
      }
    >
      <section aria-label="Read a receipt" className="flex flex-col gap-2.5" data-testid="receipt-step">
        <p className="m-0 text-[0.8125rem] leading-snug font-semibold">Gemini reads it and fills in the confirmation: what came, substitutions, what didn&apos;t, and what you paid. You check it before anything goes into Supply. The photo isn&apos;t kept.</p>
        {off ? (
          <p className="m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold">
            Gemini isn&apos;t set up yet{ai?.canEditKey ? "" : " (the app's owner adds its key)"}.{" "}
            <Link to="/settings/gemini" className="font-extrabold text-ink underline">
              Settings → Gemini
            </Link>
          </p>
        ) : null}
        <label className={optionClass} aria-disabled={!!busy || off}>
          <ImageUp aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
          <span className="flex flex-col gap-1">
            <span className="text-lg font-extrabold">Upload a photo of the receipt</span>
            <span className="text-xs font-semibold text-sub">A till receipt, or a screenshot of the order confirmation.</span>
          </span>
          <input type="file" accept="image/*" className="sr-only" onChange={onPhoto} disabled={!!busy || off} aria-label="Upload a photo of the receipt" />
        </label>
        <label className={optionClass} aria-disabled={!!busy || off}>
          <Camera aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
          <span className="flex flex-col gap-1">
            <span className="text-lg font-extrabold">Take a photo of the receipt</span>
            <span className="text-xs font-semibold text-sub">Opens the camera on a phone. Flat, in good light, the whole receipt.</span>
          </span>
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} disabled={!!busy || off} aria-label="Take a photo of the receipt" />
        </label>
        <form
          className="flex flex-col gap-2 rounded-ui border-bw bg-base p-3.5 shadow-hard"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void run("text", async () => ({ text: text.trim() }));
          }}
        >
          <label htmlFor="receipt-text" className="text-lg font-extrabold">
            Or paste the order email
          </label>
          <span className="text-xs font-semibold text-sub">The PC Express confirmation&apos;s text: cheaper for Gemini and exact.</span>
          <Textarea id="receipt-text" rows={5} maxLength={30_000} placeholder="Paste the email's text…" value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy || off} />
          <Button type="submit" variant="ink" className="self-end" disabled={!!busy || off || !text.trim()}>
            {busy === "text" ? "…" : "Read it"}
          </Button>
        </form>
        {busy ? (
          <p role="status" className="m-0 tabular-nums text-[0.6875rem] font-bold" data-testid="receipt-busy">
            Gemini is reading the {busy === "photo" ? "receipt" : "email"}… this takes 5–30 seconds
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold">
            {error}
          </p>
        ) : null}
      </section>
    </SheetContent>
  );
}

function SwapPicker({ uid, onPick, onCancel, label = "What arrived instead" }: { uid: string; onPick: (i: IngredientEntry) => void; onCancel: () => void; label?: string }) {
  const ing = useAllIngredients();
  return (
    <div className="flex flex-col gap-2 rounded-ui border-2 border-dashed border-line p-2">
      <IngredientPicker ingredients={ing.list ?? []} onPick={(i) => onPick(i)} uid={uid} label={label} autoFocus />
      <Button size="sm" variant="ghost" className="self-start" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
