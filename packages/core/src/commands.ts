// Supply commands (TECHNICAL_SPECS §6 "Command pattern"): every supply change is a document in
// households/{hid}/commands that a function validates with these schemas and applies in a transaction. The client
// writes them (they queue offline), firestore.rules' validCommand() mirrors the outer shape, and the client's
// optimistic projection reads the same payloads. Amounts are canonical (g or count); instants are epoch ms.

import { z } from "zod";
import { MEAL_TYPES, STORAGE_LOCATIONS } from "./taxonomy";
import { MEAL_RECIPES_MAX, MEAL_SIDES_MAX, mealSideSchema } from "./types";

const id = z.string().min(1).max(200);
const amount = z.number().finite().min(0).max(1e7);
const ms = z.number().int().min(0);

export const addSupplyPayload = z.object({
  ingredientId: id,
  amount: amount.positive(),
  location: z.enum(STORAGE_LOCATIONS),
  /** The amount added, in metric, for the transaction note ("380 g"; R8.13). */
  entered: z.string().max(60).optional(),
});

export const receiveItemPayload = z.object({
  /** Key of the line on the grocery list. */
  itemId: id,
  /** The ingredient actually bought (a substitution changes it); absent for free-text lines. */
  ingredientId: id.optional(),
  /** Canonical amount bought; 0 = didn't arrive. */
  amount,
  /** Canonical amount to put straight in the freezer (R7.9). */
  freezeAmount: amount.optional(),
  missing: z.boolean().optional(),
});

export const receiveGroceriesPayload = z.object({
  listId: id,
  items: z.array(receiveItemPayload).max(400),
});

export const recipeRefPayload = z.object({ recipeId: id, servingsMultiplier: z.number().positive().max(10) });

export const finishCookingPayload = z.object({
  /** Chosen by the client so it can open the review straight away; also the idempotency key. */
  cookEventId: id,
  planItemId: id.optional(),
  savedMealId: id.optional(),
  recipes: z.array(recipeRefPayload).min(1).max(MEAL_RECIPES_MAX),
  servings: z.number().positive().max(100),
  mealType: z.enum(MEAL_TYPES).optional(),
  title: z.string().max(200).optional(),
  /** The meal's sides (R5.10); absent = the plan item's. */
  sides: z.array(mealSideSchema).max(MEAL_SIDES_MAX).optional(),
});

export const ratingPayload = z.object({
  targetType: z.enum(["recipe", "meal"]),
  targetId: id,
  score: z.number().int().min(1).max(10),
});

export const submitReviewPayload = z.object({
  cookEventId: id,
  ratings: z.array(ratingPayload).max(MEAL_RECIPES_MAX + 1),
  /** Confirmed amounts actually used (the whole list). Absent = rating only (another member adding theirs). */
  used: z.array(z.object({ ingredientId: id, canonicalAmount: amount })).max(150).optional(),
  leftoverPortions: z.number().int().min(0).max(50).optional(),
  /** Set when "Save this meal?" saved the meal during the review (R5.8). */
  savedMealId: id.optional(),
  note: z.string().max(500).optional(),
});

export const correctSupplyPayload = z.object({
  supplyId: id,
  /** The amount there really is now (canonical). */
  target: amount,
  /** Needed when the supply doc doesn't exist yet. */
  ingredientId: id.optional(),
  note: z.string().max(200).optional(),
});

export const discardPayload = z.object({ supplyId: id, lotId: id, amount: amount.optional() });
export const extendExpiryPayload = z.object({ supplyId: id, lotId: id, until: ms.optional() });
export const freezePayload = z.object({ supplyId: id, lotId: id, amount: amount.optional() });
export const thawPayload = z.object({ supplyId: id, lotId: id, amount: amount.optional() });
export const markEatenPayload = z.object({ planItemId: id });
/** Placeholder until M4 (household data import, §13). */
export const importHouseholdPayload = z.object({ path: z.string().min(1).max(500) });
/** "Not yet" on a staples prompt (R7.7): cadence is function-only, so the snooze is a command (M5). */
export const snoozeCadencePayload = z.object({ ingredientId: id, until: ms });

export const COMMAND_PAYLOADS = {
  addSupply: addSupplyPayload,
  receiveGroceries: receiveGroceriesPayload,
  finishCooking: finishCookingPayload,
  submitReview: submitReviewPayload,
  correctSupply: correctSupplyPayload,
  discard: discardPayload,
  extendExpiry: extendExpiryPayload,
  freeze: freezePayload,
  thaw: thawPayload,
  markEaten: markEatenPayload,
  importHousehold: importHouseholdPayload,
  snoozeCadence: snoozeCadencePayload,
} as const;

export type CommandType = keyof typeof COMMAND_PAYLOADS;
export const COMMAND_TYPES = Object.keys(COMMAND_PAYLOADS) as CommandType[];
export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

export type AnyCommand = { [K in CommandType]: { type: K; payload: CommandPayload<K> } }[CommandType];

export const commandInputSchema = z.discriminatedUnion(
  "type",
  COMMAND_TYPES.map((t) => z.object({ type: z.literal(t), payload: COMMAND_PAYLOADS[t] })) as unknown as [
    z.ZodObject<{ type: z.ZodLiteral<CommandType>; payload: z.ZodTypeAny }>,
    ...Array<z.ZodObject<{ type: z.ZodLiteral<CommandType>; payload: z.ZodTypeAny }>>,
  ],
);

/** Validates a stored command's type and payload. Throws a ZodError with a readable message. */
export function parseCommand(doc: { type: unknown; payload: unknown }): AnyCommand {
  return commandInputSchema.parse({ type: doc.type, payload: doc.payload }) as AnyCommand;
}

export function isCommandType(t: unknown): t is CommandType {
  return typeof t === "string" && t in COMMAND_PAYLOADS;
}

/** ID of a household's supply doc: the ingredient ID, or `leftover_<cookEventId>` for a leftover batch (§4.2). */
export function leftoverSupplyId(cookEventId: string): string {
  return `leftover_${cookEventId}`;
}

/** Rating doc ID: one per person, cook event, and target, so re-rating replaces. */
export function ratingId(cookEventId: string, uid: string, targetType: string, targetId: string): string {
  return `${cookEventId}_${uid}_${targetType}_${targetId}`.slice(0, 400);
}

/** Stats doc ID (`stats/{type_targetId}`). */
export function statsId(type: "recipe" | "meal", targetId: string): string {
  return `${type}_${targetId}`;
}
