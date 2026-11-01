// The PC Express client (TECHNICAL_SPECS §8 "Prices"): store search, product search, and price lookup, sent with the
// website's public API key only (no account, no sign-in: the website shows all three to signed-out visitors). The key
// is saved by the owner in Settings → Stores (R6.28) in `pcxSession/config` and read on every call, so a rotated key
// needs no deploy. Under the Functions emulator it always talks to the stub (./stub.ts), never to PC Express.
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_PCX_STORE_ID, isDefaultPcxStore, parsePackageSize, PCX_DEFAULT_STORE_MATCH, type PcxProduct, type PcxStore } from "@solving-food/core";
import { db } from "../admin";
import { headers, parseProduct, parseSearch, parseStores, pcxConfig, searchBody, urls, type PcxConfig, type RawProduct } from "./endpoints";
import { STUB_CONFIG, stubFetchFor, stubMode } from "./stub";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PcxDeps {
  fetch: Fetch;
  config: PcxConfig;
  now: () => number;
}

export class PcxError extends Error {}

export const SESSION_DOC = "pcxSession/state";
/** Function-only: { apiKey, updatedAt, updatedBy }, written by pcxSetKey. Under the emulator one per household, so
 *  parallel e2e runs don't share it. */
export function configDoc(hid?: string): string {
  return isEmulator() && hid ? `pcxSession/config_${hid}` : "pcxSession/config";
}
const TIMEOUT_MS = 10_000;

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || process.env.PCX_STUB === "1";
}

/** The saved public API key, or "" when none is saved (PC Express off). */
export async function storedKey(hid?: string): Promise<string> {
  const k = (await db.doc(configDoc(hid)).get()).data()?.apiKey;
  return typeof k === "string" ? k : "";
}

/**
 * The live dependencies, the stub's under the emulator, or null when PC Express isn't connected (estimates only).
 * `apiKey` tries a key before it is in use (pcxSetKey); otherwise the saved one is used. The emulator never reads the
 * saved key (the stub takes its own key unless one is being tried), so e2e tests of the setting can't break others.
 */
export async function pcxDeps(hid?: string, apiKey?: string): Promise<PcxDeps | null> {
  if (isEmulator()) {
    if ((await stubMode(hid)) === "notConfigured") return null;
    return { fetch: stubFetchFor(hid), config: { ...STUB_CONFIG, apiKey: apiKey ?? STUB_CONFIG.apiKey }, now: Date.now };
  }
  const key = apiKey ?? (await storedKey());
  if (!key) return null;
  return { fetch: globalThis.fetch.bind(globalThis), config: pcxConfig(key), now: Date.now };
}

export const NOT_CONNECTED = "PC Express isn't connected yet: prices come from the estimates.";
export const NOT_CONNECTED_OWNER = "PC Express is off until its API key is saved below: prices come from the estimates.";

export class PcxClient {
  constructor(private readonly d: PcxDeps) {}

  private async call(url: string, init: RequestInit = {}): Promise<unknown> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await this.d.fetch(url, { ...init, headers: { ...headers(this.d.config), ...(init.headers as Record<string, string> | undefined) }, signal: ctl.signal });
      if (!res.ok) throw new PcxError(`PC Express answered ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof PcxError) throw e;
      throw new PcxError(`PC Express didn't answer: ${(e as Error).message}`);
    } finally {
      clearTimeout(t);
    }
  }

  async stores(): Promise<PcxStore[]> {
    const json = await this.call(urls.stores(this.d.config), {});
    return parseStores(json);
  }

  async searchStores(query: string): Promise<PcxStore[]> {
    const q = query.trim().toLowerCase();
    return (await this.stores()).filter((s) => `${s.name} ${s.address}`.toLowerCase().includes(q)).slice(0, 15);
  }

  /** The store's PC Express ID: the default placeholder is resolved by name once (Loblaws Greenbank Road) and cached. */
  async resolveStoreId(id: string): Promise<string> {
    if (!isDefaultPcxStore(id)) return id;
    const s = (await db.doc(SESSION_DOC).get()).data();
    if (typeof s?.defaultStoreId === "string") return s.defaultStoreId;
    const match = (await this.stores()).find((x) => PCX_DEFAULT_STORE_MATCH.test(`${x.name} ${x.address}`));
    if (!match) throw new PcxError("Couldn't find Loblaws Greenbank Road in the store search; pick a store in Settings → Stores");
    await db.doc(SESSION_DOC).set({ defaultStoreId: match.storeId, defaultStoreName: match.name }, { merge: true });
    return match.storeId;
  }

  async searchProducts(query: string, pcxStoreId: string): Promise<PcxProduct[]> {
    const store = await this.resolveStoreId(pcxStoreId);
    const json = await this.call(urls.search(this.d.config), { method: "POST", body: JSON.stringify(searchBody(this.d.config, query, store, this.d.now())) });
    return parseSearch(json).map(toProduct);
  }

  async product(code: string, pcxStoreId: string): Promise<PcxProduct | null> {
    const store = await this.resolveStoreId(pcxStoreId);
    const raw = parseProduct(await this.call(urls.product(this.d.config, code, store, this.d.now()), {}));
    return raw ? toProduct(raw) : null;
  }
}

export function toProduct(r: RawProduct): PcxProduct {
  const p: PcxProduct = { productCode: r.productCode, name: r.name.slice(0, 200) };
  if (r.brand) p.brand = r.brand.slice(0, 100);
  if (r.packageSize) {
    p.packageSize = r.packageSize.slice(0, 60);
    const pack = parsePackageSize(r.packageSize);
    if (pack) {
      p.packAmount = pack.packAmount;
      p.packMeasure = pack.packMeasure;
    }
  }
  if (r.imageUrl && /^https:\/\//.test(r.imageUrl)) p.imageUrl = r.imageUrl.slice(0, 1000);
  if (r.priceCents !== undefined && r.priceCents >= 0) p.priceCents = r.priceCents;
  return p;
}

/** Records the module's health for the status line in Settings (no secrets, no token). */
export async function recordStatus(ok: boolean, message?: string): Promise<void> {
  await db
    .doc(SESSION_DOC)
    .set(ok ? { lastOkAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete() } : { lastErrorAt: FieldValue.serverTimestamp(), lastError: (message ?? "error").slice(0, 300) }, { merge: true })
    .catch(() => undefined);
}

export { DEFAULT_PCX_STORE_ID };
