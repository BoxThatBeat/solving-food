// PC Express callables and the weekly price refresh (PRD R6.21, R6.22, R7.10; TECHNICAL_SPECS §8 "Prices", §2 quota).
//
// pcxSearchStores({ hid, query })                  members only, rate limited: the store picker (Settings → Stores)
// pcxSearchProducts({ hid, query, pcxStoreId })    members only, rate limited: the product search (Settings → Brands);
//                                                  results with a price and a readable pack are written to prices/*
// pcxStatus({ hid })                               whether the module is connected, and its last error
// refreshPrices()                                  the maintenance job's step: every distinct (store, product code) of
//                                                  the households' brand mappings; failures keep old prices and notify
//                                                  the owner; two failed weeks in a row log "pcx refresh failed twice"
//
// With no credentials (secrets not set) every callable answers { connected: false } and the refresh is skipped: the
// app prices from the bundled estimates.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { priceDocId, pcxProductSearchInput, pcxStoreSearchInput, type PcxProduct, type PcxProductSearchResult, type PcxStatus, type PcxStoreSearchResult } from "@solving-food/core";
import { db } from "../admin";
import { notify } from "../notify";
import { NOT_CONNECTED, PcxClient, pcxDeps, recordStatus, SESSION_DOC } from "./client";

export class CallError extends Error {
  constructor(
    readonly code: "invalid-argument" | "permission-denied" | "resource-exhausted" | "unauthenticated",
    message: string,
  ) {
    super(message);
  }
}

/** Searches per member per hour (each is one or two PC Express requests). */
export const RATE_LIMIT_PER_HOUR = 30;
/** Price docs not refreshed for this long are deleted by the weekly job. */
export const PRICE_KEEP_DAYS = 60;

async function requireMember(uid: string, hid: string): Promise<void> {
  const m = await db.doc(`households/${hid}/members/${uid}`).get();
  if (!m.exists) throw new CallError("permission-denied", "Not a member of that household");
}

/** A fixed hourly window per uid in `pcxRate/{uid}` (function-only). */
export async function rateLimit(uid: string, now = Date.now()): Promise<void> {
  const ref = db.doc(`pcxRate/${uid}`);
  const ok = await db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data();
    const start = typeof s?.windowStart === "number" && now - s.windowStart < 3_600_000 ? s.windowStart : now;
    const count = start === s?.windowStart ? Number(s?.count ?? 0) : 0;
    if (count >= RATE_LIMIT_PER_HOUR) return false;
    tx.set(ref, { windowStart: start, count: count + 1 });
    return true;
  });
  if (!ok) throw new CallError("resource-exhausted", "Too many PC Express searches this hour; try again later");
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new CallError("invalid-argument", "Bad request");
  return r.data;
}

export async function pcxStatus(uid: string, data: unknown): Promise<PcxStatus> {
  const hid = String((data as { hid?: unknown })?.hid ?? "");
  await requireMember(uid, hid);
  const deps = await pcxDeps();
  if (!deps) return { connected: false, message: NOT_CONNECTED };
  const s = (await db.doc(SESSION_DOC).get()).data();
  const err = typeof s?.lastError === "string" ? s.lastError : null;
  return err ? { connected: true, message: `Last problem: ${err}` } : { connected: true };
}

export async function searchStores(uid: string, data: unknown): Promise<PcxStoreSearchResult> {
  const input = parse(pcxStoreSearchInput, data);
  await requireMember(uid, input.hid);
  const deps = await pcxDeps();
  if (!deps) return { connected: false, message: NOT_CONNECTED, stores: [] };
  await rateLimit(uid);
  const client = new PcxClient(deps);
  try {
    const stores = await client.searchStores(input.query);
    await recordStatus(true);
    return { connected: true, stores, ...(client.signInError ? { message: client.signInError } : {}) };
  } catch (e) {
    await recordStatus(false, (e as Error).message);
    return { connected: false, message: (e as Error).message, stores: [] };
  }
}

/** A price document for a product with a price and a readable pack. */
export function priceDoc(pcxStoreId: string, p: PcxProduct, at: Timestamp | FieldValue) {
  if (p.priceCents === undefined || !p.packAmount || !p.packMeasure) return null;
  return { productName: p.name, priceCents: p.priceCents, packAmount: p.packAmount, packMeasure: p.packMeasure, pcxStoreId, productCode: p.productCode, fetchedAt: at };
}

export async function searchProducts(uid: string, data: unknown): Promise<PcxProductSearchResult> {
  const input = parse(pcxProductSearchInput, data);
  await requireMember(uid, input.hid);
  const deps = await pcxDeps();
  if (!deps) return { connected: false, message: NOT_CONNECTED, products: [] };
  await rateLimit(uid);
  const client = new PcxClient(deps);
  try {
    const products = (await client.searchProducts(input.query, input.pcxStoreId)).slice(0, 12);
    // Prices are keyed by the store ID the household stores (the default placeholder included), so its listener finds them.
    const b = db.batch();
    for (const p of products) {
      const d = priceDoc(input.pcxStoreId, p, FieldValue.serverTimestamp());
      if (d) b.set(db.doc(`prices/${priceDocId(input.pcxStoreId, p.productCode)}`), d);
    }
    await b.commit();
    await recordStatus(true);
    return { connected: true, products, ...(client.signInError ? { message: client.signInError } : {}) };
  } catch (e) {
    await recordStatus(false, (e as Error).message);
    return { connected: false, message: (e as Error).message, products: [] };
  }
}

export interface RefreshReport {
  status: "not connected" | "ok" | "partial" | "failed";
  pairs: number;
  refreshed: number;
  failed: number;
  pruned: number;
  consecutiveFailures: number;
}

/** Every distinct (household store, product code) among the brand mappings. Iterates households (a handful). */
export async function mappedPairs(): Promise<Array<{ pcxStoreId: string; productCode: string; packAmount?: number; packMeasure?: string }>> {
  const out = new Map<string, { pcxStoreId: string; productCode: string; packAmount?: number; packMeasure?: string }>();
  const households = await db.collection("households").get();
  for (const h of households.docs) {
    const store = String(h.data().pcxStoreId ?? "");
    if (!store) continue;
    const maps = await h.ref.collection("brandMappings").get();
    for (const m of maps.docs) {
      const code = m.data().productCode;
      if (typeof code !== "string" || !code) continue;
      const k = priceDocId(store, code);
      if (!out.has(k)) out.set(k, { pcxStoreId: store, productCode: code, packAmount: m.data().packAmount, packMeasure: m.data().packMeasure });
    }
  }
  return [...out.values()];
}

export async function refreshPrices(ownerUid: string | null, now = Date.now()): Promise<RefreshReport> {
  const report: RefreshReport = { status: "ok", pairs: 0, refreshed: 0, failed: 0, pruned: 0, consecutiveFailures: 0 };
  // Old prices nobody refreshes any more (unlinked products, searched-only results) go.
  const old = await db.collection("prices").where("fetchedAt", "<", Timestamp.fromMillis(now - PRICE_KEEP_DAYS * 86_400_000)).get();
  for (const d of old.docs) {
    await d.ref.delete();
    report.pruned++;
  }
  const deps = await pcxDeps();
  if (!deps) return { ...report, status: "not connected" };
  const pairs = await mappedPairs();
  report.pairs = pairs.length;
  const client = new PcxClient(deps);
  const errors: string[] = [];
  for (const pair of pairs) {
    try {
      const p = await client.product(pair.productCode, pair.pcxStoreId);
      // A product whose pack PC Express doesn't spell out keeps the brand mapping's pack.
      const withPack = p && !p.packAmount && pair.packAmount && pair.packMeasure ? { ...p, packAmount: pair.packAmount, packMeasure: pair.packMeasure as PcxProduct["packMeasure"] } : p;
      const d = withPack ? priceDoc(pair.pcxStoreId, withPack, Timestamp.fromMillis(now)) : null;
      if (!d) throw new Error(`no price for ${pair.productCode}`);
      await db.doc(`prices/${priceDocId(pair.pcxStoreId, pair.productCode)}`).set(d);
      report.refreshed++;
    } catch (e) {
      report.failed++;
      errors.push((e as Error).message);
    }
  }
  report.status = report.failed === 0 ? "ok" : report.refreshed ? "partial" : "failed";
  const session = db.doc(SESSION_DOC);
  const prev = Number((await session.get()).data()?.consecutiveRefreshFailures ?? 0);
  report.consecutiveFailures = report.status === "ok" ? 0 : prev + 1;
  await session.set({ consecutiveRefreshFailures: report.consecutiveFailures, lastRefreshAt: Timestamp.fromMillis(now), lastRefreshStatus: report.status }, { merge: true });
  if (report.status !== "ok") {
    await recordStatus(false, errors[0]);
    // The log line the Cloud Monitoring alert matches (SETUP.md): a second bad week in a row.
    if (report.consecutiveFailures >= 2) logger.error("pcx refresh failed twice", { ...report, firstError: errors[0] });
    else logger.warn("pcx refresh failed", { ...report, firstError: errors[0] });
    if (ownerUid) await notify(ownerUid, { kind: "error", message: `PC Express price refresh: ${report.failed} of ${report.pairs} prices failed (${errors[0]}). Old prices are kept; the app falls back to estimates as they age.`, link: "/settings/brands" }).catch(() => undefined);
  } else if (pairs.length) await recordStatus(true);
  return report;
}
