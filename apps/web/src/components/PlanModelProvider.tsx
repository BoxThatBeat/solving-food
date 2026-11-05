// The shell's one plan model (M23): computed here once and read by every page, sheet and badge with `usePlanModel()`.
// M26: the next period's model too, computed only while a component that shows it is mounted (`useNextPlanModel()`).
import * as React from "react";
import { NextPlanModelContext, PlanModelContext, useComputeNextPlanModel, useComputePlanModel } from "@/data/planModel";
import { rememberLanding } from "@/plan/landing";

export function PlanModelProvider({ children }: { children: React.ReactNode }) {
  const model = useComputePlanModel();
  const [wanted, setWanted] = React.useState(0);
  const want = React.useCallback(() => {
    setWanted((n) => n + 1);
    return () => setWanted((n) => n - 1);
  }, []);
  const next = useComputeNextPlanModel(model, wanted > 0);
  const nextValue = React.useMemo(() => ({ model: next, want }), [next, want]);
  const known = model.loading || !model.periodId ? null : model.items.length > 0;
  React.useEffect(() => {
    if (known !== null) rememberLanding(model.hid, known);
  }, [model.hid, known]);
  return (
    <PlanModelContext.Provider value={model}>
      <NextPlanModelContext.Provider value={nextValue}>{children}</NextPlanModelContext.Provider>
    </PlanModelContext.Provider>
  );
}
