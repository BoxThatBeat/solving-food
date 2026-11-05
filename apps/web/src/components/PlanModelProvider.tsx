// The shell's one plan model (M23): computed here once and read by every page, sheet and badge with `usePlanModel()`.
import * as React from "react";
import { PlanModelContext, useComputePlanModel } from "@/data/planModel";
import { rememberLanding } from "@/plan/landing";

export function PlanModelProvider({ children }: { children: React.ReactNode }) {
  const model = useComputePlanModel();
  const known = model.loading || !model.periodId ? null : model.items.length > 0;
  React.useEffect(() => {
    if (known !== null) rememberLanding(model.hid, known);
  }, [model.hid, known]);
  return <PlanModelContext.Provider value={model}>{children}</PlanModelContext.Provider>;
}
