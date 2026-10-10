// Hosts the one <CreateMealSheet> for the signed-in shell, so the Plan page, recipe pages and cards, and saved meals
// all open the same flow (R5.7). Also runs the household bootstrap / rollover (§7).
import * as React from "react";
import { useActiveHousehold } from "@/data/households";
import { usePeriod, millis } from "@/data/plan";
import { useRollover } from "@/plan/rollover";
import { CreateMealSheet } from "./CreateMealSheet";
import { PlanSheetContext, type CreateMealRequest } from "./plan-sheet-context";

export function PlanSheetProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; request: CreateMealRequest; n: number }>({ open: false, request: {}, n: 0 });
  const openCreateMeal = React.useCallback((request: CreateMealRequest = {}) => setState((s) => ({ open: true, request, n: s.n + 1 })), []);
  const value = React.useMemo(() => ({ openCreateMeal }), [openCreateMeal]);
  return (
    <PlanSheetContext.Provider value={value}>
      <Bootstrap />
      {children}
      <CreateMealSheet key={state.n} open={state.open} request={state.request} onOpenChange={(open) => setState((s) => ({ ...s, open }))} />
    </PlanSheetContext.Provider>
  );
}

function Bootstrap() {
  const hh = useActiveHousehold();
  const period = usePeriod(hh.id, hh.data?.currentPeriodId);
  useRollover(hh.id, millis(period.data?.end));
  return null;
}
