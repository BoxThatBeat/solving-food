// The PC Express client (TECHNICAL_SPECS §8 "Prices"): sign-in with the owner's credentials from Secret Manager (exposed
// to the function as PCX_EMAIL / PCX_PASSWORD env vars when the secrets are bound, see index.ts), a token cached in
// memory and in `pcxSession/state` (function-only), and store search, product search, and price lookup. Under the
// Functions emulator it always talks to the stub (./stub.ts), never to PC Express.
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_PCX_STORE_ID, isDefaultPcxStore, parsePackageSize, PCX_DEFAULT_STORE_MATCH, type PcxProduct, type PcxStore } from "@solving-food/core";
import { db } from "../admin";
import { headers, parseProduct, parseSearch, parseSignIn, parseStores, pcxConfig, searchBody, urls, type PcxConfig, type RawProduct } from "./endpoints";
import { STUB_CONFIG, stubFetch, stubMode } from "./stub";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PcxDeps {
  fetch: Fetch;
  config: PcxConfig;
  credentials: { email: string; password: string };
  now: () => number;
}

export class PcxError extends Error {}

export const SESSION_DOC = "pcxSession/state";
const TIMEOUT_MS = 10_000;

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || process.env.PCX_STUB === "1";
}

/** Is the module switched on (secrets bound and the public API key set)? */
export function pcxEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PCX_ENABLED === "true" && !!env.PCX_API_KEY && !!env.PCX_EMAIL && !!env.PCX_PASSWORD;
}

/** The live dependencies, the stub's under the emulator, or null when PC Express isn't connected (estimates only). */
export async function pcxDeps(): Promise<PcxDeps | null> {
  if (isEmulator()) {
    if ((await stubMode()) === "notConfigured") return null;
    return { fetch: stubFetch, config: STUB_CONFIG, credentials: { email: "stub@example.com", password: "stub" }, now: Date.now };
  }
  if (!pcxEnabled()) return null;
  return { fetch: globalThis.fetch.bind(globalThis), config: pcxConfig(), credentials: { email: process.env.PCX_EMAIL!, password: process.env.PCX_PASSWORD! }, now: Date.now };
}

export const NOT_CONNECTED = "PC Express isn't connected yet: prices come from the estimates.";

let memo: { token: string; expiresAt: number } | null = null;
/** Tests reset the in-memory token. */
export function resetTokenCache() {
  memo = null;
}

export class PcxClient {
  /** Set when sign-in failed and requests went out with the API key only. */
  signInError: string | null = null;
  constructor(private readonly d: PcxDeps) {}

  private async call(url: string, init: RequestInit = {}, token?: string | null): Promise<unknown> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await this.d.fetch(url, { ...init, headers: { ...headers(this.d.config, token), ...(init.headers as Record<string, string> | undefined) }, signal: ctl.signal });
      if (!res.ok) throw new PcxError(`PC Express answered ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof PcxError) throw e;
      throw new PcxError(`PC Express didn't answer: ${(e as Error).message}`);
    } finally {
      clearTimeout(t);
    }
  }

  /** A bearer token: memory, then the session doc, then a fresh sign-in. Null when there's no sign-in URL. */
  async token(): Promise<string | null> {
    const now = this.d.now();
    if (!this.d.config.signInUrl) return null;
    if (memo && memo.expiresAt > now + 60_000) return memo.token;
    const s = (await db.doc(SESSION_DOC).get()).data();
    if (typeof s?.token === "string" && typeof s.tokenExpiresAt === "number" && s.tokenExpiresAt > now + 60_000) {
      memo = { token: s.token, expiresAt: s.tokenExpiresAt };
      return memo.token;
    }
    const json = await this.call(this.d.config.signInUrl, { method: "POST", body: JSON.stringify({ email: this.d.credentials.email, password: this.d.credentials.password }) }).catch((e: Error) => {
      throw new PcxError(`Sign-in failed: ${e.message}`);
    });
    const parsed = parseSignIn(json);
    if (!parsed) throw new PcxError("Sign-in failed: no token in the answer");
    memo = { token: parsed.token, expiresAt: now + parsed.expiresInS * 1000 };
    await db.doc(SESSION_DOC).set({ token: memo.token, tokenExpiresAt: memo.expiresAt, signedInAt: FieldValue.serverTimestamp() }, { merge: true });
    return memo.token;
  }

  /** Sign in if possible; a failed sign-in is remembered and requests go out with the API key alone. */
  private async auth(): Promise<string | null> {
    try {
      return await this.token();
    } catch (e) {
      this.signInError = (e as Error).message;
      return null;
    }
  }

  async stores(): Promise<PcxStore[]> {
    const json = await this.call(urls.stores(this.d.config), {}, await this.auth());
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
    const json = await this.call(urls.search(this.d.config), { method: "POST", body: JSON.stringify(searchBody(this.d.config, query, store, this.d.now())) }, await this.auth());
    return parseSearch(json).map(toProduct);
  }

  async product(code: string, pcxStoreId: string): Promise<PcxProduct | null> {
    const store = await this.resolveStoreId(pcxStoreId);
    const raw = parseProduct(await this.call(urls.product(this.d.config, code, store, this.d.now()), {}, await this.auth()));
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
