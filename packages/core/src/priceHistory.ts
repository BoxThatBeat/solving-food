// Price history and deals (M27, PRD R6.32–R6.34, R7.19, R10.4; TECHNICAL_SPECS §4.2 `brandMappings.priceHistory`, §8 "Price
// history and deals"). Each brand mapping keeps a short rolling history of what one pack of its product cost: the
// weekly PC Express observation (maintenance) and what was paid on a receipt (`receiveGroceries`). "Usual" is the
// median of the earlier observations; a product is **on sale** when its current price is at least DEAL_THRESHOLD below
// usual and there are at least DEAL_MIN_OBSERVATIONS observations. Firebase-free and zod-free (the plan worker imports it).

import { DAY_MS } from "./math";
import { LIVE_PRICE_MAX_AGE_DAYS } from "./pricing";

export type PriceObservationSource = "pcx" | "receipt";

/** One observation of a pack's price. `atMs` is epoch ms (a plain number: the array is small and function-written). */
export interface PriceObservation {
  atMs: number;
  /** Cents for one pack of the mapped product. */
  cents: number;
  source: PriceObservationSource;
}

/** At most this many observations per mapping: twelve weekly prices plus a few receipts. Oldest dropped first. */
export const PRICE_HISTORY_MAX = 16;
/** A product is on sale at least this far below usual (0.15 = 15 %). */
export const DEAL_THRESHOLD = 0.15;
/** …and only with at least this many observations, the current one included. */
export const DEAL_MIN_OBSERVATIONS = 4;
/** A weekly PC Express observation this close to the previous one replaces it (a maintenance re-run), days. */
export const PCX_SAME_WEEK_DAYS = 3;
/** History → Prices counts a product as moving "this week" when its current price is this recent, days. */
export const MOVER_MAX_AGE_DAYS = 7;

const valid = (o: unknown): o is PriceObservation =>
  !!o && typeof o === "object" && Number.isFinite((o as PriceObservation).atMs) && Number.isFinite((o as PriceObservation).cents) && (o as PriceObservation).cents > 0 && ((o as PriceObservation).source === "pcx" || (o as PriceObservation).source === "receipt");

/** The stored array, cleaned: valid entries only, oldest first. */
export function cleanHistory(h: unknown): PriceObservation[] {
  return Array.isArray(h) ? h.filter(valid).map((o) => ({ atMs: o.atMs, cents: Math.round(o.cents), source: o.source })).sort((a, b) => a.atMs - b.atMs) : [];
}

/**
 * The history with one observation added, oldest first, at most `max` long. A PC Express observation within
 * PCX_SAME_WEEK_DAYS of the newest PC Express one replaces it (maintenance ran twice), so a week counts once.
 */
export function appendObservation(history: unknown, obs: PriceObservation, max = PRICE_HISTORY_MAX): PriceObservation[] {
  let h = cleanHistory(history);
  if (!valid(obs)) return h;
  if (obs.source === "pcx") {
    const lastPcx = [...h].reverse().find((o) => o.source === "pcx");
    if (lastPcx && Math.abs(obs.atMs - lastPcx.atMs) < PCX_SAME_WEEK_DAYS * DAY_MS) h = h.filter((o) => o !== lastPcx);
  }
  h.push({ atMs: obs.atMs, cents: Math.round(obs.cents), source: obs.source });
  h.sort((a, b) => a.atMs - b.atMs);
  return h.slice(Math.max(0, h.length - max));
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface PriceDeal {
  /** The current price of one pack, cents. */
  cents: number;
  /** The usual price: the median of the earlier observations, cents (rounded). */
  usualCents: number;
  /** How far the current price sits below usual: 0.2 = 20 % below; negative when above. */
  dealPct: number;
  /** Observations counted, the current one included. */
  observations: number;
  /** At least DEAL_THRESHOLD below usual, with DEAL_MIN_OBSERVATIONS observations, and current. */
  onSale: boolean;
  /** When the current price was seen. */
  atMs: number;
}

/**
 * The deal for one product: `usualCents` (median of the history before the current price) and `dealPct`. The current
 * price is `current` (the live PC Express price, fetched ≤ 14 days ago) when given, and the history before it counts;
 * otherwise the newest observation, and the rest count. Only a PC Express price (what it costs now) can be on sale; a
 * receipt is what was paid then. Null without an earlier observation to compare with.
 */
export function priceDeal(history: unknown, current?: { cents: number; atMs: number } | null, nowMs = Date.now()): PriceDeal | null {
  const h = cleanHistory(history);
  let cur: { cents: number; atMs: number; source: PriceObservationSource };
  let past: PriceObservation[];
  if (current && current.cents > 0) {
    cur = { ...current, source: "pcx" };
    past = h.filter((o) => o.atMs < current.atMs);
  } else {
    if (!h.length) return null;
    cur = h[h.length - 1]!;
    past = h.slice(0, -1);
  }
  const usual = median(past.map((o) => o.cents));
  if (usual === null || usual <= 0) return null;
  const dealPct = (usual - cur.cents) / usual;
  const observations = past.length + 1;
  const fresh = nowMs - cur.atMs <= LIVE_PRICE_MAX_AGE_DAYS * DAY_MS;
  return {
    cents: cur.cents,
    usualCents: Math.round(usual),
    dealPct,
    observations,
    onSale: fresh && cur.source === "pcx" && observations >= DEAL_MIN_OBSERVATIONS && dealPct >= DEAL_THRESHOLD - 1e-9,
    atMs: cur.atMs,
  };
}

/** "20% below usual" (whole percent, rounded down so 19.6 % never reads as 20 %). */
export function dealLabel(d: Pick<PriceDeal, "dealPct">): string {
  return `${Math.floor(d.dealPct * 100 + 1e-9)}% below usual`;
}

export interface MappingPrices {
  productCode?: string | undefined;
  priceHistory?: unknown;
}

/**
 * The household's products on sale, by ingredient ID (the brand mapping's ID): its history against the live price at
 * the household's store (`live(code)`), else the newest observation.
 */
export function dealsFromMappings(
  mappings: Iterable<readonly [string, MappingPrices]>,
  live: (productCode: string) => { priceCents: number; fetchedAtMs: number } | undefined,
  nowMs = Date.now(),
): Map<string, PriceDeal> {
  const out = new Map<string, PriceDeal>();
  for (const [id, m] of mappings) {
    const d = dealOfMapping(m, live, nowMs);
    if (d?.onSale) out.set(id, d);
  }
  return out;
}

/** One mapping's deal (on sale or not), or null without history. */
export function dealOfMapping(m: MappingPrices, live: (productCode: string) => { priceCents: number; fetchedAtMs: number } | undefined, nowMs = Date.now()): PriceDeal | null {
  if (!m.priceHistory) return null;
  const p = m.productCode ? live(m.productCode) : undefined;
  const current = p && nowMs - p.fetchedAtMs <= LIVE_PRICE_MAX_AGE_DAYS * DAY_MS ? { cents: p.priceCents, atMs: p.fetchedAtMs } : null;
  return priceDeal(m.priceHistory, current, nowMs);
}

export interface PriceMover extends PriceDeal {
  id: string;
  /** (current − usual) / usual: positive went up, negative went down. */
  changePct: number;
}

/**
 * History → Prices (R10.4): the products whose current price was seen this week (MOVER_MAX_AGE_DAYS) and differs from
 * usual, biggest move first (up or down), at most `limit`. Needs DEAL_MIN_OBSERVATIONS like a deal.
 */
export function priceMovers(
  mappings: Iterable<readonly [string, MappingPrices]>,
  live: (productCode: string) => { priceCents: number; fetchedAtMs: number } | undefined,
  nowMs = Date.now(),
  limit = 5,
): PriceMover[] {
  const out: PriceMover[] = [];
  for (const [id, m] of mappings) {
    const d = dealOfMapping(m, live, nowMs);
    if (!d || d.observations < DEAL_MIN_OBSERVATIONS || nowMs - d.atMs > MOVER_MAX_AGE_DAYS * DAY_MS) continue;
    const changePct = (d.cents - d.usualCents) / d.usualCents;
    if (Math.abs(changePct) < 0.005) continue;
    out.push({ ...d, id, changePct });
  }
  return out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Ingredient categories that count as a meal's main protein for the Deal chip (M27, R6.33). */
export const PROTEIN_CATEGORIES: ReadonlySet<string> = new Set(["meat", "fish"]);

/**
 * The Deal chip of a planned meal (R6.33): among the ingredients the next order buys for it, one on sale that is a main
 * protein (meat or fish) or the most expensive line; the protein first, then the bigger saving. Null when none is.
 */
export function mealDeal(
  ingredientIds: Iterable<string>,
  deals: ReadonlyMap<string, Pick<PriceDeal, "dealPct">>,
  meta: (id: string) => { category?: string | undefined; name?: string | undefined } | undefined,
  lineCents: (id: string) => number | null,
): { ingredientId: string; dealPct: number; label: string } | null {
  const ids = [...new Set(ingredientIds)].filter((id) => lineCents(id) !== null);
  if (!ids.length) return null;
  const costliest = ids.reduce((a, b) => ((lineCents(b) ?? 0) > (lineCents(a) ?? 0) ? b : a));
  const pick = ids
    .filter((id) => deals.has(id) && (id === costliest || PROTEIN_CATEGORIES.has(meta(id)?.category ?? "")))
    .sort((a, b) => Number(PROTEIN_CATEGORIES.has(meta(b)?.category ?? "")) - Number(PROTEIN_CATEGORIES.has(meta(a)?.category ?? "")) || deals.get(b)!.dealPct - deals.get(a)!.dealPct)[0];
  if (!pick) return null;
  const d = deals.get(pick)!;
  const name = (meta(pick)?.name ?? pick.replace(/-/g, " ")).split(/[,(]/)[0]!.trim();
  return { ingredientId: pick, dealPct: d.dealPct, label: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${dealLabel(d)}` };
}
