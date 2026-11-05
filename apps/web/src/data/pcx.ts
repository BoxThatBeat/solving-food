// PC Express from the app (PRD R6.21, R6.22, R6.28, R7.10): the store and product search callables, the connection
// status, and the owner's API key setting.
// The functions talk to PC Express; until it is switched on they answer { connected: false } and prices stay estimates.
import { httpsCallable } from "firebase/functions";
import type { PcxProductSearchResult, PcxStatus, PcxStoreSearchResult } from "@solving-food/core";
import { functions } from "@/firebase/app";
import { useCallableStatus } from "./callableStatus";

export async function searchPcxStores(hid: string, query: string): Promise<PcxStoreSearchResult> {
  return (await httpsCallable<{ hid: string; query: string }, PcxStoreSearchResult>(functions, "pcxSearchStores")({ hid, query })).data;
}

export async function searchPcxProducts(hid: string, query: string, pcxStoreId: string): Promise<PcxProductSearchResult> {
  return (await httpsCallable<{ hid: string; query: string; pcxStoreId: string }, PcxProductSearchResult>(functions, "pcxSearchProducts")({ hid, query, pcxStoreId })).data;
}

const STATUS_CHANGED = "pcx-status-changed";
const PCX_UNREACHABLE: PcxStatus = { connected: false, message: "Couldn't reach the server to check PC Express." };

/** Saves the public API key (owner only, R6.28; "" turns PC Express off); every status on the page asks again. */
export async function setPcxKey(hid: string, apiKey: string): Promise<PcxStatus> {
  const r = (await httpsCallable<{ hid: string; apiKey: string }, PcxStatus>(functions, "pcxSetKey")({ hid, apiKey })).data;
  window.dispatchEvent(new Event(STATUS_CHANGED));
  return r;
}

/** The module's status, asked once per page view and again after the key changes (null while asking or offline). */
export function usePcxStatus(hid: string | null): PcxStatus | null {
  return useCallableStatus<PcxStatus>(hid, "pcxStatus", STATUS_CHANGED, PCX_UNREACHABLE);
}

/** "Can't search: …" text for a failed callable (rate limit, offline). */
export function callError(e: unknown): string {
  const m = (e as { message?: string }).message ?? String(e);
  return m.replace(/^FirebaseError:\s*/, "");
}
