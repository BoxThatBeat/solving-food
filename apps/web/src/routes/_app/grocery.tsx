// The Grocery page (PRD R7.1–R7.6; TECHNICAL_SPECS §8): the list the plan needs, minus supply and ordered lists,
// rounded to packs, brand-mapped, grouped by store. Ticks are live for every member (field updates on the items map).
// Copy hands the PC Express section to ChatGPT and marks the list ordered, with Undo (R7.5). Prototype "Grocery",
// phase "order". Receiving and the freeze prompt arrive with Supply (M3).
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import {
  copyText,
  formatCanonical,
  formatCents,
  formatPeriodRange,
  groupByStore,
  manualItem,
  mergeDraft,
  pcExpressLines,
  type GroceryItem,
  type StoreEntry,
} from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { addLine, addManualItem, DRAFT_ID, syncDraft, millis, orderDraft, removeItem, tickItem, undoOrder, type StoredList } from "@/data/plan";
import { usePlanModel } from "@/data/planModel";
import { searchIngredients, useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/grocery")({
  component: GroceryPage,
});

const ORDERED_AT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function GroceryPage() {
  const s = useReadySession();
  const notify = useNotify();
  const m = usePlanModel();
  const draftItems = m.draft.data?.items;
  const [fallbackText, setFallbackText] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Regenerate (§8): keep the stored draft in step with the plan. Manual lines and ticks survive; field-level writes.
  const sync = React.useCallback(async () => {
    if (!m.ready || m.draft.data === undefined || !m.periodId) return;
    // Cheap check on the snapshot first; the transaction re-reads before writing.
    const { set, remove } = mergeDraft(m.draft.data?.items ?? {}, m.built.items);
    if (!Object.keys(set).length && !remove.length && m.draft.data && m.draft.data.periodId === m.periodId) return;
    await syncDraft(m.hid, m.periodId, m.built.items);
  }, [m.ready, m.draft.data, m.built.items, m.periodId, m.hid]);
  React.useEffect(() => {
    const t = setTimeout(() => void sync().catch((e) => console.warn("grocery sync failed", e)), 300);
    return () => clearTimeout(t);
  }, [sync]);

  // What the page shows: fresh plan lines (with the stored ticks) plus the stored manual lines.
  const items: Record<string, GroceryItem> = React.useMemo(() => {
    const out: Record<string, GroceryItem> = {};
    for (const [id, it] of Object.entries(m.built.items)) {
      const stored = draftItems?.[id];
      out[id] = { ...it, checked: stored?.checked ?? false, ...(stored?.checkedBy ? { checkedBy: stored.checkedBy } : {}) };
    }
    for (const [id, it] of Object.entries(draftItems ?? {})) if (it.source !== "plan") out[id] = it;
    return out;
  }, [m.built.items, draftItems]);

  const groups = groupByStore(items, m.stores);
  const pcxCount = pcExpressLines(items, m.stores).length;
  const startMs = millis(m.period?.start);
  const endMs = millis(m.period?.end);
  const tz = m.household?.timezone ?? "America/Toronto";

  const markOrdered = async (copied: boolean) => {
    if (!m.periodId) return;
    setBusy(true);
    try {
      await sync(); // the stored draft must hold what's shown
      const listId = await orderDraft(m.hid, m.periodId, items, s.user.uid);
      notify({
        kind: "success",
        message: copied ? `Copied ${pcxCount} item${pcxCount === 1 ? "" : "s"} for ChatGPT · list marked ordered` : "List marked ordered",
        action: { label: "Undo", run: () => void undoOrder(m.hid, listId).catch((e) => notify({ kind: "error", message: `Couldn't undo: ${(e as Error).message}` })) },
      });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't mark the list ordered: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      setFallbackText(null);
    }
  };

  const copy = async () => {
    const text = copyText(items, m.stores);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setFallbackText(text); // clipboard blocked: show the text to copy by hand
      return;
    }
    await markOrdered(true);
  };

  const tick = (listId: string, id: string, on: boolean) => {
    const fail = (e: unknown) => notify({ kind: "error", message: `Couldn't tick it: ${(e as Error).message}` });
    // A plan line not yet in the stored draft (regeneration is debounced): write the whole line, ticked.
    const shown = items[id];
    if (listId === DRAFT_ID && shown && !draftItems?.[id] && m.periodId) {
      const line: GroceryItem = { ...shown, checked: on };
      if (on) line.checkedBy = s.user.uid;
      else delete line.checkedBy;
      return addLine(m.hid, m.periodId, id, line, !!m.draft.data).catch(fail);
    }
    return tickItem(m.hid, listId, id, on, s.user.uid).catch(fail);
  };

  return (
    <PageBody className="max-w-[112.5rem]">
      <div className="flex flex-col gap-1">
        <span className="kicker">{startMs && endMs ? `For the ${formatPeriodRange(startMs, endMs, tz)} plan` : "This period"}</span>
        <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">Grocery</h1>
        <span className="font-mono text-[0.65625rem] font-bold uppercase">Plan needs − supply − ordered · rounded to packs · brand-mapped · food only</span>
      </div>

      {!m.ready ? (
        <p className="m-0 text-sm font-bold">Building the list…</p>
      ) : groups.length === 0 ? (
        <EmptyState>
          Nothing to buy. {m.items.length ? "Supply and ordered lists cover the plan." : "Plan some meals and the list builds itself."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[repeat(auto-fill,minmax(28rem,1fr))]">
          {groups.map((g) => (
            <StoreCard
              key={g.store.id}
              store={g.store}
              lines={g.items}
              ingredients={m.ingredients}
              onTick={(id, on) => tick(DRAFT_ID, id, on)}
              onRemove={(id) => removeItem(m.hid, DRAFT_ID, id).catch(() => notify({ kind: "error", message: "Couldn't remove it" }))}
              footer={
                g.store.kind === "pcExpress" ? (
                  <div className="flex flex-col gap-2 border-t-2 border-line bg-base p-3">
                    <Button size="lg" className="w-full" disabled={busy || !pcxCount} onClick={copy}>
                      Copy for ChatGPT
                    </Button>
                    <button type="button" disabled={busy} onClick={() => void markOrdered(false)} className="cursor-pointer self-center bg-transparent p-1 text-[0.8125rem] font-extrabold text-ink underline">
                      Mark ordered without copying
                    </button>
                  </div>
                ) : null
              }
            />
          ))}
        </div>
      )}

      <AddItem
        stores={m.stores}
        defaultStoreId={m.household?.defaultStoreId}
        onAdd={async (input, ingredient) => {
          if (!m.periodId) return;
          // The picked ingredient may not be one the plan uses yet: give the builder its document.
          const ctx = ingredient ? { ...m.ctx, ingredients: (id: string) => (id === ingredient.id ? ingredient : m.ctx.ingredients(id)) } : m.ctx;
          const item = manualItem(input, ctx);
          await addManualItem(m.hid, m.periodId, item, !!m.draft.data);
          notify({ kind: "success", message: `Added ${item.productName} to the list` });
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => void sync().then(() => notify({ kind: "success", message: "List regenerated from the plan" }))}>
          Regenerate
        </Button>
        <Link to="/settings/brands" className="text-[0.8125rem] font-extrabold text-ink underline">
          Brands
        </Link>
        <Link to="/settings/stores" className="text-[0.8125rem] font-extrabold text-ink underline">
          Stores
        </Link>
      </div>

      {(m.ordered ?? []).length ? (
        <section aria-labelledby="ordered-h" className="flex flex-col gap-3">
          <h2 id="ordered-h" className="m-0 font-display text-[1.375rem] font-normal">
            Ordered · waiting for delivery
          </h2>
          <p className="m-0 text-[0.8125rem] font-semibold text-sub">These count as incoming, so they aren't added again. Confirming the delivery arrives with Supply (M3).</p>
          {[...(m.ordered ?? [])]
            .sort((a, b) => (millis(b.data.orderedAt) ?? 0) - (millis(a.data.orderedAt) ?? 0))
            .map((l) => (
              <OrderedList key={l.id} id={l.id} list={l.data} stores={m.stores} ingredients={m.ingredients} onTick={(id, on) => tick(l.id, id, on)} onUndo={() => void undoOrder(m.hid, l.id).then(() => notify({ kind: "success", message: "Order undone · items back on the list" }))} />
            ))}
        </section>
      ) : null}

      <Sheet open={fallbackText !== null} onOpenChange={(o) => !o && setFallbackText(null)}>
        <SheetContent
          title="Copy for ChatGPT"
          footer={
            <Button className="w-full" disabled={busy} onClick={() => void markOrdered(true)}>
              I copied it · mark ordered
            </Button>
          }
        >
          <p className="m-0 text-sm font-semibold">This browser blocked the clipboard. Select the text and copy it.</p>
          <Textarea readOnly rows={10} value={fallbackText ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="List for ChatGPT" />
        </SheetContent>
      </Sheet>
    </PageBody>
  );
}

function lineSub(it: GroceryItem, ing: IngredientEntry | undefined): string {
  if (it.source === "manual" && !it.ingredientId) return "ADDED BY HAND";
  const name = ing?.name ?? it.ingredientId ?? "";
  const unit = it.measure || "g";
  const pack = it.packAmount
    ? `${it.packs} × ${it.packLabel && !/ k?g$/.test(it.packLabel) ? `${it.packLabel} (${formatCanonical(it.packAmount, unit, ing?.unitWeightG)})` : formatCanonical(it.packAmount, unit, ing?.unitWeightG)}`
    : formatCanonical(it.amount, unit, ing?.unitWeightG);
  if (it.source === "manual") return `${name} · added by hand · ${pack}`;
  return `${name} · need ${formatCanonical(it.need ?? it.amount, unit, ing?.unitWeightG)} → ${pack}`;
}

function StoreCard({
  store,
  lines,
  ingredients,
  onTick,
  onRemove,
  footer,
  readOnlyRemove,
}: {
  store: StoreEntry;
  lines: Array<[string, GroceryItem]>;
  ingredients: Map<string, IngredientEntry>;
  onTick: (id: string, on: boolean) => void;
  onRemove?: (id: string) => void;
  footer?: React.ReactNode;
  readOnlyRemove?: boolean;
}) {
  const total = lines.reduce((a, [, it]) => a + (it.estPriceCents ?? 0), 0);
  const unknown = lines.filter(([, it]) => it.estPriceCents === null).length;
  return (
    <section aria-label={store.name} className="flex flex-col overflow-hidden rounded-ui border-bw bg-base shadow-hard" data-testid={`store-${store.kind}`}>
      <header className="flex items-start justify-between gap-2 bg-ink px-3.5 py-2.5 text-base">
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-[1.0625rem] uppercase">{store.name}</span>
          <span className="font-mono text-[0.5625rem] font-bold tracking-[0.06rem] uppercase">{store.kind === "pcExpress" ? "Paste into ChatGPT · PC Express plugin" : store.bulk ? "In-store checklist · bulk" : "In-store checklist"}</span>
        </span>
        <span className="font-mono text-[0.75rem] font-extrabold whitespace-nowrap">
          ≈ {formatCents(total)}
          {unknown ? ` + ${unknown}?` : ""}
        </span>
      </header>
      <ul className="m-0 list-none p-0">
        {lines.map(([id, it]) => (
          <li key={id} className={cn("flex items-center gap-2.5 border-t-2 border-line px-3.5 py-2 first:border-t-0", it.checked && "bg-mantle")} data-testid="grocery-line">
            <button
              type="button"
              role="checkbox"
              aria-checked={it.checked}
              aria-label={`Got ${it.productName}`}
              onClick={() => onTick(id, !it.checked)}
              className={cn("grid size-7 flex-none cursor-pointer place-items-center rounded-[calc(var(--r)*0.67)] border-2 border-line", it.checked ? "bg-acc text-onc" : "bg-base")}
            >
              {it.checked ? <Check aria-hidden className="size-4" strokeWidth={4} /> : null}
            </button>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn("text-[0.9375rem] leading-tight font-extrabold", it.checked && "line-through decoration-2")}>
                {it.productName}
                {it.packLabel && !it.productName.includes(it.packLabel) ? `, ${it.packLabel}` : ""}
              </span>
              <span className="font-mono text-[0.625rem] font-semibold text-sub">{lineSub(it, it.ingredientId ? ingredients.get(it.ingredientId) : undefined)}</span>
            </span>
            <span className="flex flex-none flex-col items-end">
              <span className="font-mono text-[0.8125rem] font-extrabold">×{it.packs}</span>
              <span className="font-mono text-[0.625rem] font-semibold text-sub">{it.estPriceCents === null ? "price ?" : formatCents(it.estPriceCents)}</span>
            </span>
            {it.source !== "plan" && onRemove && !readOnlyRemove ? (
              <button type="button" aria-label={`Remove ${it.productName}`} onClick={() => onRemove(id)} className="grid size-9 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink">
                <X aria-hidden className="size-4" strokeWidth={3} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {footer}
    </section>
  );
}

function OrderedList({ id, list, stores, ingredients, onTick, onUndo }: { id: string; list: StoredList; stores: readonly StoreEntry[]; ingredients: Map<string, IngredientEntry>; onTick: (id: string, on: boolean) => void; onUndo: () => void }) {
  const at = millis(list.orderedAt);
  return (
    <div className="flex flex-col gap-2.5 rounded-ui border-2 border-dashed border-line p-3" data-testid="ordered-list" data-list={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[0.6875rem] font-bold uppercase">Ordered {at ? ORDERED_AT.format(new Date(at)) : "just now"} · {Object.keys(list.items).length} items</span>
        <Button size="sm" variant="secondary" onClick={onUndo}>
          Undo order
        </Button>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[repeat(auto-fill,minmax(28rem,1fr))]">
        {groupByStore(list.items, stores).map((g) => (
          <StoreCard key={g.store.id} store={g.store} lines={g.items} ingredients={ingredients} onTick={onTick} />
        ))}
      </div>
    </div>
  );
}

/** Manual additions (R7.6): free text, or an ingredient (priced and stored like plan lines, in packs). */
function AddItem({ stores, defaultStoreId, onAdd }: { stores: readonly StoreEntry[]; defaultStoreId?: string | undefined; onAdd: (input: { ingredientId?: string; freeText?: string; packs: number; storeId?: string }, ingredient?: IngredientEntry) => Promise<void> }) {
  const [text, setText] = React.useState("");
  // The whole ingredient list only once someone types (475 documents per listener).
  const ing = useAllIngredients(text.trim().length > 0);
  const [picked, setPicked] = React.useState<IngredientEntry | null>(null);
  const [storeId, setStoreId] = React.useState<string>("");
  const [packs, setPacks] = React.useState(1);
  const suggestions = picked ? [] : searchIngredients(ing.list ?? [], text, 4);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked && !text.trim()) return;
    const input = { ...(picked ? { ingredientId: picked.id } : { freeText: text.trim() }), packs, ...(storeId ? { storeId } : {}) };
    const ingredient = picked ?? undefined;
    // Clear first: the write may resolve after the next item has been typed.
    setText("");
    setPicked(null);
    setPacks(1);
    await onAdd(input, ingredient);
  };
  return (
    <form onSubmit={submit} className="flex max-w-[60rem] flex-col gap-2" aria-label="Add to the list">
      <div className="flex flex-wrap items-stretch gap-2">
        <Input
          aria-label="Add any food item"
          placeholder="Add any food item…"
          value={picked ? picked.name : text}
          onChange={(e) => {
            setPicked(null);
            setText(e.target.value);
          }}
          className="min-w-[12rem] flex-1"
        />
        <Input aria-label="Quantity" type="number" min={1} max={99} value={packs} onChange={(e) => setPacks(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} className="w-[5.5rem] flex-none" />
        <Select aria-label="Store" value={storeId || defaultStoreId || ""} onChange={(e) => setStoreId(e.target.value)} className="w-auto flex-none">
          {stores.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="ink" disabled={!picked && !text.trim()}>
          Add
        </Button>
      </div>
      {suggestions.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">Use ingredient:</span>
          {suggestions.map((i) => (
            <button key={i.id} type="button" onClick={() => setPicked(i)} className="cursor-pointer rounded-ui border-2 border-line bg-base px-2 py-1 text-xs font-extrabold text-ink shadow-hard-sm">
              {i.name}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
