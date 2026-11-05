// Price history helpers (M27, TECHNICAL_SPECS §14.1): a brand mapping with a weekly price history and, optionally, a
// live price at the household's store. Each test gets its own PC Express store ID, so the global prices/* docs other
// tests write (product searches at the default store) never change its live prices.
import { Timestamp } from "firebase-admin/firestore";
import { priceDocId } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";

const DAY = 86_400_000;

/** Gives the household a store ID of its own and returns it. */
export async function ownPcxStore(hid: string): Promise<string> {
  const store = `E2E-${hid}`;
  await adminDb.doc(`households/${hid}`).update({ pcxStoreId: store });
  return store;
}

/**
 * A brand mapping for `ingredientId` with `weeks` weekly PC Express prices (the newest `lastDaysAgo` days ago), and the
 * live price `liveCents` (fetched now) when given.
 */
export async function seedPriceHistory(
  hid: string,
  ingredientId: string,
  opts: { productName: string; productCode: string; packAmount: number; packMeasure: "weight" | "volume" | "count"; weekly: number[]; lastDaysAgo?: number; liveCents?: number; store?: string },
): Promise<void> {
  const now = Date.now();
  const last = now - (opts.lastDaysAgo ?? 7) * DAY;
  const priceHistory = opts.weekly.map((cents, i) => ({ atMs: last - (opts.weekly.length - 1 - i) * 7 * DAY, cents, source: "pcx" }));
  await adminDb.doc(`households/${hid}/brandMappings/${ingredientId}`).set({ productName: opts.productName, productCode: opts.productCode, packAmount: opts.packAmount, packMeasure: opts.packMeasure, storeId: "pc-express", priceHistory });
  if (opts.liveCents !== undefined && opts.store) {
    await adminDb.doc(`prices/${priceDocId(opts.store, opts.productCode)}`).set({ productName: opts.productName, priceCents: opts.liveCents, packAmount: opts.packAmount, packMeasure: opts.packMeasure, pcxStoreId: opts.store, productCode: opts.productCode, fetchedAt: Timestamp.fromMillis(now) });
  }
}
