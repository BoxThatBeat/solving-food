// The recipe index (recipeIndex/{chunk}, §9) and text search over it.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection } from "firebase/firestore";
import type { RecipeSummary } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "@/data/live";
import { buildIndex, runQuery, toSearchDocs, WORKER_THRESHOLD } from "./engine";

interface IndexChunk {
  count: number;
  recipes: Record<string, RecipeSummary>;
}

/** Every summary from the chunk documents (a few reads, cached offline). undefined while loading. */
export function useRecipeIndex(enabled = true): RecipeSummary[] | undefined {
  const q = useLiveQuery<IndexChunk>(enabled ? collection(db, "recipeIndex") : null, enabled ? "recipeIndex" : null);
  return useMemo(() => (q.docs ? q.docs.flatMap((d) => Object.values(d.data.recipes ?? {})) : undefined), [q.docs]);
}

/** Text matches for `q` with scores, or null when `q` is empty. Builds in a Web Worker for large libraries. */
export function useRecipeSearch(summaries: readonly RecipeSummary[], notes: ReadonlyMap<string, string>, q: string): Map<string, number> | null {
  const docs = useMemo(() => toSearchDocs(summaries, notes), [summaries, notes]);
  const big = docs.length > WORKER_THRESHOLD;
  const local = useMemo(() => (big ? null : buildIndex(docs)), [docs, big]);

  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [remote, setRemote] = useState<{ q: string; result: Map<string, number> | null } | null>(null);

  useEffect(() => {
    if (!big) return;
    const w = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.postMessage({ type: "build", docs });
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [docs, big]);

  useEffect(() => {
    const w = worker.current;
    if (!big || !w) return;
    const id = ++seq.current;
    const onMsg = (e: MessageEvent<{ id: number; result: Array<[string, number]> | null }>) => {
      if (e.data.id === id) setRemote({ q, result: e.data.result ? new Map(e.data.result) : null });
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ type: "query", id, q });
    return () => w.removeEventListener("message", onMsg);
  }, [q, big, docs]);

  if (!q.trim()) return null;
  if (local) return runQuery(local, q);
  return remote?.q === q ? remote.result : new Map();
}
