// PC Express from the app (PRD R6.21, R6.22, R7.10): the store and product search callables and the connection status.
// The functions hold the credentials; with none set they answer { connected: false } and prices stay estimates.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import type { PcxProductSearchResult, PcxStatus, PcxStoreSearchResult } from "@solving-food/core";
import { functions } from "@/firebase/app";

export async function searchPcxStores(hid: string, query: string): Promise<PcxStoreSearchResult> {
  return (await httpsCallable<{ hid: string; query: string }, PcxStoreSearchResult>(functions, "pcxSearchStores")({ hid, query })).data;
}

export async function searchPcxProducts(hid: string, query: string, pcxStoreId: string): Promise<PcxProductSearchResult> {
  return (await httpsCallable<{ hid: string; query: string; pcxStoreId: string }, PcxProductSearchResult>(functions, "pcxSearchProducts")({ hid, query, pcxStoreId })).data;
}

/** The module's status, asked once per page view (null while asking or when offline). */
export function usePcxStatus(hid: string | null): PcxStatus | null {
  const [s, setS] = useState<{ hid: string; status: PcxStatus } | null>(null);
  useEffect(() => {
    if (!hid) return;
    let live = true;
    httpsCallable<{ hid: string }, PcxStatus>(functions, "pcxStatus")({ hid })
      .then((r) => live && setS({ hid, status: r.data }))
      .catch(() => live && setS({ hid, status: { connected: false, message: "Couldn't reach the server to check PC Express." } }));
    return () => {
      live = false;
    };
  }, [hid]);
  return s?.hid === hid ? s.status : null;
}

/** "Can't search: …" text for a failed callable (rate limit, offline). */
export function callError(e: unknown): string {
  const m = (e as { message?: string }).message ?? String(e);
  return m.replace(/^FirebaseError:\s*/, "");
}
