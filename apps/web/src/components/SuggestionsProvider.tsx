// The suggestions engine (TECHNICAL_SPECS §7): one scoring worker for the signed-in shell, fed the household snapshot
// 300 ms after it settles, running only while something on screen uses the scores (data/suggestions.ts).
import * as React from "react";
import { useActiveHousehold } from "@/data/households";
import { usePlanModel } from "@/data/planModel";
import { EMPTY, SuggestionsContext, useScoringSnapshot, type SuggestionsState } from "@/data/suggestions";
import type { ScoringSnapshot } from "@/workers/snapshot";
import type { ScoringRequest, ScoringResponse } from "@/workers/scoring.worker";

export function SuggestionsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SuggestionsState>(EMPTY);
  const [subscribers, setSubscribers] = React.useState(0);
  const subscribe = React.useCallback(() => {
    setSubscribers((n) => n + 1);
    return () => setSubscribers((n) => n - 1);
  }, []);
  const value = React.useMemo(() => ({ state, subscribe }), [state, subscribe]);
  return (
    <SuggestionsContext.Provider value={value}>
      {subscribers > 0 ? <Engine onResult={setState} /> : null}
      {children}
    </SuggestionsContext.Provider>
  );
}

function Engine({ onResult }: { onResult: (s: SuggestionsState) => void }) {
  const hh = useActiveHousehold();
  const m = usePlanModel();
  const snapshot = useScoringSnapshot(m);
  const worker = React.useRef<Worker | null>(null);
  const seq = React.useRef(0);
  const latest = React.useRef<ScoringSnapshot | null>(null);

  React.useEffect(() => {
    const w = new Worker(new URL("../workers/scoring.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent<ScoringResponse>) => {
      if (e.data.seq !== seq.current) return;
      onResult({ ranked: e.data.ranked, byId: new Map(e.data.ranked.map((r) => [r.id, r])), snapshot: latest.current });
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [onResult]);

  // A different household: drop the old scores at once.
  React.useEffect(() => onResult(EMPTY), [hh.id, onResult]);

  React.useEffect(() => {
    if (!snapshot) return;
    const t = setTimeout(() => {
      const id = ++seq.current;
      latest.current = snapshot;
      worker.current?.postMessage({ seq: id, snapshot } satisfies ScoringRequest);
    }, 300);
    return () => clearTimeout(t);
  }, [snapshot]);
  return null;
}
