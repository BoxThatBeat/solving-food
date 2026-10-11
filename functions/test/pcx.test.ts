// PC Express module against the stub (TECHNICAL_SPECS §14 "Functions"): sign-in and token cache, store and product
// search, price lookup and the weekly refresh, failure modes (not connected, sign-in fails, PC Express down, price
// lookups failing: old prices kept, owner notified, the second failed week logged), membership and rate limits.
process.env.PCX_STUB = "1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { DEFAULT_PCX_STORE_ID, priceDocId } from "@solving-food/core";
import { clearFirestore, db } from "./helpers";
import { CallError, pcxStatus, rateLimit, RATE_LIMIT_PER_HOUR, refreshPrices, searchProducts, searchStores } from "../src/pcx";
import { PcxClient, pcxDeps, pcxEnabled, resetTokenCache, SESSION_DOC } from "../src/pcx/client";
import { setStubMode, stubCalls, stubPriceOverride } from "../src/pcx/stub";
import { parseProduct, parseSearch, parseStores, pcxDate } from "../src/pcx/endpoints";
import { runMaintenance } from "../src/maintenance";

const UID = "pcx-member";
const OWNER = "pcx-owner";
const HID = "pcx-home";

async function seedHousehold(store = DEFAULT_PCX_STORE_ID) {
  await db.doc(`households/${HID}`).set({ name: "Home", pcxStoreId: store });
  await db.doc(`households/${HID}/members/${UID}`).set({ uid: UID, displayName: "M", joinedAt: new Date() });
}

beforeEach(async () => {
  await clearFirestore();
  resetTokenCache();
  setStubMode("ok");
  stubPriceOverride.clear();
  stubCalls.length = 0;
  await seedHousehold();
});
afterEach(() => setStubMode(null));

describe("endpoint parsing", () => {
  it("reads stores, search results, and a product defensively", () => {
    expect(parseStores([{ storeId: "1", name: "A", address: { formattedAddress: "1 Main" } }, { nope: 1 }])).toEqual([{ storeId: "1", name: "A", address: "1 Main" }]);
    expect(parseSearch({ results: [{ code: "x", name: "X", packageSize: "400 g", prices: { price: { value: 2.5 } } }, {}] })).toEqual([{ productCode: "x", name: "X", packageSize: "400 g", priceCents: 250 }]);
    expect(parseProduct({ code: "y", offers: [{ price: { value: "1.99" } }] })).toMatchObject({ productCode: "y", priceCents: 199 });
    expect(parseProduct({})).toBeNull();
    expect(pcxDate(Date.UTC(2026, 9, 5))).toBe("05102026");
  });
});

describe("client", () => {
  it("is off without credentials outside the emulator", () => {
    expect(pcxEnabled({})).toBe(false);
    expect(pcxEnabled({ PCX_ENABLED: "true", PCX_API_KEY: "k", PCX_EMAIL: "e", PCX_PASSWORD: "p" })).toBe(true);
    expect(pcxEnabled({ PCX_ENABLED: "true", PCX_API_KEY: "k", PCX_EMAIL: "e" })).toBe(false);
  });

  it("signs in once and caches the token in memory and in the session doc", async () => {
    const c = new PcxClient((await pcxDeps())!);
    expect(await c.token()).toBe("stub-token");
    expect(await c.token()).toBe("stub-token");
    expect(stubCalls.filter((x) => x.endsWith("/signin"))).toHaveLength(1);
    const s = (await db.doc(SESSION_DOC).get()).data()!;
    expect(s.token).toBe("stub-token");
    resetTokenCache();
    await new PcxClient((await pcxDeps())!).token();
    expect(stubCalls.filter((x) => x.endsWith("/signin"))).toHaveLength(1); // from the session doc
  });

  it("resolves the default store by name once", async () => {
    const c = new PcxClient((await pcxDeps())!);
    expect(await c.resolveStoreId(DEFAULT_PCX_STORE_ID)).toBe("STUB-1032");
    expect((await db.doc(SESSION_DOC).get()).data()!.defaultStoreId).toBe("STUB-1032");
    expect(await c.resolveStoreId("OTHER")).toBe("OTHER");
  });
});

describe("callables", () => {
  it("store search: members only, finds by name or address", async () => {
    const r = await searchStores(UID, { hid: HID, query: "greenbank" });
    expect(r).toMatchObject({ connected: true, stores: [{ storeId: "STUB-1032", name: "Loblaws Greenbank Road" }] });
    await expect(searchStores("stranger", { hid: HID, query: "greenbank" })).rejects.toBeInstanceOf(CallError);
    await expect(searchStores(UID, { hid: HID, query: "x" })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("product search returns name, pack, image, price and writes prices for the household's store", async () => {
    const r = await searchProducts(UID, { hid: HID, query: "tomatoes", pcxStoreId: DEFAULT_PCX_STORE_ID });
    expect(r.connected).toBe(true);
    const mutti = r.products.find((p) => p.productCode === "STUB-TOM-400")!;
    expect(mutti).toMatchObject({ name: "Mutti Polpa Finely Chopped Tomatoes", packageSize: "400 g", packAmount: 400, packMeasure: "weight", priceCents: 349, imageUrl: "https://pcx.stub/img/tomatoes.png" });
    const price = (await db.doc(`prices/${priceDocId(DEFAULT_PCX_STORE_ID, "STUB-TOM-400")}`).get()).data()!;
    expect(price).toMatchObject({ priceCents: 349, packAmount: 400, packMeasure: "weight", pcxStoreId: DEFAULT_PCX_STORE_ID, productCode: "STUB-TOM-400" });
    expect((await db.doc(`prices/${priceDocId(DEFAULT_PCX_STORE_ID, "STUB-TOM-796")}`).get()).data()!.packMeasure).toBe("volume");
  });

  it("not connected: no outbound calls, a clear message", async () => {
    setStubMode("notConfigured");
    expect(await searchProducts(UID, { hid: HID, query: "tomatoes", pcxStoreId: "S" })).toMatchObject({ connected: false, products: [] });
    expect((await pcxStatus(UID, { hid: HID })).connected).toBe(false);
    expect(stubCalls).toEqual([]);
  });

  it("PC Express down: not connected with the reason, recorded for the status line", async () => {
    setStubMode("down");
    const r = await searchStores(UID, { hid: HID, query: "loblaws" });
    expect(r.connected).toBe(false);
    expect(r.message).toMatch(/503/);
    expect((await pcxStatus(UID, { hid: HID })).message).toMatch(/503/);
  });

  it("a failed sign-in still searches with the API key and says so", async () => {
    setStubMode("signInFails");
    const r = await searchStores(UID, { hid: HID, query: "loblaws" });
    expect(r.connected).toBe(true);
    expect(r.message).toMatch(/Sign-in failed/);
  });

  it("rate limits per member per hour", async () => {
    const now = Date.now();
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) await rateLimit("busy", now);
    await expect(rateLimit("busy", now)).rejects.toMatchObject({ code: "resource-exhausted" });
    await expect(rateLimit("busy", now + 3_600_001)).resolves.toBeUndefined();
  });
});

describe("weekly price refresh", () => {
  async function mapping(store: string, code: string) {
    await db.doc(`households/${HID}`).set({ name: "Home", pcxStoreId: store });
    await db.doc(`households/${HID}/brandMappings/canned-tomatoes`).set({ productName: "Mutti", productCode: code, packAmount: 400, packMeasure: "weight", storeId: "pc-express" });
  }

  it("refreshes every mapped product at the household's store", async () => {
    await mapping(DEFAULT_PCX_STORE_ID, "STUB-TOM-400");
    stubPriceOverride.set("STUB-TOM-400", 2.99);
    const r = await refreshPrices(OWNER);
    expect(r).toMatchObject({ status: "ok", pairs: 1, refreshed: 1, failed: 0, consecutiveFailures: 0 });
    expect((await db.doc(`prices/${priceDocId(DEFAULT_PCX_STORE_ID, "STUB-TOM-400")}`).get()).data()!.priceCents).toBe(299);
  });

  it("failures keep old prices, notify the owner, and count consecutive bad weeks", async () => {
    await mapping("S1", "STUB-TOM-400");
    const id = priceDocId("S1", "STUB-TOM-400");
    await db.doc(`prices/${id}`).set({ productName: "old", priceCents: 111, packAmount: 400, packMeasure: "weight", pcxStoreId: "S1", productCode: "STUB-TOM-400", fetchedAt: Timestamp.now() });
    setStubMode("priceFails");
    expect(await refreshPrices(OWNER)).toMatchObject({ status: "failed", failed: 1, consecutiveFailures: 1 });
    expect((await db.doc(`prices/${id}`).get()).data()!.priceCents).toBe(111);
    const notes = await db.collection(`users/${OWNER}/notifications`).get();
    expect(notes.docs.map((d) => d.data().message).join()).toMatch(/price refresh/);
    expect((await refreshPrices(OWNER)).consecutiveFailures).toBe(2);
    setStubMode("ok");
    expect((await refreshPrices(OWNER)).consecutiveFailures).toBe(0);
  });

  it("skips when not connected, and prunes prices nobody refreshed for 60 days", async () => {
    setStubMode("notConfigured");
    await db.doc("prices/S_old").set({ productName: "x", priceCents: 1, packAmount: 1, packMeasure: "count", pcxStoreId: "S", productCode: "old", fetchedAt: Timestamp.fromMillis(Date.now() - 61 * 86_400_000) });
    expect(await refreshPrices(OWNER)).toMatchObject({ status: "not connected", pruned: 1 });
    expect((await db.doc("prices/S_old").get()).exists).toBe(false);
  });

  it("runs inside the weekly maintenance job", async () => {
    await mapping("S2", "STUB-MILK-4L");
    const r = await runMaintenance(Date.now(), { ownerUid: OWNER });
    expect(r.prices).toMatchObject({ status: "ok", refreshed: 1 });
    expect((await db.doc(`prices/${priceDocId("S2", "STUB-MILK-4L")}`).get()).data()).toMatchObject({ priceCents: 679, packAmount: 4000, packMeasure: "volume" });
  });
});
