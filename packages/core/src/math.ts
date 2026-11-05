// Shared numeric helpers (M21): one definition each instead of copies with drifting values across core.

/** One day in milliseconds (a UTC day; local days come from `period.ts`, which handles DST). */
export const DAY_MS = 86_400_000;

/**
 * Amount tolerance for stored quantities (grams or counts): the ledger rounds to a millionth, so anything at or below
 * this is zero. Use it for "is there any left" questions about stored amounts.
 */
export const EPS = 1e-6;

/**
 * Floating-point noise tolerance for computed values (pack counts, shortfalls, comparisons of sums). Smaller than `EPS`
 * on purpose: it must not swallow real millionths that the ledger keeps.
 */
export const FLOAT_EPS = 1e-9;

/** Rounds to 6 decimals: the precision stored amounts are kept at (ledger, merges, imports). */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Rounds to 3 decimals: recipe and grocery amounts as stored on lines. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
