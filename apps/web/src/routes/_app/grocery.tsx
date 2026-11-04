// The Grocery page (PRD R7.1–R7.6; TECHNICAL_SPECS §8): the list the plan needs, minus supply and ordered lists,
// rounded to packs, brand-mapped, grouped by store. Ticks are live for every member (field updates on the items map).
// Copy hands the PC Express section to ChatGPT and marks the list ordered, with Undo (R7.5). Prototype "Grocery",
// phase "order". An ordered list is confirmed on arrival (phase "receipt", R7.8) with the freeze prompt for bulk buys
// (R7.9): <ReceiveSheet> sends one receiveGroceries command. M10 (R7.12): staples that are due are on the list by
// themselves (a "Staples" group in each store card); removing one keeps it off for its usual interval. M17 (R7.13):
// every line has an ×; a plan line taken off stays on the stored draft flagged `removed` (so regeneration doesn't add
// it back, and it isn't shown, copied, ordered, or counted) until the Regenerate button puts every removed line back.
import { useStapleLines } from "@/components/grocery/staples";
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import {
  COPY_INSTRUCTIONS_MAX,
  copyText,
  formatCanonical,
  formatCents,
  formatPeriodRange,
  groupByStore,
  manualItem,
  isGenerated,
  isRemoved,
  mergeDraft,
  pcxStoreForCopy,
  stapleDismissUntil,
  type GroceryItem,
  type StoreEntry,
} from "@solving-food/core";
import { EmptyState, PageBody } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { addLine, addManualItem, dismissStaple, DRAFT_ID, syncDraft, millis, orderDraft, removeItem, saveChatgptInstructions, setLineRemoved, tickItem, undoOrder, type StoredList } from "@/data/plan";
import { usePlanModel } from "@/data/planModel";
import { ReceiveSheet } from "@/components/grocery/ReceiveSheet";
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
  const [fallback, setFallback] = React.useState<{ text: string; storeId: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [receiving, setReceiving] = React.useState<string | null>(null);
  const receivingList = receiving ? (m.ordered ?? []).find((l) => l.id === receiving) : undefined;
  // Lists with a receiveGroceries command still on its way to the server: shown as "adding to supply…".
  const receivingIds = new Set(m.supply.pendingCommands.flatMap((p) => (p.command.type === "receiveGroceries" ? [p.command.payload.listId] : [])));

  // Staples that are due (M10, R7.12): generated like plan lines, never in the budget (R6.4).
  const staples = useStapleLines(m);
  const generated = React.useMemo(() => ({ ...m.built.items, ...staples.lines }), [m.built.items, staples.lines]);

  // Regenerate (§8): keep the stored draft in step with the plan. Manual lines, ticks and removed lines survive;
  // field-level writes. `restore` (the Regenerate button, M17) puts every removed line and staple back.
  const sync = React.useCallback(async (restore = false) => {
    if (!m.ready || !staples.ready || m.draft.data === undefined || !m.periodId) return;
    // Cheap check on the snapshot first; the transaction re-reads before writing.
    const { set, remove } = mergeDraft(m.draft.data?.items ?? {}, generated);
    if (!restore && !Object.keys(set).length && !remove.length && m.draft.data && m.draft.data.periodId === m.periodId) return;
    await syncDraft(m.hid, m.periodId, generated, { restore });
  }, [m.ready, staples.ready, m.draft.data, generated, m.periodId, m.hid]);
  React.useEffect(() => {
    const t = setTimeout(() => void sync().catch((e) => console.warn("grocery sync failed", e)), 300);
    return () => clearTimeout(t);
  }, [sync]);

  // What the page shows: fresh generated lines (plan and staples, with the stored ticks) plus the stored manual lines,
  // without the lines removed with their × (M17).
  const items: Record<string, GroceryItem> = React.useMemo(() => {
    const out: Record<string, GroceryItem> = {};
    for (const [id, it] of Object.entries(generated)) {
      const stored = draftItems?.[id];
      if (stored && isRemoved(stored)) continue;
      out[id] = { ...it, checked: stored?.checked ?? false, ...(stored?.checkedBy ? { checkedBy: stored.checkedBy } : {}) };
    }
    // Stored staple lines wait for the staples to load rather than flicker out.
    for (const [id, it] of Object.entries(draftItems ?? {})) if (!isRemoved(it) && (!isGenerated(it) || (it.source === "staple" && !staples.ready))) out[id] = it;
    return out;
  }, [generated, draftItems, staples.ready]);
  // Removed lines still on the draft (kept through regeneration and orders), and staples kept off: what Regenerate restores.
  const removedLines = React.useMemo(() => Object.fromEntries(Object.entries(draftItems ?? {}).filter(([, it]) => isRemoved(it))), [draftItems]);
  const removedCount = Object.keys(removedLines).filter((id) => id in generated).length + Object.values(m.draft.data?.dismissedStaples ?? {}).filter((until) => until > m.supply.now).length;

  const remove = (id: string) => {
    const it = items[id];
    const fail = () => notify({ kind: "error", message: "Couldn't remove it" });
    if (it?.source === "staple" && it.ingredientId) {
      const ing = staples.ingredientOf(it.ingredientId);
      const until = stapleDismissUntil(ing ?? {}, staples.cadenceOf(it.ingredientId), Date.now(), millis(m.period?.end));
      // Not yet in the stored draft (regeneration is debounced): only the dismissal is written.
      const write = draftItems?.[id] ? dismissStaple(m.hid, id, it.ingredientId, until, m.draft.data?.dismissedStaples, Date.now()) : m.periodId ? addLine(m.hid, m.periodId, id, it, !!m.draft.data).then(() => dismissStaple(m.hid, id, it.ingredientId!, until, m.draft.data?.dismissedStaples, Date.now())) : Promise.resolve();
      return write.then(() => notify({ kind: "success", message: `Removed ${it.productName} · it won't be added again for a while` })).catch(fail);
    }
    if (it?.source === "plan") {
      // M17 (R7.13): the line stays on the draft, flagged, so regeneration doesn't add it back. Supply isn't touched.
      const undo = { label: "Undo", run: () => void setLineRemoved(m.hid, id, false).catch(fail) };
      const write = draftItems?.[id] ? setLineRemoved(m.hid, id, true) : m.periodId ? addLine(m.hid, m.periodId, id, { ...it, removed: true }, !!m.draft.data) : Promise.resolve();
      return write.then(() => notify({ kind: "success", message: `Removed ${it.productName} · Regenerate puts it back`, action: undo })).catch(fail);
    }
    return removeItem(m.hid, DRAFT_ID, id).catch(fail);
  };

  const groups = groupByStore(items, m.stores);
  const startMs = millis(m.period?.start);
  const endMs = millis(m.period?.end);
  const tz = m.household?.timezone ?? "America/Toronto";

  const storeName = (id: string) => m.stores.find((st) => st.id === id)?.name ?? "That store";

  /** Orders one store's lines (R7.14); the other stores stay on the list. An in-store order opens the confirm step. */
  const orderStore = async (storeId: string, how: "copied" | "marked" | "shopped") => {
    if (!m.periodId) return;
    setBusy(true);
    try {
      await sync(); // the stored draft must hold what's shown
      const lines = Object.fromEntries(Object.entries(items).filter(([, it]) => it.storeId === storeId));
      const n = Object.keys(lines).length;
      const listId = await orderDraft(m.hid, m.periodId, storeId, lines, s.user.uid);
      if (how === "shopped") {
        setReceiving(listId);
        return;
      }
      notify({
        kind: "success",
        message: how === "copied" ? `Copied ${n} item${n === 1 ? "" : "s"} for ChatGPT · ${storeName(storeId)} marked ordered` : `${storeName(storeId)} marked ordered`,
        action: { label: "Undo", run: () => void undoOrder(m.hid, listId).catch((e) => notify({ kind: "error", message: `Couldn't undo: ${(e as Error).message}` })) },
      });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't mark it ordered: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      setFallback(null);
    }
  };

  const copy = async (storeId: string) => {
    const only = Object.fromEntries(Object.entries(items).filter(([, it]) => it.storeId === storeId));
    const text = copyText(only, m.stores, { store: pcxStoreForCopy(m.household?.pcxStoreId, m.household?.pcxStoreName), instructions: m.household?.settings?.chatgptInstructions });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setFallback({ text, storeId }); // clipboard blocked: show the text to copy by hand
      return;
    }
    await orderStore(storeId, "copied");
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
              onRemove={(id) => void remove(id)}
              footer={
                g.store.kind === "pcExpress" ? (
                  <div className="flex flex-col gap-2 border-t-2 border-line bg-base p-3">
                    <ChatgptInstructions hid={m.hid} saved={m.household?.settings?.chatgptInstructions ?? ""} />
                    <Button size="lg" className="w-full" disabled={busy || !g.items.length} onClick={() => void copy(g.store.id)}>
                      Copy for ChatGPT
                    </Button>
                    <button type="button" disabled={busy} onClick={() => void orderStore(g.store.id, "marked")} className="cursor-pointer self-center bg-transparent p-1 text-[0.8125rem] font-extrabold text-ink underline">
                      Mark ordered without copying
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 border-t-2 border-line bg-base p-3">
                    <Button size="lg" variant="secondary" className="w-full" disabled={busy || !g.items.length} onClick={() => void orderStore(g.store.id, "shopped")}>
                      Done shopping · confirm
                    </Button>
                  </div>
                )
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void sync(true)
              .then(() => notify({ kind: "success", message: removedCount ? "List regenerated · removed items are back" : "List regenerated from the plan" }))
              .catch((e) => notify({ kind: "error", message: `Couldn't regenerate: ${(e as Error).message}` }))
          }
        >
          Regenerate
        </Button>
        {removedCount ? (
          <span className="font-mono text-[0.6875rem] font-bold text-sub uppercase" data-testid="removed-count">
            {removedCount} removed · Regenerate puts {removedCount === 1 ? "it" : "them"} back
          </span>
        ) : null}
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
            Ordered · waiting to arrive
          </h2>
          <p className="m-0 text-[0.8125rem] font-semibold text-sub">Each store is its own order. These count as incoming, so they aren't added again. When they arrive, confirm them and they go into Supply.</p>
          {[...(m.ordered ?? [])]
            .sort((a, b) => (millis(b.data.orderedAt) ?? 0) - (millis(a.data.orderedAt) ?? 0))
            .map((l) => (
              <OrderedList
                key={l.id}
                id={l.id}
                list={l.data}
                stores={m.stores}
                ingredients={m.ingredients}
                receiving={receivingIds.has(l.id)}
                onReceive={() => setReceiving(l.id)}
                onTick={(id, on) => tick(l.id, id, on)}
                onUndo={() => void undoOrder(m.hid, l.id).then(() => notify({ kind: "success", message: "Order undone · items back on the list" }))}
              />
            ))}
        </section>
      ) : null}

      {receivingList ? (
        <ReceiveSheet open onOpenChange={(o) => !o && setReceiving(null)} listId={receivingList.id} items={receivingList.data.items} stores={m.stores} ingredients={m.ingredients} hid={m.hid} uid={s.user.uid} />
      ) : null}

      <Sheet open={fallback !== null} onOpenChange={(o) => !o && setFallback(null)}>
        <SheetContent
          title="Copy for ChatGPT"
          footer={
            <Button className="w-full" disabled={busy} onClick={() => fallback && void orderStore(fallback.storeId, "copied")}>
              I copied it · mark ordered
            </Button>
          }
        >
          <p className="m-0 text-sm font-semibold">This browser blocked the clipboard. Select the text and copy it.</p>
          <Textarea readOnly rows={10} value={fallback?.text ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="List for ChatGPT" />
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
  if (it.source === "staple") return `${name} · ${it.stapleReason === "plan" ? "used by planned meals" : it.stapleReason === "out" ? "none left in Supply" : "probably running low"} · ${pack}`;
  if (it.source === "cadence") return `${name} · staple · ${pack}`;
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
        {lines.map(([id, it], i) => (
          <React.Fragment key={id}>
          {(it.source === "staple" || it.source === "cadence") && (i === 0 || (lines[i - 1]![1].source !== "staple" && lines[i - 1]![1].source !== "cadence")) ? (
            <li aria-hidden className="border-t-2 border-line bg-mantle px-3.5 py-1 font-mono text-[0.5625rem] font-bold tracking-[0.06rem] uppercase first:border-t-0" data-testid="staples-divider">
              Staples
            </li>
          ) : null}
          <li className={cn("flex items-center gap-2.5 border-t-2 border-line px-3.5 py-2 first:border-t-0", it.checked && "bg-mantle")} data-testid="grocery-line">
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
            {onRemove && !readOnlyRemove ? (
              <button type="button" aria-label={`Remove ${it.productName}`} title="Remove from the list" onClick={() => onRemove(id)} className="grid size-11 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink sm:size-9">
                <X aria-hidden className="size-4" strokeWidth={3} />
              </button>
            ) : null}
          </li>
          </React.Fragment>
        ))}
      </ul>
      {footer}
    </section>
  );
}

function OrderedList({ id, list, stores, ingredients, onTick, onUndo, onReceive, receiving }: { id: string; list: StoredList; stores: readonly StoreEntry[]; ingredients: Map<string, IngredientEntry>; onTick: (id: string, on: boolean) => void; onUndo: () => void; onReceive: () => void; receiving: boolean }) {
  const at = millis(list.orderedAt);
  const store = list.storeId ? stores.find((st) => st.id === list.storeId) : undefined;
  return (
    <div className="flex flex-col gap-2.5 rounded-ui border-2 border-dashed border-line p-3" data-testid="ordered-list" data-list={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[0.6875rem] font-bold uppercase">
          {store ? `${store.name} · ` : ""}Ordered {at ? ORDERED_AT.format(new Date(at)) : "just now"} · {Object.keys(list.items).length} items
        </span>
        <Button size="sm" variant="secondary" onClick={onUndo} disabled={receiving}>
          Undo order
        </Button>
      </div>
      <button type="button" onClick={onReceive} disabled={receiving} className="press flex cursor-pointer items-center justify-between gap-3 self-start rounded-ui border-bw bg-base px-4 py-3 text-left text-[1rem] font-extrabold text-ink shadow-hard disabled:cursor-wait disabled:opacity-60">
        {receiving ? "Adding to supply…" : "Groceries arrived? Confirm"}
        <span aria-hidden>→</span>
      </button>
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

/** The household's own instructions added to the copied list (R7.5): saved when the box loses focus. */
function ChatgptInstructions({ hid, saved }: { hid: string; saved: string }) {
  const notify = useNotify();
  const [text, setText] = React.useState(saved);
  const [prev, setPrev] = React.useState(saved);
  if (saved !== prev) {
    setPrev(saved);
    setText(saved);
  }
  const save = () => {
    if (text.trim() === saved.trim()) return;
    saveChatgptInstructions(hid, text).catch((e) => notify({ kind: "error", message: `Couldn't save the instructions: ${(e as Error).message}` }));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.06rem] uppercase">Instructions for ChatGPT</span>
      <Textarea rows={2} maxLength={COPY_INSTRUCTIONS_MAX} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="e.g. Default to No Name or President's Choice brands if not specified." className="text-[0.8125rem]" />
    </label>
  );
}
