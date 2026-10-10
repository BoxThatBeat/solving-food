// First-household creation (Planning/M0 §5, TECHNICAL_SPECS §10 "Create"). Builds the documents the client writes
// in one batch; the client adds server timestamps and the counter increment.

import { z } from "zod";
import {
  CURRENCY,
  DEFAULT_BUDGET_CENTS,
  DEFAULT_HOUSEHOLD_NAME,
  DEFAULT_PCX_STORE_ID,
  DEFAULT_PERIOD_DAYS,
  DEFAULT_SERVINGS,
  DEFAULT_TIMEZONE,
  MAX_HOUSEHOLDS_CREATED,
  SERVINGS_MAX,
} from "./config";
import { PLANNABLE_MEAL_TYPES } from "./taxonomy";
import { DEFAULT_STORE_ID } from "./grocery";
import { householdNameSchema, type HouseholdDoc, type MemberDoc } from "./types";

export const newHouseholdInputSchema = z.object({
  name: householdNameSchema,
  timezone: z.string().trim().min(1, "Pick a timezone"),
  defaultServings: z.number().int().min(1).max(SERVINGS_MAX),
  plannedMealTypes: z.array(z.enum(PLANNABLE_MEAL_TYPES)).min(1, "Plan at least one meal type"),
});
export type NewHouseholdInput = z.infer<typeof newHouseholdInputSchema>;

/** Form defaults. `detectedTimezone` is the browser's IANA zone when available. */
export function defaultHouseholdInput(detectedTimezone?: string): NewHouseholdInput {
  return {
    name: DEFAULT_HOUSEHOLD_NAME,
    timezone: detectedTimezone && isValidTimezone(detectedTimezone) ? detectedTimezone : DEFAULT_TIMEZONE,
    defaultServings: DEFAULT_SERVINGS,
    plannedMealTypes: [...PLANNABLE_MEAL_TYPES],
  };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function canCreateHousehold(householdsCreated: number): boolean {
  return householdsCreated < MAX_HOUSEHOLDS_CREATED;
}

export type HouseholdDraft = Omit<HouseholdDoc, "createdAt">;
export type MemberDraft = Omit<MemberDoc, "joinedAt">;

/**
 * The household and creator-member documents for a new household. Throws a ZodError on invalid input.
 * Meal types are stored in canonical order whatever order the user toggled them in.
 */
export function buildNewHousehold(
  input: NewHouseholdInput,
  creator: { uid: string; displayName: string },
): { household: HouseholdDraft; member: MemberDraft } {
  const v = newHouseholdInputSchema.parse(input);
  if (!isValidTimezone(v.timezone)) {
    throw new Error(`Unknown timezone: ${v.timezone}`);
  }
  const plannedMealTypes = PLANNABLE_MEAL_TYPES.filter((t) => v.plannedMealTypes.includes(t));
  return {
    household: {
      name: v.name,
      createdBy: creator.uid,
      periodDays: DEFAULT_PERIOD_DAYS,
      budgetCents: DEFAULT_BUDGET_CENTS,
      currency: CURRENCY,
      timezone: v.timezone,
      defaultServings: v.defaultServings,
      plannedMealTypes,
      pcxStoreId: DEFAULT_PCX_STORE_ID,
      currentPeriodId: null,
      defaultStoreId: DEFAULT_STORE_ID,
      settings: {
        scoreWeights: {},
        tools: [],
        preferences: { likes: [], dislikes: [], diets: [] },
        proteinGoals: {},
      },
    },
    member: { uid: creator.uid, displayName: creator.displayName },
  };
}

/** Which household the app shows: the user's choice if they're still a member, else the first membership. */
export function pickActiveHousehold(
  activeHouseholdId: string | null | undefined,
  membershipHouseholdIds: readonly string[],
): string | null {
  if (activeHouseholdId && membershipHouseholdIds.includes(activeHouseholdId)) return activeHouseholdId;
  return membershipHouseholdIds[0] ?? null;
}
