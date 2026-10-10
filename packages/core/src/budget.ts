// The budget meter's math (PRD R6.3–R6.5; TECHNICAL_SPECS §7 "Budget"). Spent = the priced shortfall packs of the
// planned items (grocery builder): ingredients in supply or incoming on an ordered list cost nothing, manual and
// staple lines don't count (R6.4). Going over is allowed (R6.5): the meter goes negative and red, nothing is blocked.

import type { BuiltList } from "./grocery";

export interface BudgetState {
  budgetCents: number;
  spentCents: number;
  /** budget − spent; negative when over. */
  remainingCents: number;
  over: boolean;
  /** Share of the budget still left, 0..1 (0 when over). */
  fractionLeft: number;
  /** Plan lines whose price is unknown (counted as $0). */
  unknownPrices: number;
}

export function budgetState(budgetCents: number, built: Pick<BuiltList, "totalCents" | "unknownPrices">): BudgetState {
  const remaining = budgetCents - built.totalCents;
  return {
    budgetCents,
    spentCents: built.totalCents,
    remainingCents: remaining,
    over: remaining < 0,
    fractionLeft: budgetCents > 0 ? Math.max(0, Math.min(1, remaining / budgetCents)) : 0,
    unknownPrices: built.unknownPrices,
  };
}
