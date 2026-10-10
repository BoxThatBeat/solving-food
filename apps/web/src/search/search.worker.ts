// Web Worker for large libraries (> WORKER_THRESHOLD recipes): builds the MiniSearch index and answers queries off the
// main thread.
import type MiniSearch from "minisearch";
import { buildIndex, runQuery, type SearchDoc } from "./engine";

let index: MiniSearch<SearchDoc> | null = null;

type In = { type: "build"; docs: SearchDoc[] } | { type: "query"; id: number; q: string };

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "build") {
    index = buildIndex(m.docs);
    return;
  }
  const result = index ? runQuery(index, m.q) : null;
  (self as unknown as Worker).postMessage({ id: m.id, result: result ? [...result] : null });
};
