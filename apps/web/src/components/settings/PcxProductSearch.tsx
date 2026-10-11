// <PcxProductSearch> (PRD R7.10; TECHNICAL_SPECS §8 "Linking products"): searches PC Express at the household's store
// (callable pcxSearchProducts) and shows each result's name, pack size, image, and current price. Picking one fills
// the brand mapping (product name, code, pack); the callable has already written its price to prices/*.
import * as React from "react";
import { formatCents, type PcxProduct } from "@solving-food/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { callError, searchPcxProducts } from "@/data/pcx";

export function PcxProductSearch({ hid, pcxStoreId, initialQuery, onPick }: { hid: string; pcxStoreId: string; initialQuery?: string; onPick: (p: PcxProduct) => void }) {
  const [q, setQ] = React.useState(initialQuery ?? "");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ products: PcxProduct[]; connected: boolean; message?: string | undefined } | null>(null);
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setResult(await searchPcxProducts(hid, q.trim(), pcxStoreId));
    } catch (e) {
      setResult({ products: [], connected: false, message: callError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-ui border-2 border-dashed border-line p-2.5" data-testid="pcx-product-search">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">SEARCH PC EXPRESS</span>
      <div className="flex gap-2">
        <Input
          aria-label="Search PC Express products"
          placeholder="Product, e.g. Mutti tomatoes"
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="ink" disabled={busy || q.trim().length < 2} onClick={() => void search()}>
          {busy ? "…" : "Search"}
        </Button>
      </div>
      {result && !result.connected ? <p className="m-0 text-[0.8125rem] font-bold">{result.message} Enter the product by hand below.</p> : null}
      {result?.connected && !result.products.length ? <p className="m-0 text-[0.8125rem] font-bold">Nothing found at your store.</p> : null}
      {result?.products.length ? (
        <ul className="m-0 flex max-h-[24rem] list-none flex-col gap-1.5 overflow-y-auto p-0" aria-label="Products found">
          {result.products.map((p) => (
            <li key={p.productCode}>
              <button type="button" onClick={() => onPick(p)} aria-label={`Use ${p.name}`} className="flex w-full cursor-pointer items-center gap-2.5 rounded-ui border-2 border-line bg-base p-2 text-left text-ink">
                <span className="grid size-12 flex-none place-items-center overflow-hidden rounded-[calc(var(--r)*0.6)] border-2 border-line bg-mantle">
                  {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-full object-contain" loading="lazy" /> : <span aria-hidden className="font-mono text-[0.625rem] font-bold">PC</span>}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[0.8125rem] leading-tight font-extrabold">{p.name}</span>
                  <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                    {[p.brand, p.packageSize].filter(Boolean).join(" · ") || "Pack size unknown"}
                  </span>
                </span>
                <span className="flex-none font-mono text-[0.875rem] font-extrabold">{p.priceCents !== undefined ? formatCents(p.priceCents) : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
