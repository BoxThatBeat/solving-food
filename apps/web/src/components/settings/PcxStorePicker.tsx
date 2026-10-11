// <PcxStorePicker> (PRD R6.22; TECHNICAL_SPECS §8 "Store selection"): the household's PC Express store, chosen with the
// in-app store search (callable pcxSearchStores). The default is Loblaws Greenbank Road. Says plainly when PC Express
// isn't connected (prices then come from the estimates).
import * as React from "react";
import { isDefaultPcxStore, type PcxStore } from "@solving-food/core";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { callError, searchPcxStores, usePcxStatus } from "@/data/pcx";
import { savePcxStore } from "@/data/plan";

export function PcxStatusLine({ hid }: { hid: string }) {
  const status = usePcxStatus(hid);
  if (!status) return <p className="m-0 font-mono text-[0.6875rem] font-bold uppercase">Checking PC Express…</p>;
  return (
    <p role="status" data-testid="pcx-status" className={status.connected ? "m-0 font-mono text-[0.6875rem] font-bold uppercase" : "m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold"}>
      {status.connected ? `PC Express connected${status.message ? ` · ${status.message}` : ""}` : `PC Express not connected. ${status.message ?? ""}`}
    </p>
  );
}

export function PcxStorePicker({ hid, storeId, storeName }: { hid: string; storeId: string; storeName?: string | undefined }) {
  const notify = useNotify();
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ stores: PcxStore[]; message?: string | undefined; connected: boolean } | null>(null);
  const current = storeName ?? (isDefaultPcxStore(storeId) ? "Loblaws Greenbank Road (default)" : storeId);

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setResult(await searchPcxStores(hid, q.trim()));
    } catch (e) {
      setResult({ stores: [], connected: false, message: callError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3" data-testid="pcx-store-picker">
      <CardTitle>PC Express store</CardTitle>
      <p className="m-0 text-[0.8125rem] font-semibold">Live prices come from this store. Without PC Express, the estimated price list is used.</p>
      <div className="flex flex-col gap-0.5 rounded-ui border-2 border-line bg-mantle px-2.5 py-2">
        <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">CURRENT STORE</span>
        <span className="text-[0.9375rem] font-extrabold" data-testid="pcx-current-store">
          {current}
        </span>
      </div>
      <PcxStatusLine hid={hid} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input aria-label="Search PC Express stores" placeholder="Search stores: name, street, or town" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" variant="ink" disabled={busy || q.trim().length < 2}>
          {busy ? "…" : "Search"}
        </Button>
      </form>
      {result && !result.connected ? <p className="m-0 text-[0.8125rem] font-bold">{result.message}</p> : null}
      {result?.connected && !result.stores.length ? <p className="m-0 text-[0.8125rem] font-bold">No stores match.</p> : null}
      {result?.stores.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Stores found">
          {result.stores.map((st) => (
            <li key={st.storeId} className="flex items-center gap-2 rounded-ui border-2 border-line bg-base px-2.5 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[0.875rem] font-extrabold">{st.name}</span>
                <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">{st.address}</span>
              </span>
              {st.storeId === storeId ? (
                <span className="font-mono text-[0.625rem] font-bold">CURRENT</span>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    void savePcxStore(hid, st.storeId, st.name).then(
                      () => notify({ kind: "success", message: `Prices now come from ${st.name}` }),
                      (e) => notify({ kind: "error", message: `Couldn't change the store: ${(e as Error).message}` }),
                    )
                  }
                >
                  Use this store
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
