// The shell's one plan model (M23): computed here once and read by every page, sheet and badge with `usePlanModel()`.
import * as React from "react";
import { PlanModelContext, useComputePlanModel } from "@/data/planModel";

export function PlanModelProvider({ children }: { children: React.ReactNode }) {
  const model = useComputePlanModel();
  return <PlanModelContext.Provider value={model}>{children}</PlanModelContext.Provider>;
}
