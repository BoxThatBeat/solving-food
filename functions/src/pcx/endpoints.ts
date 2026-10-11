// Every PC Express URL, header, and response shape in one place (TECHNICAL_SPECS §8 "Prices"): PC Express has no public
// API, so the module uses the JSON endpoints its website calls. If they change, this is the file to fix.
//
// UNVERIFIED: these paths and shapes follow the website as publicly documented by others; they were not called from
// this project (tests use the stub in ./stub.ts). The public web API key and the sign-in URL are configuration
// (functions/.env: PCX_API_KEY, PCX_SIGNIN_URL), read from the website by the owner; they are not secrets.

export interface PcxConfig {
  base: string;
  apiKey: string;
  banner: string;
  /** POST { email, password } → { access_token, expires_in }; empty = requests go without a bearer token. */
  signInUrl: string;
}

export function pcxConfig(env: Record<string, string | undefined> = process.env): PcxConfig {
  return {
    base: env.PCX_BASE_URL || "https://api.pcexpress.ca/pcx-bff/api",
    apiKey: env.PCX_API_KEY || "",
    banner: env.PCX_BANNER || "loblaw",
    signInUrl: env.PCX_SIGNIN_URL || "",
  };
}

export function headers(c: PcxConfig, token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "x-apikey": c.apiKey,
    "x-application-type": "Web",
    "x-loblaw-tenant-id": "ONLINE_GROCERIES",
    "Site-Banner": c.banner,
    "Accept-Language": "en",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** DDMMYYYY, the date format the price endpoints take. */
export function pcxDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`;
}

export const urls = {
  stores: (c: PcxConfig) => `${c.base}/v1/pickup-locations?bannerIds=${encodeURIComponent(c.banner)}`,
  search: (c: PcxConfig) => `${c.base}/v1/products/search`,
  product: (c: PcxConfig, code: string, storeId: string, ms: number) =>
    `${c.base}/v1/products/${encodeURIComponent(code)}?lang=en&storeId=${encodeURIComponent(storeId)}&banner=${encodeURIComponent(c.banner)}&pickupType=STORE&date=${pcxDate(ms)}`,
};

export function searchBody(c: PcxConfig, term: string, storeId: string, ms: number, size = 12) {
  return { term, storeId, banner: c.banner, lang: "en", date: pcxDate(ms), pickupType: "STORE", offerType: "ALL", pagination: { from: 0, size } };
}

// ---------- response parsing (defensive: unknown fields are ignored, missing ones give undefined)

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

export interface RawStore {
  storeId: string;
  name: string;
  address: string;
}

export function parseStores(json: unknown): RawStore[] {
  const list = Array.isArray(json) ? json : (obj(json).locations ?? obj(json).results ?? []);
  const out: RawStore[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const o = obj(x);
    const storeId = str(o.storeId) ?? str(o.id);
    if (!storeId) continue;
    const a = obj(o.address);
    const address = str(a.formattedAddress) ?? [str(a.line1), str(a.town) ?? str(a.city), str(a.region) ?? str(a.province)].filter(Boolean).join(", ");
    out.push({ storeId, name: str(o.name) ?? str(o.storeName) ?? storeId, address: address ?? "" });
  }
  return out;
}

export interface RawProduct {
  productCode: string;
  name: string;
  brand?: string;
  packageSize?: string;
  imageUrl?: string;
  priceCents?: number;
}

function priceOf(o: J): number | undefined {
  const prices = obj(o.prices);
  const p = obj(prices.price);
  const v = num(p.value) ?? num(obj(obj(Array.isArray(o.offers) ? o.offers[0] : undefined).price).value) ?? num(o.price);
  return v === undefined ? undefined : Math.round(v * 100);
}

export function parseProduct(json: unknown): RawProduct | null {
  const o = obj(json);
  const productCode = str(o.code) ?? str(o.productCode) ?? str(o.articleNumber);
  if (!productCode) return null;
  const imgs = Array.isArray(o.imageAssets) ? o.imageAssets.map(obj) : [];
  const out: RawProduct = { productCode, name: str(o.name) ?? str(o.title) ?? productCode };
  const brand = str(o.brand);
  if (brand) out.brand = brand;
  const size = str(o.packageSize) ?? str(o.packageSizing);
  if (size) out.packageSize = size;
  const img = str(imgs[0]?.smallUrl) ?? str(imgs[0]?.mediumUrl) ?? str(o.image);
  if (img) out.imageUrl = img;
  const price = priceOf(o);
  if (price !== undefined) out.priceCents = price;
  return out;
}

export function parseSearch(json: unknown): RawProduct[] {
  const o = obj(json);
  const list = o.results ?? obj(o.data).products ?? o.products ?? [];
  return (Array.isArray(list) ? list : []).map(parseProduct).filter((p): p is RawProduct => !!p);
}

export function parseSignIn(json: unknown): { token: string; expiresInS: number } | null {
  const o = obj(json);
  const token = str(o.access_token) ?? str(o.accessToken) ?? str(o.token);
  if (!token) return null;
  return { token, expiresInS: num(o.expires_in) ?? num(o.expiresIn) ?? 1800 };
}
