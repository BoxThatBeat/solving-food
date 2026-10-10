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

/** Kitchen tools offered as suggestions in Settings → Kitchen tools (R11.1), plus whatever the library's recipes use. */
export const TOOL_SUGGESTIONS = [
  "Instant Pot",
  "Rice cooker",
  "Food processor",
  "Dutch oven",
  "Sheet pans",
  "Blender",
  "Immersion blender",
  "Wok",
  "Cast iron pan",
  "Sous vide",
  "Stand mixer",
  "Hand mixer",
  "Air fryer",
  "Slow cooker",
  "Grill",
  "Muffin tin",
  "Baking dish",
  "Stock pot",
] as const;

/** Household settings form (R11.5, R11.6, R11.11–R11.13): validated before the household document is updated. */
export const householdSettingsInputSchema = newHouseholdInputSchema.extend({
  periodDays: z.number().int().min(1, "At least 1 day").max(28, "At most 28 days"),
  budgetCents: z.number().int().min(0, "Budget can't be negative").max(10_000_00, "That's a big budget: at most $10,000"),
});
export type HouseholdSettingsInput = z.infer<typeof householdSettingsInputSchema>;

// ---------- members and invites (M4, PRD R2.4–R2.5, R2.13, TECHNICAL_SPECS §10)

/** Invite by email: a valid address, stored lower-cased (it is the invite's and the allowlist entry's key). */
export const inviteEmailSchema = z
  .string()
  .trim()
  .min(1, "Enter an email address")
  .max(254, "That address is too long")
  .pipe(z.email("That doesn't look like an email address"))
  .transform((e) => e.toLowerCase());

/** The invite document a member writes (`households/{hid}/invites/{key}`); the client adds `createdAt`. */
export function buildInvite(
  target: { uid: string } | { email: string },
  ctx: { householdName: string; invitedBy: string; invitedByName: string },
): { key: string; doc: Record<string, string> } {
  const base = { householdName: ctx.householdName, invitedBy: ctx.invitedBy, invitedByName: ctx.invitedByName };
  if ("uid" in target) return { key: target.uid, doc: { inviteeUid: target.uid, ...base } };
  const email = target.email.trim().toLowerCase();
  return { key: email, doc: { inviteeEmailLower: email, ...base } };
}

export interface InviteView {
  hid: string;
  key: string;
  householdName: string;
  invitedByName?: string;
}

/**
 * The invites to show someone: one per household (an invite by name and one by email for the same household are
 * the same offer), skipping households they're already in.
 */
export function inviteInbox<T extends InviteView>(invites: readonly T[], memberOf: readonly string[]): T[] {
  const seen = new Set(memberOf);
  const out: T[] = [];
  for (const i of invites) {
    if (seen.has(i.hid)) continue;
    seen.add(i.hid);
    out.push(i);
  }
  return out;
}

/** Directory search for invites by name: case-insensitive substring, minus people already in or invited. */
export function searchDirectory<T extends { uid: string; displayName: string }>(
  directory: readonly T[],
  query: string,
  exclude: ReadonlySet<string>,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return directory
    .filter((d) => !exclude.has(d.uid) && d.displayName.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.displayName.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.displayName.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.displayName.localeCompare(b.displayName);
    })
    .slice(0, limit);
}

/** What leaving does (R2.13): the last member leaving deletes the household and all of its data. */
export function leaveConsequence(memberCount: number): "deletesHousehold" | "leaves" {
  return memberCount <= 1 ? "deletesHousehold" : "leaves";
}

/** Where the app goes when a household disappears from someone's memberships (left, removed, or deleted). */
export function nextActiveHousehold(current: string, remaining: readonly string[]): string | null {
  return remaining.find((h) => h !== current) ?? null;
}
