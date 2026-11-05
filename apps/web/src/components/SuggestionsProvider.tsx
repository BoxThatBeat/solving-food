// The suggestions engine (TECHNICAL_SPECS §7): one scoring worker for the signed-in shell, fed the household snapshot
// 300 ms after it settles, running only while something on screen uses the scores (data/suggestions.ts). M26: a second
// engine for the next period (its plan, the Supply projected at its start), only while the next-period view is open.
import * as React from "react";
import type { PeriodView } from "@solving-food/core";
import { useActiveHousehold } from "@/data/households";
import { useNextPlanModel, usePlanModel, type PlanModel } from "@/data/planModel";
import { EMPTY, SuggestionsContext, useScoringSnapshot, type SuggestionsState } from "@/data/suggestions";
import type { ScoringSnapshot } from "@/workers/snapshot";
import type { ScoringRequest, ScoringResponse } from "@/workers/plan.worker";

export function SuggestionsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<Record<PeriodView, SuggestionsState>>({ current: EMPTY, next: EMPTY });
  const [subscribers, setSubscribers] = React.useState<Record<PeriodView, number>>({ current: 0, next: 0 });
  const subscribe = React.useCallback((view: PeriodView) => {
    setSubscribers((n) => ({ ...n, [view]: n[view] + 1 }));
    return () => setSubscribers((n) => ({ ...n, [view]: n[view] - 1 }));
  }, []);
  const onCurrent = React.useCallback((s: SuggestionsState) => setState((x) => ({ ...x, current: s })), []);
  const onNext = React.useCallback((s: SuggestionsState) => setState((x) => ({ ...x, next: s })), []);
  const value = React.useMemo(() => ({ state, subscribe }), [state, subscribe]);
  return (
    <SuggestionsContext.Provider value={value}>
      {subscribers.current > 0 ? <CurrentEngine onResult={onCurrent} /> : null}
      {subscribers.next > 0 ? <NextEngine onResult={onNext} /> : null}
      {children}
    </SuggestionsContext.Provider>
  );
}

function CurrentEngine({ onResult }: { onResult: (s: SuggestionsState) => void }) {
  return <Engine m={usePlanModel()} onResult={onResult} />;
}

function NextEngine({ onResult }: { onResult: (s: SuggestionsState) => void }) {
  return <Engine m={useNextPlanModel()} onResult={onResult} />;
}

function Engine({ m, onResult }: { m: PlanModel; onResult: (s: SuggestionsState) => void }) {
  const hh = useActiveHousehold();
  const snapshot = useScoringSnapshot(m);
  const worker = React.useRef<Worker | null>(null);
  const seq = React.useRef(0);
  const latest = React.useRef<ScoringSnapshot | null>(null);

  React.useEffect(() => {
    const w = new Worker(new URL("../workers/plan.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent<ScoringResponse>) => {
      if (e.data.kind !== "score" || e.data.seq !== seq.current) return;
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
      worker.current?.postMessage({ kind: "score", seq: id, snapshot } satisfies ScoringRequest);
    }, 300);
    return () => clearTimeout(t);
  }, [snapshot]);
  return null;
}
