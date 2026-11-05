// Supply commands (TECHNICAL_SPECS §6 "Command pattern"): every supply change is a document in
// households/{hid}/commands that a function validates with these schemas and applies in a transaction. The client
// writes them (they queue offline), firestore.rules' validCommand() mirrors the outer shape, and the client's
// optimistic projection reads the same payloads. Amounts are canonical (g or count); instants are epoch ms.

import { z } from "zod";
import { MEAL_TYPES, STORAGE_LOCATIONS } from "./taxonomy";
import { MEAL_RECIPES_MAX, MEAL_SIDES_MAX, mealSideSchema } from "./types";
import { STEP_NOTE_MAX, STEP_NOTES_MAX } from "./cookNotes";

/**
 * A document ID (M22): many payload IDs become path segments (`supply/{ingredientId}`, `cookEvents/{cookEventId}`), so
 * no "/", not "." or "..", not Firestore's reserved `__…__`, and at most 200 characters (Firestore allows 1,500 bytes).
 */
export const COMMAND_ID_PATTERN = /^(?!\.\.?$)(?!__.*__$)[^/]+$/;
const id = z.string().min(1).max(200).regex(COMMAND_ID_PATTERN, "must be a document ID (no /)");
const amount = z.number().finite().min(0).max(1e7);
const ms = z.number().int().min(0);

export const addSupplyPayload = z.object({
  ingredientId: id,
  amount: amount.positive(),
  location: z.enum(STORAGE_LOCATIONS),
  /** The amount added, in metric, for the transaction note ("380 g"; R8.13). */
  entered: z.string().max(60).optional(),
  /** Use-by set by hand when adding (R8.18): the lot counts until this instant (midnight after the day). */
  until: ms.optional(),
  /** The unit it was typed in ("lb", "cup", "count"): Supply reads the amount back in it (owner review, R8.13). */
  unit: z.string().max(12).optional(),
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
  /** What the line cost, read from a receipt (M25, R7.17): the line total paid, cents. Absent = only the estimate. */
  paidCents: z.number().int().min(0).max(10_000_000).optional(),
  /**
   * A line that wasn't on the list, added from a receipt (M25, R7.16): `itemId` is "receipt-<n>", not a list key; `name`
   * is the receipt's wording. It goes into Supply like any line and is recorded on the list's `receiptExtras`.
   */
  extra: z.boolean().optional(),
  name: z.string().max(200).optional(),
});

/** Lines per receiveGroceries command: a grocery list holds at most 400 (firestore.rules). */
export const RECEIVE_ITEMS_MAX = 400;

export const receiveGroceriesPayload = z.object({
  listId: id,
  items: z.array(receiveItemPayload).max(RECEIVE_ITEMS_MAX),
  /** Set when the sheet was prefilled from a receipt (M25): the total it printed, cents, for the record. */
  receipt: z.object({ totalCents: z.number().int().min(0).max(10_000_000).optional() }).optional(),
});

/**
 * Lines per receiveGroceries transaction (M22). Each line writes at most four documents (its ingredient's Supply row and
 * cadence, a purchase and a freeze transaction), plus the list and the command: 100 lines is ≤ 402 writes, inside
 * Firestore's 500-write transaction limit with margin. A longer list is applied in several transactions.
 */
export const RECEIVE_CHUNK = 100;

/**
 * The lines in transaction-sized chunks (M22): every line of one ingredient stays in one chunk (so its Supply row and
 * cadence are written once), chunks are filled in order, and only an ingredient with more than `size` lines is split.
 */
export function receiveChunks<T extends { itemId: string; ingredientId?: string | undefined }>(items: readonly T[], size = RECEIVE_CHUNK): T[][] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = it.ingredientId ? `i:${it.ingredientId}` : `l:${it.itemId}`;
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  const out: T[][] = [];
  let cur: T[] = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += size) {
      const piece = g.slice(i, i + size);
      if (cur.length + piece.length > size) {
        out.push(cur);
        cur = [];
      }
      cur.push(...piece);
    }
  }
  if (cur.length || !out.length) out.push(cur);
  return out;
}

/** Swaps one finishCooking can carry (M28). */
export const SWAPS_MAX = 40;
export const swapUse = z.object({ ingredientId: id, withIngredientId: id, amount: amount.positive() });
export const stepNote = z.object({ recipeId: id, step: z.number().int().min(0).max(500), text: z.string().max(STEP_NOTE_MAX) });

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
  /**
   * M28 (R4.40): swaps accepted on mise en place: `amount` (canonical) of `withIngredientId` is deducted in place of
   * `amount / ratio` of `ingredientId`. Pairs the substitution table doesn't have are ignored (`applySwaps`).
   */
  substitutions: z.array(swapUse).max(SWAPS_MAX).optional(),
  /** M28 (R4.39): the step notes of this cook (carried forward and edited; "" = cleared), stored on the cook event. */
  stepNotes: z.array(stepNote).max(STEP_NOTES_MAX).optional(),
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
