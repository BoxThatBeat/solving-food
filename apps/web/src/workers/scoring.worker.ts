// Scores every recipe off the main thread (TECHNICAL_SPECS §7 "Suggestion score": "This runs in a Web Worker"). In: a
// ScoringSnapshot with a sequence number. Out: every recipe's ScoreResult, ranked (blocked last), for the latest
// snapshot only.
import { rank, type ScoreResult } from "@solving-food/core";
import { PRICE_ESTIMATES } from "@/data/prices";
import { buildContexts, type ScoringSnapshot } from "./snapshot";
import { SEED_INGREDIENTS } from "./seed";

export interface ScoringRequest {
  seq: number;
  snapshot: ScoringSnapshot;
}
export interface ScoringResponse {
  seq: number;
  ranked: ScoreResult[];
  ms: number;
}

self.onmessage = (e: MessageEvent<ScoringRequest>) => {
  const t0 = performance.now();
  const c = buildContexts(e.data.snapshot, SEED_INGREDIENTS, PRICE_ESTIMATES);
  const ranked = rank(c.recipes, c.score, c.weights);
  const out: ScoringResponse = { seq: e.data.seq, ranked, ms: Math.round(performance.now() - t0) };
  (self as unknown as Worker).postMessage(out);
};
