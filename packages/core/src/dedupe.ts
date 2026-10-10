// Deduplication (TECHNICAL_SPECS §9 "Deduplication", PRD R4.20).
// A recipe is a possible duplicate of another when any of these hold:
//   - same canonical source URL;
//   - title trigram similarity > 0.8 and ingredient-set Jaccard similarity > 0.7;
//   - same fingerprint (sorted ingredient IDs + rounded amounts per serving).

import { normalizeName } from "./names";

export interface DedupeCandidate {
  id?: string;
  title: string;
  ingredientIds: readonly string[];
  sourceUrlCanonical?: string | null;
  fingerprint: string;
}

export type DuplicateReason = "sourceUrl" | "similar" | "fingerprint";

export interface DuplicateMatch {
  id: string;
  title: string;
  reasons: DuplicateReason[];
  titleSimilarity: number;
  ingredientSimilarity: number;
}

export const TITLE_THRESHOLD = 0.8;
export const INGREDIENT_THRESHOLD = 0.7;

function trigrams(s: string): Set<string> {
  const t = `  ${normalizeName(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard<T>(a: ReadonlySet<T> | readonly T[], b: ReadonlySet<T> | readonly T[]): number {
  const A = a instanceof Set ? a : new Set(a as readonly T[]);
  const B = b instanceof Set ? b : new Set(b as readonly T[]);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Trigram (Jaccard) similarity of two titles after normalisation: 1 for equal titles. */
export function titleSimilarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

/** `findDuplicates(candidate, index)`: every indexed recipe the candidate may duplicate, best match first. */
export function findDuplicates(candidate: DedupeCandidate, index: Iterable<DedupeCandidate & { id: string }>): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const r of index) {
    if (candidate.id && r.id === candidate.id) continue;
    const reasons: DuplicateReason[] = [];
    if (candidate.sourceUrlCanonical && r.sourceUrlCanonical && candidate.sourceUrlCanonical === r.sourceUrlCanonical) {
      reasons.push("sourceUrl");
    }
    const ts = titleSimilarity(candidate.title, r.title);
    const is = jaccard(candidate.ingredientIds, r.ingredientIds);
    if (ts > TITLE_THRESHOLD && is > INGREDIENT_THRESHOLD) reasons.push("similar");
    if (candidate.ingredientIds.length > 0 && candidate.fingerprint === r.fingerprint) reasons.push("fingerprint");
    if (reasons.length) out.push({ id: r.id, title: r.title, reasons, titleSimilarity: ts, ingredientSimilarity: is });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || b.titleSimilarity + b.ingredientSimilarity - (a.titleSimilarity + a.ingredientSimilarity));
}

/** "Same source URL and 90% the same ingredients as Chicken tikka traybake." */
export function describeMatch(m: DuplicateMatch): string {
  const parts: string[] = [];
  if (m.reasons.includes("sourceUrl")) parts.push("Same source URL");
  if (m.reasons.includes("fingerprint")) parts.push("the same ingredients and amounts");
  else if (m.reasons.includes("similar") || m.ingredientSimilarity >= 0.5) {
    parts.push(`${Math.round(m.ingredientSimilarity * 100)}% the same ingredients`);
  }
  if (m.reasons.includes("similar") && !parts.length) parts.push("A near-identical title");
  const head = parts.length ? parts.join(" and ") : "Similar";
  return `${head[0]!.toUpperCase()}${head.slice(1)} as ${m.title}.`;
}
