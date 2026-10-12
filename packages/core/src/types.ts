// Firestore document shapes (TECHNICAL_SPECS §4) as zod schemas plus inferred types. Shared by the web app and
// functions. No Firebase imports: timestamps are accepted as anything Timestamp-like or a Date.

import { z } from "zod";
import {
  CUISINES,
  MAIN_PROTEINS,
  MEAL_TYPES,
  MEASURES,
  PLANNABLE_MEAL_TYPES,
  STORAGE_LOCATIONS,
} from "./taxonomy";
import { ACCENTS, FLAVOURS } from "./theme";
import {
  CURRENCY,
  DISPLAY_NAME_MAX,
  HOUSEHOLD_NAME_MAX,
  MAX_HOUSEHOLDS_CREATED,
  PERIOD_DAYS_MAX,
  SERVINGS_MAX,
} from "./config";

/** Firestore Timestamp (anything with toMillis) or a JS Date. */
export interface TimestampLike {
  toMillis(): number;
}
export const timestamp = z.custom<TimestampLike | Date>(
  (v) =>
    v instanceof Date ||
    (typeof v === "object" && v !== null && typeof (v as { toMillis?: unknown }).toMillis === "function"),
  { message: "Expected a timestamp" },
);

const id = z.string().min(1).max(200);
const nonNegInt = z.number().int().min(0);
const cents = z.number().int();

// ---------- 4.1 Global collections

export const themeSchema = z.object({
  flavour: z.enum(FLAVOURS),
  accent: z.enum(ACCENTS),
});

export const userSchema = z.object({
  email: z.email(),
  activeHouseholdId: id.nullable(),
  householdsCreated: nonNegInt.max(MAX_HOUSEHOLDS_CREATED),
  theme: themeSchema,
  createdAt: timestamp.optional(),
});
export type UserDoc = z.infer<typeof userSchema>;

export const allowlistSchema = z.object({
  addedBy: z.string().min(1),
  addedAt: timestamp,
  inviteHouseholdId: id.optional(),
});
export type AllowlistDoc = z.infer<typeof allowlistSchema>;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(DISPLAY_NAME_MAX, `At most ${DISPLAY_NAME_MAX} characters`);

export const directorySchema = z.object({
  displayName: displayNameSchema,
  displayNameLower: z.string(),
});
export type DirectoryDoc = z.infer<typeof directorySchema>;

export const shelfLifeSchema = z.object({
  pantry: nonNegInt.nullable().optional(),
  cupboard: nonNegInt.nullable().optional(),
  fridge: nonNegInt.nullable().optional(),
  freezer: nonNegInt.nullable().optional(),
});

export const ingredientSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()),
  category: z.string().min(1),
  defaultLocation: z.enum(STORAGE_LOCATIONS),
  allowedMeasures: z.array(z.enum(MEASURES)).min(1),
  canonicalUnit: z.enum(["g", "count"]),
  densityGPerMl: z.number().positive().optional(),
  unitWeightG: z.number().positive().optional(),
  proteinPer100g: z.number().min(0).optional(),
  shelfLifeDays: shelfLifeSchema,
  defaultPackAmount: z.number().positive().optional(),
  defaultPackMeasure: z.enum(MEASURES).optional(),
  defaultCadenceDays: z.number().int().positive().optional(),
  freezable: z.boolean(),
  isStaple: z.boolean(),
  freeUse: z.boolean(),
  needsReview: z.boolean(),
  /** Set when the ingredient is a side (R5.9): eaten as is, `portion` per person in canonical units (R5.10). */
  side: z.object({ portion: z.number().positive() }).optional(),
  /** (M8) A duplicate merged into another ingredient by the `mergeIngredient` function: hidden from pickers; its names
   * resolve to the target. Written only by that function. */
  mergedInto: z.string().optional(),
  // Set when a person creates or edits an ingredient in the app (absent on seed data).
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: timestamp.optional(),
});
export type IngredientDoc = z.infer<typeof ingredientSchema>;

/**
 * One ingredient line. `measure` is a unit key from `packages/core/src/units.ts` ("g", "cup", "tsp", "count", "pinch")
 * or a singular count noun ("clove", "fillet"). `displayText` is the recipe's own wording of the ingredient name
 * ("fresh basil"); the amount is rendered from `amount` + `measure`. `canonicalAmount` is grams (or a count for
 * count-canonical ingredients), 0 when the amount is vague or the ingredient lacks the conversion.
 */
export const recipeIngredientSchema = z.object({
  id: id,
  ingredientId: id,
  amount: z.number().min(0),
  measure: z.string().min(1),
  canonicalAmount: z.number().min(0),
  displayText: z.string(),
  optional: z.boolean(),
});

/**
 * Step text is plain text with `{{ing:<lineId>}}` placeholders (the line's full amount) or
 * `{{ing:<lineId>|<amount>|<measure>}}` (part of it, when an ingredient is added in several steps). `section` starts
 * a named part of the recipe ("Tzatziki Sauce").
 */
export const recipeStepSchema = z.object({
  text: z.string().min(1),
  ingredientRefs: z.array(id),
  timerSeconds: z.number().int().positive().optional(),
  section: z.string().optional(),
});

export const prepTaskSchema = z.object({
  text: z.string().min(1),
  ingredientRefs: z.array(id),
});

export const RECIPE_STATUSES = ["active", "pendingDuplicateReview", "trashed"] as const;

export const recipeSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  servings: z.number().int().positive(),
  prepMin: nonNegInt,
  cookMin: nonNegInt,
  cuisine: z.enum(CUISINES),
  mainProtein: z.enum(MAIN_PROTEINS),
  tags: z.array(z.string()),
  tools: z.array(z.string()),
  ingredients: z.array(recipeIngredientSchema),
  steps: z.array(recipeStepSchema),
  prepTasks: z.array(prepTaskSchema),
  defaultLeftoverPortions: nonNegInt,
  leftoverMealType: z.enum(MEAL_TYPES).optional(),
  proteinPerServingG: z.number().min(0).optional(),
  /** True when a non-optional ingredient has no protein value or conversion, so the figure is "~" (§5). */
  proteinApproximate: z.boolean().optional(),
  /** Free-text notes that came with the recipe (Cooklang comments); household notes live in households/{hid}/notes. */
  notes: z.string().optional(),
  sourceUrl: z.url().optional(),
  sourceUrlCanonical: z.string().optional(),
  fingerprint: z.string(),
  ingredientIds: z.array(id),
  /** Image base paths `recipes/{id}/{imageId}`; each has `480.webp`, `960.webp`, `1920.webp`. The first is the hero. */
  imagePaths: z.array(z.string()),
  /** Assigned by the index function on creation (§9); absent until then. */
  indexChunk: nonNegInt.optional(),
  status: z.enum(RECIPE_STATUSES),
  possibleDuplicateOf: id.optional(),
  trashedAt: timestamp.optional(),
  trashedBy: z.string().optional(),
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type RecipeDoc = z.infer<typeof recipeSchema>;

export const recipeVersionSchema = recipeSchema.extend({
  editedBy: z.string(),
  editedAt: timestamp,
});
export type RecipeVersionDoc = z.infer<typeof recipeVersionSchema>;

export const MEAL_NAME_MAX = 80;
export const MEAL_RECIPES_MAX = 12;
export const mealRecipeSchema = z.object({ recipeId: id, servingsMultiplier: z.number().positive().max(10) });
export const MEAL_SIDES_MAX = 12;
/** A side on a meal (R5.9, R5.10): the ingredient and its per-person portion (canonical), snapshotted at creation. */
export const mealSideSchema = z.object({ ingredientId: id, portion: z.number().positive() });
export type MealSide = z.infer<typeof mealSideSchema>;
/** A saved meal (R5.2): global like recipes, born from Create meal (R5.8). */
export const mealSchema = z.object({
  name: z.string().trim().min(1, "Name the meal").max(MEAL_NAME_MAX),
  recipes: z.array(mealRecipeSchema).min(1).max(MEAL_RECIPES_MAX),
  sides: z.array(mealSideSchema).max(MEAL_SIDES_MAX).optional(),
  createdBy: z.string(),
  updatedBy: z.string().optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp,
});
export type MealDoc = z.infer<typeof mealSchema>;

export const priceSchema = z.object({
  productName: z.string(),
  priceCents: cents.min(0),
  packAmount: z.number().positive(),
  packMeasure: z.enum(MEASURES),
  pcxStoreId: z.string(),
  productCode: z.string(),
  fetchedAt: timestamp,
});
export type PriceDoc = z.infer<typeof priceSchema>;

export const notificationSchema = z.object({
  kind: z.enum(["info", "success", "error"]),
  message: z.string().min(1),
  link: z.string().optional(),
  createdAt: timestamp,
  /** null until dismissed; written explicitly so `where("dismissedAt", "==", null)` matches. */
  dismissedAt: timestamp.nullable().optional(),
});
export type NotificationDoc = z.infer<typeof notificationSchema>;

export const deviceSchema = z.object({
  platform: z.string(),
  createdAt: timestamp,
  lastSeenAt: timestamp,
});
export type DeviceDoc = z.infer<typeof deviceSchema>;

// ---------- 4.2 Household collections

export const proteinGoalsSchema = z.object({
  breakfast: z.number().min(0).optional(),
  lunch: z.number().min(0).optional(),
  dinner: z.number().min(0).optional(),
  snack: z.number().min(0).optional(),
});

export const householdSettingsSchema = z.object({
  scoreWeights: z.record(z.string(), z.number()),
  tools: z.array(z.string()),
  preferences: z.object({
    likes: z.array(z.string()),
    dislikes: z.array(z.string()),
    diets: z.array(z.string()),
  }),
  proteinGoals: proteinGoalsSchema,
  /** Sides the household flagged and/or portion overrides (R11.14), keyed by ingredient ID; portion canonical. */
  sides: z.record(id, z.object({ portion: z.number().positive() })).optional(),
});

export const householdNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(HOUSEHOLD_NAME_MAX, `At most ${HOUSEHOLD_NAME_MAX} characters`);

export const householdSchema = z.object({
  name: householdNameSchema,
  createdBy: z.string().min(1),
  periodDays: z.number().int().min(1).max(PERIOD_DAYS_MAX),
  budgetCents: cents.min(0),
  currency: z.literal(CURRENCY),
  timezone: z.string().min(1),
  defaultServings: z.number().int().min(1).max(SERVINGS_MAX),
  plannedMealTypes: z.array(z.enum(PLANNABLE_MEAL_TYPES)).min(1),
  pcxStoreId: z.string().min(1),
  /** The PC Express store's name as the store search showed it (M5); absent for the default store. */
  pcxStoreName: z.string().max(120).optional(),
  currentPeriodId: id.nullable(),
  /** Store items go to when no mapping or sourcing rule picks one (§8). Set when the default stores are seeded. */
  defaultStoreId: id.optional(),
  settings: householdSettingsSchema,
  createdAt: timestamp.optional(),
});
export type HouseholdDoc = z.infer<typeof householdSchema>;

export const memberSchema = z.object({
  uid: z.string().min(1),
  displayName: displayNameSchema,
  joinedAt: timestamp,
});
export type MemberDoc = z.infer<typeof memberSchema>;

export const inviteSchema = z
  .object({
    inviteeUid: z.string().optional(),
    inviteeEmailLower: z.email().optional(),
    householdName: z.string(),
    invitedBy: z.string(),
    /** The inviter's display name, so the invitee (who can't read the household) sees who asked (M4). */
    invitedByName: z.string().optional(),
    createdAt: timestamp,
  })
  .refine((v) => (v.inviteeUid ? 1 : 0) + (v.inviteeEmailLower ? 1 : 0) === 1, {
    message: "An invite targets exactly one of inviteeUid or inviteeEmailLower",
  });
export type InviteDoc = z.infer<typeof inviteSchema>;

export const storeSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["pcExpress", "inStore"]),
  bulk: z.boolean(),
});
export type StoreDoc = z.infer<typeof storeSchema>;

export const sourcingRuleSchema = z.object({
  match: z.union([z.object({ category: z.string() }), z.object({ ingredientId: id })]),
  storeId: id,
});
export type SourcingRuleDoc = z.infer<typeof sourcingRuleSchema>;

export const brandMappingSchema = z.object({
  productName: z.string().min(1),
  productCode: z.string().optional(),
  packAmount: z.number().positive(),
  packMeasure: z.enum(MEASURES),
  storeId: id,
});
export type BrandMappingDoc = z.infer<typeof brandMappingSchema>;

export const favouriteSchema = z.object({
  type: z.enum(["recipe", "meal"]),
  targetId: id,
});
export type FavouriteDoc = z.infer<typeof favouriteSchema>;

export const noteSchema = z.object({ text: z.string(), updatedBy: z.string() });
export type NoteDoc = z.infer<typeof noteSchema>;

export const statsSchema = z.object({
  timesCooked: nonNegInt,
  lastCookedAt: timestamp.optional(),
  ratingSum: z.number().min(0),
  ratingCount: nonNegInt,
});
export type StatsDoc = z.infer<typeof statsSchema>;

/** Document ID = the local start date ("2026-10-05"), so concurrent rollovers write the same document (§7). */
export const periodSchema = z.object({
  start: timestamp,
  end: timestamp,
  budgetCents: cents.min(0),
  /** Supply lot IDs whose expiry alert was dismissed for this period (R6.13, M5). */
  dismissedLots: z.array(z.string()).optional(),
});
export type PeriodDoc = z.infer<typeof periodSchema>;

export const coverageSchema = z.object({
  breakfast: nonNegInt.optional(),
  lunch: nonNegInt.optional(),
  dinner: nonNegInt.optional(),
});

export const PLAN_ITEM_STATUSES = ["planned", "cooked", "skipped", "eaten"] as const;
/** A plan item (§4.2, R5.1): `kind: "meal"` is 1..n recipes eaten together; `leftover` portions come from M3. */
export const planItemSchema = z.object({
  periodId: id,
  kind: z.enum(["meal", "leftover"]),
  mealType: z.enum(MEAL_TYPES),
  servings: z.number().positive(),
  recipes: z.array(mealRecipeSchema).max(MEAL_RECIPES_MAX),
  /** Sides (R5.9) with the portion snapshotted when the meal was created; meal items only. */
  sides: z.array(mealSideSchema).max(MEAL_SIDES_MAX).optional(),
  savedMealId: id.optional(),
  name: z.string().max(MEAL_NAME_MAX).optional(),
  leftoverSupplyId: id.optional(),
  sourcePlanItemId: id.optional(),
  coverage: coverageSchema,
  status: z.enum(PLAN_ITEM_STATUSES),
  carriedFromId: id.optional(),
  addedBy: z.string(),
  addedAt: timestamp.optional(),
});
export type PlanItemDoc = z.infer<typeof planItemSchema>;

const usedLine = z.object({ ingredientId: id, canonicalAmount: z.number() });
export const cookEventSchema = z.object({
  planItemId: id.optional(),
  periodId: id.optional(),
  savedMealId: id.optional(),
  /** The meal's name or recipe titles joined, kept so history survives deletions. */
  title: z.string().optional(),
  recipeIds: z.array(id),
  titles: z.array(z.string()),
  /** The meal's sides as cooked (R5.9, History). */
  sides: z.array(mealSideSchema).optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
  servings: z.number().positive().optional(),
  cookedBy: z.string(),
  cookedAt: timestamp,
  /** The recipe defaults at the planned servings (what the review pre-fills); after a review, the confirmed amounts. */
  used: z.array(usedLine),
  /** The recipe defaults as cooked, kept for "deviations from the recipe" (R10.1). */
  defaults: z.array(usedLine).optional(),
  /** What the ledger actually took per ingredient (less than `used` when supply ran short). */
  deducted: z.array(usedLine).optional(),
  /** Per-lot takes, so a review that used less puts it back where it came from. */
  takes: z.array(z.object({ ingredientId: id, lotId: id, amount: z.number() })).optional(),
  leftoverPortions: nonNegInt,
  leftoverSupplyId: id.optional(),
  leftoverPlanItemIds: z.array(id).optional(),
  reviewStatus: z.enum(["pending", "done"]),
  reviewedBy: z.string().optional(),
  ratedBy: z.array(z.string()),
  note: z.string().optional(),
});
export type CookEventDoc = z.infer<typeof cookEventSchema>;

export const ratingSchema = z.object({
  uid: z.string(),
  cookEventId: id,
  targetType: z.enum(["recipe", "meal"]),
  targetId: id,
  score: z.number().int().min(1).max(10),
  createdAt: timestamp.optional(),
});
export type RatingDoc = z.infer<typeof ratingSchema>;

/**
 * One grocery line (§4.2, §8). Plan lines are keyed by ingredient ID, manual ones `manual_<uuid>`. `amount` is what is
 * bought in canonical units (`measure` = the ingredient's canonical unit): packs × pack size, or the raw shortfall when
 * no pack size is known. It is what counts as "incoming" once the list is ordered. Free-text lines have no amount.
 */
export const groceryItemSchema = z.object({
  ingredientId: id.optional(),
  freeText: z.string().max(120).optional(),
  amount: z.number().min(0),
  measure: z.string(),
  /** Canonical shortfall the line covers (plan lines). */
  need: z.number().min(0).optional(),
  /** Canonical amount per pack, or null when the raw amount is listed. */
  packAmount: z.number().positive().nullable().optional(),
  /** "400 g", "4 L", "12 ct": the pack as a shopper reads it. */
  packLabel: z.string().optional(),
  packs: z.number().min(0),
  productName: z.string(),
  storeId: id,
  estPriceCents: cents.min(0).nullable(),
  priceSource: z.enum(["live", "estimate", "unknown"]).optional(),
  source: z.enum(["plan", "manual", "cadence"]),
  checked: z.boolean(),
  checkedBy: z.string().optional(),
  /** Set by receiveGroceries: canonical amount that arrived (0 = didn't arrive) and the ingredient actually bought. */
  receivedAmount: z.number().min(0).optional(),
  receivedIngredientId: id.optional(),
});
export type GroceryItem = z.infer<typeof groceryItemSchema>;

export const GROCERY_STATUSES = ["draft", "ordered", "received"] as const;
export const groceryListSchema = z.object({
  periodId: id,
  status: z.enum(GROCERY_STATUSES),
  createdAt: timestamp,
  orderedAt: timestamp.optional(),
  orderedBy: z.string().optional(),
  receivedAt: timestamp.optional(),
  receivedBy: z.string().optional(),
  /** Σ estimated cost of what arrived (prices at the time): the period's spend (R10.3). */
  receivedCents: z.number().int().min(0).optional(),
  items: z.record(z.string(), groceryItemSchema),
});
export type GroceryListDoc = z.infer<typeof groceryListSchema>;

export const lotSchema = z.object({
  lotId: id,
  amount: z.number().min(0),
  location: z.enum(STORAGE_LOCATIONS),
  acquiredAt: timestamp,
  expiresFresh: timestamp.optional(),
  expiresFrozen: timestamp.optional(),
  frozenAt: timestamp.optional(),
  expiryExtendedTo: timestamp.optional(),
});

export const supplySchema = z.object({
  ingredientId: id.optional(),
  label: z.string(),
  canonicalAmount: z.number().min(0),
  canonicalUnit: z.enum(["g", "count"]),
  lots: z.array(lotSchema),
  nextExpiry: timestamp.nullable().optional(),
  /** Leftover batches: the cook event they came from and the meal type they fill. */
  cookEventId: id.optional(),
  leftoverMealType: z.enum(MEAL_TYPES).optional(),
  /** Set when a consumption found less than it needed ("check the amount"); cleared by a correction or purchase. */
  shortAt: timestamp.nullable().optional(),
  updatedAt: timestamp.optional(),
});
export type SupplyDoc = z.infer<typeof supplySchema>;

export const TRANSACTION_KINDS = [
  "purchase",
  "cook",
  "correction",
  "discard",
  "freeze",
  "thaw",
  "leftover",
  "eaten",
  "extendExpiry",
] as const;

export const transactionSchema = z.object({
  delta: z.number(),
  kind: z.enum(TRANSACTION_KINDS),
  lotId: id,
  ref: z.object({ type: z.string(), id: id }).optional(),
  commandId: id.optional(),
  uid: z.string(),
  note: z.string().optional(),
  createdAt: timestamp,
});
export type TransactionDoc = z.infer<typeof transactionSchema>;

export const commandSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  uid: z.string(),
  createdAt: timestamp,
  /** `running`: an importHousehold the function has claimed (it runs outside a single transaction, §13). */
  status: z.enum(["pending", "running", "applied", "failed"]),
  error: z.string().optional(),
  appliedAt: timestamp.optional(),
  /** A no-op outcome worth showing ("already cooked"). */
  result: z.string().optional(),
});
export type CommandDoc = z.infer<typeof commandSchema>;

export const cadenceSchema = z.object({
  /** EMA of purchase gaps; null until bought twice (the client uses the seed's defaultCadenceDays). */
  avgIntervalDays: z.number().positive().nullable(),
  lastPurchasedAt: timestamp,
  purchaseCount: nonNegInt.optional(),
  snoozedUntil: timestamp.optional(),
});
export type CadenceDoc = z.infer<typeof cadenceSchema>;
