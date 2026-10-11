// The PC Express stub (TECHNICAL_SPECS §14 "weekly maintenance (price refresh against the stub)"): a fetch with canned
// responses in the shapes endpoints.ts parses, used under the Functions emulator (e2e) and by the functions tests.
// The real API is never called from tests. Failure modes come from `_stubPcx/config` { mode } in the emulator, so a
// test can switch them (per household with `_stubPcx/{hid}`): "ok" (default), "notConfigured", "signInFails", "down" (every request 503), "priceFails"
// (product lookups 500, search works).
import { db } from "../admin";
import type { PcxConfig } from "./endpoints";

export type StubMode = "ok" | "notConfigured" | "signInFails" | "down" | "priceFails";

export const STUB_CONFIG: PcxConfig = { base: "https://pcx.stub/api", apiKey: "stub-key", banner: "loblaw", signInUrl: "https://pcx.stub/signin" };

/** Fixture stores. IDs are made up for the stub; the real Greenbank Road ID is looked up at runtime (store search). */
export const STUB_STORES = [
  { storeId: "STUB-1032", name: "Loblaws Greenbank Road", address: { formattedAddress: "3201 Greenbank Rd, Nepean, ON" } },
  { storeId: "STUB-1009", name: "Loblaws Rideau Centre", address: { formattedAddress: "50 Rideau St, Ottawa, ON" } },
  { storeId: "STUB-7700", name: "Real Canadian Superstore Merivale", address: { formattedAddress: "1980 Merivale Rd, Nepean, ON" } },
];

export const STUB_PRODUCTS = [
  { code: "STUB-TOM-400", name: "Mutti Polpa Finely Chopped Tomatoes", brand: "Mutti", packageSize: "400 g", imageAssets: [{ smallUrl: "https://pcx.stub/img/tomatoes.png" }], prices: { price: { value: 3.49, unit: "ea" } } },
  { code: "STUB-TOM-796", name: "No Name Diced Tomatoes", brand: "No Name", packageSize: "796 mL", imageAssets: [], prices: { price: { value: 1.99, unit: "ea" } } },
  { code: "STUB-SPIN-312", name: "PC Organics Baby Spinach", brand: "PC Organics", packageSize: "312 g", imageAssets: [], prices: { price: { value: 5.99, unit: "ea" } } },
  { code: "STUB-MILK-4L", name: "Lactantia 2% Milk", brand: "Lactantia", packageSize: "4 L", imageAssets: [], prices: { price: { value: 6.79, unit: "ea" } } },
  { code: "STUB-EGG-12", name: "PC Large Eggs", brand: "PC", packageSize: "12 ea", imageAssets: [], prices: { price: { value: 4.29, unit: "ea" } } },
];

/** Price changes a test can apply: code → dollars (the weekly refresh then picks them up). */
export const stubPriceOverride = new Map<string, number>();

let modeOverride: StubMode | null = null;
/** Tests set the mode directly; the emulator reads `_stubPcx/config`. */
export function setStubMode(m: StubMode | null) {
  modeOverride = m;
}

/** The mode: a test's override, else `_stubPcx/{hid}` for that household (e2e runs in parallel), else `_stubPcx/config`. */
export async function stubMode(hid?: string): Promise<StubMode> {
  if (modeOverride) return modeOverride;
  const own = hid ? await db.doc(`_stubPcx/${hid}`).get().catch(() => null) : null;
  const s = own?.exists ? own : await db.doc("_stubPcx/config").get().catch(() => null);
  const m = s?.data()?.mode;
  if (s?.exists && typeof s.data()?.prices === "object") for (const [k, v] of Object.entries(s.data()!.prices as Record<string, number>)) stubPriceOverride.set(k, v);
  return m === "notConfigured" || m === "signInFails" || m === "down" || m === "priceFails" ? m : "ok";
}

export const stubCalls: string[] = [];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers like PC Express would, from the fixtures. */
export function stubFetchFor(hid?: string) {
  return (input: string | URL | Request, init?: RequestInit) => stubFetch(input, init, hid);
}

export async function stubFetch(input: string | URL | Request, init?: RequestInit, hid?: string): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const mode = await stubMode(hid);
  stubCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (mode === "down") return json(503, { error: "unavailable" });
  if (url.pathname === "/signin") return mode === "signInFails" ? json(401, { error: "invalid credentials" }) : json(200, { access_token: "stub-token", expires_in: 1800 });
  if (url.pathname.endsWith("/v1/pickup-locations")) return json(200, STUB_STORES);
  if (url.pathname.endsWith("/v1/products/search")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { term?: string };
    const words = String(body.term ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const results = STUB_PRODUCTS.filter((p) => words.every((w) => `${p.name} ${p.brand}`.toLowerCase().includes(w.replace(/s$/, ""))));
    return json(200, { results: results.map(withOverride) });
  }
  const m = /\/v1\/products\/([^/?]+)$/.exec(url.pathname);
  if (m) {
    if (mode === "priceFails") return json(500, { error: "boom" });
    const p = STUB_PRODUCTS.find((x) => x.code === decodeURIComponent(m[1]!));
    return p ? json(200, withOverride(p)) : json(404, { error: "not found" });
  }
  return json(404, { error: "no such stub route" });
}

function withOverride<T extends { code: string; prices: { price: { value: number; unit: string } } }>(p: T): T {
  const v = stubPriceOverride.get(p.code);
  return v === undefined ? p : { ...p, prices: { price: { ...p.prices.price, value: v } } };
}
