// Settings → Brands (PRD R7.3, R11.7; spec §8): ingredient → preferred product, pack amount + measure, store. The
// grocery list uses the product name (so ChatGPT orders the right thing), rounds to its pack, and sends it to its store.
// M5: the PC Express product search (R7.10) fills the mapping with an exact product (code, name, pack) and its live
// price; manual entry stays for anything else. Rows show the live price when one is fresh.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { enterableMeasures, formatCents, LIVE_PRICE_MAX_AGE_DAYS, packLabel, type BrandMappingDoc, type Measure, type PcxProduct } from "@solving-food/core";
import { PcxProductSearch } from "@/components/settings/PcxProductSearch";
import { PcxStatusLine } from "@/components/settings/PcxStorePicker";
import { useLivePrices } from "@/data/livePrices";
import { useNow } from "@/data/supply";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useActiveHousehold } from "@/data/households";
import { useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { deleteMapping, saveMapping, useBrandMappings, useStores } from "@/data/plan";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/settings/brands")({
  component: BrandsPage,
});

const MEASURE_UNIT: Record<Measure, string> = { weight: "g", volume: "ml", count: "pieces" };

function BrandsPage() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const notify = useNotify();
  const mappings = useBrandMappings(hh.id);
  const stores = useStores(hh.id);
  const ing = useAllIngredients();
  const [editing, setEditing] = React.useState<{ ingredient: IngredientEntry; m?: BrandMappingDoc } | null>(null);
  const rows = (mappings.docs ?? []).map((d) => ({ id: d.id, m: d.data, name: ing.byId.get(d.id)?.name ?? d.id })).sort((a, b) => a.name.localeCompare(b.name));
  const storeName = (id: string) => stores.docs?.find((x) => x.id === id)?.data.name ?? "a deleted store";
  const live = useLivePrices(hh.data?.pcxStoreId);
  const now = useNow(60_000);
  const priceLine = (m: BrandMappingDoc) => {
    const p = m.productCode ? live.get(m.productCode) : undefined;
    if (!p) return null;
    const days = Math.floor((now - p.fetchedAtMs) / 86_400_000);
    return `${formatCents(p.priceCents)} · ${days > LIVE_PRICE_MAX_AGE_DAYS ? "stale" : "live"} ${days === 0 ? "today" : `${days}d ago`}`;
  };

  return (
    <SettingsPage title="Brands" wide>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-1 p-3.5">
            <CardTitle>Brands</CardTitle>
            <p className="m-0 text-[0.8125rem] font-semibold">The grocery list uses these names so ChatGPT orders the right thing.</p>
          </div>
          <div className="bg-ink px-3.5 py-2 font-mono text-[0.625rem] font-bold tracking-[0.09rem] text-base">INGREDIENT → PREFERRED PRODUCT</div>
          <ul className="m-0 list-none p-0" aria-label="Brand mappings">
            {mappings.docs && rows.length === 0 ? <li className="p-3.5 text-[0.8125rem] font-semibold text-sub">No brands yet. Add one: the list then shows its name and rounds to its pack.</li> : null}
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-t-2 border-line px-3.5 py-2 first:border-t-0" data-testid="brand-row">
                <span className="min-w-[7rem] flex-1 text-[0.8125rem] font-bold text-sub">{r.name}</span>
                <span aria-hidden>→</span>
                <span className="flex flex-[2] flex-col items-end text-right">
                  <span className="text-[0.875rem] font-extrabold">{r.m.productName}</span>
                  <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                    {packLabel(r.m.packAmount, r.m.packMeasure)} · {storeName(r.m.storeId)}
                  </span>
                  {priceLine(r.m) ? (
                    <span className="font-mono text-[0.625rem] font-bold uppercase" data-testid="brand-price">
                      {priceLine(r.m)}
                    </span>
                  ) : r.m.productCode ? (
                    <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">PC Express product · estimate until priced</span>
                  ) : null}
                </span>
                <Button size="sm" variant="secondary" className="shadow-hard-sm" onClick={() => setEditing({ ingredient: ing.byId.get(r.id) ?? ({ id: r.id, name: r.name } as IngredientEntry), m: r.m })} aria-label={`Edit brand for ${r.name}`}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void deleteMapping(hh.id, r.id).catch(() => notify({ kind: "error", message: "Couldn't delete the brand" }))} aria-label={`Delete brand for ${r.name}`}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="gap-3">
          <CardTitle>{editing?.m ? `Edit ${editing.ingredient.name}` : "Add a brand"}</CardTitle>
          {hh.data ? <PcxStatusLine hid={hh.id} /> : null}
          <MappingForm
            key={editing ? `${editing.ingredient.id}:${editing.m ? "e" : "n"}` : "new"}
            hid={hh.id}
            pcxStoreId={hh.data?.pcxStoreId}
            pcxStoreName={hh.data?.pcxStoreName}
            uid={s.user.uid}
            ingredients={ing.list ?? []}
            initial={editing}
            stores={(stores.docs ?? []).map((x) => ({ id: x.id, name: x.data.name, kind: x.data.kind }))}
            defaultStoreId={hh.data?.defaultStoreId}
            onCancel={editing ? () => setEditing(null) : undefined}
            onSave={async (ingredientId, m) => {
              await saveMapping(hh.id, ingredientId, m, s.user.uid);
              notify({ kind: "success", message: `Saved ${m.productName}` });
              setEditing(null);
            }}
          />
        </Card>
      </div>
    </SettingsPage>
  );
}

function MappingForm({
  hid,
  pcxStoreId,
  pcxStoreName,
  uid,
  ingredients,
  initial,
  stores,
  defaultStoreId,
  onSave,
  onCancel,
}: {
  hid: string;
  pcxStoreId: string | undefined;
  pcxStoreName: string | undefined;
  uid: string;
  ingredients: readonly IngredientEntry[];
  initial: { ingredient: IngredientEntry; m?: BrandMappingDoc } | null;
  stores: Array<{ id: string; name: string; kind: string }>;
  defaultStoreId?: string | undefined;
  onSave: (ingredientId: string, m: BrandMappingDoc) => Promise<void>;
  onCancel?: (() => void) | undefined;
}) {
  const [ingredient, setIngredient] = React.useState<IngredientEntry | null>(initial?.ingredient ?? null);
  const [product, setProduct] = React.useState(initial?.m?.productName ?? "");
  const [amount, setAmount] = React.useState(initial?.m ? String(initial.m.packAmount) : "");
  const measures: Measure[] = ingredient?.allowedMeasures ? (enterableMeasures(ingredient).length ? enterableMeasures(ingredient) : ingredient.allowedMeasures) : ["weight", "volume", "count"];
  const [measure, setMeasure] = React.useState<Measure>(initial?.m?.packMeasure ?? measures[0] ?? "weight");
  const m = measures.includes(measure) ? measure : (measures[0] ?? "weight");
  const [chosenStore, setStoreId] = React.useState(initial?.m?.storeId ?? "");
  // Stores arrive with a listener: fall back to the default store (or the first) until one is chosen.
  const storeId = chosenStore || (defaultStoreId && stores.some((x) => x.id === defaultStoreId) ? defaultStoreId : (stores[0]?.id ?? ""));
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | undefined>(initial?.m?.productCode);
  const n = Number(amount);
  const pick = (p: PcxProduct) => {
    setProduct(p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name);
    setCode(p.productCode);
    if (p.packAmount && p.packMeasure) {
      setAmount(String(p.packAmount));
      setMeasure(p.packMeasure);
    }
    // A PC Express product is bought at a PC Express store.
    const pcx = stores.find((x) => x.kind === "pcExpress");
    if (pcx) setStoreId(pcx.id);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ingredient) return setError("Pick an ingredient");
        if (!product.trim()) return setError("Enter the product name");
        if (!(n > 0)) return setError("Enter the pack size");
        if (!storeId) return setError("Pick a store");
        setError(null);
        try {
          await onSave(ingredient.id, { productName: product.trim(), packAmount: n, packMeasure: m, storeId, ...(code ? { productCode: code } : {}) });
        } catch (err) {
          setError(`Couldn't save: ${(err as Error).message}`);
        }
      }}
    >
      {initial?.m ? null : <IngredientPicker ingredients={ingredients} value={ingredient ?? undefined} onPick={(i) => setIngredient(i)} uid={uid} label="Ingredient" />}
      {pcxStoreId ? <PcxProductSearch hid={hid} pcxStoreId={pcxStoreId} initialQuery={initial?.ingredient.name ?? ingredient?.name ?? ""} key={ingredient?.id ?? "none"} onPick={pick} /> : null}
      {code ? (
        <p className="m-0 font-mono text-[0.625rem] font-bold uppercase" data-testid="linked-product">
          Linked to PC Express product {code}
          {pcxStoreName ? ` at ${pcxStoreName}` : ""} ·{" "}
          <button type="button" onClick={() => setCode(undefined)} className="cursor-pointer bg-transparent p-0 font-mono text-[0.625rem] font-bold text-ink uppercase underline">
            Unlink
          </button>
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bm-product" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
          PRODUCT
        </label>
        <Input id="bm-product" placeholder="Mutti Polpa chopped tomatoes" value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bm-amount" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
            PACK SIZE
          </label>
          <Input id="bm-amount" inputMode="decimal" placeholder="400" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-[7rem]" />
        </div>
        <Select aria-label="Pack measure" value={m} onChange={(e) => setMeasure(e.target.value as Measure)} className="w-auto">
          {measures.map((x) => (
            <option key={x} value={x}>
              {MEASURE_UNIT[x]}
            </option>
          ))}
        </Select>
        {n > 0 ? <span className="pb-3 font-mono text-[0.75rem] font-bold">= {packLabel(n, m)}</span> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bm-store" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
          STORE · A BRAND'S STORE BEATS SOURCING RULES
        </label>
        <Select id="bm-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </Select>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm font-extrabold">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit">Save brand</Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
