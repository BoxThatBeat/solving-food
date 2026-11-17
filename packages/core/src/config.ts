// App-wide constants shared by the web app and functions.

/** Every Firebase resource lives here (TECHNICAL_SPECS §2). */
export const REGION = "us-east1";

/** The default Cloud Storage bucket (SETUP.md); the drop-folder trigger names it explicitly. */
export const STORAGE_BUCKET = "solvingfood.firebasestorage.app";

/** R2.3: a user can create at most this many households. Enforced in firestore.rules too. */
export const MAX_HOUSEHOLDS_CREATED = 3;

export const DEFAULT_TIMEZONE = "America/Toronto";
/** Servings for a meal whose recipes aren't loaded yet (M30: Add to plan otherwise uses the recipe's servings as written). */
export const DEFAULT_SERVINGS = 4;
export const DEFAULT_PERIOD_DAYS = 7;
export const DEFAULT_BUDGET_CENTS = 200_00;
export const CURRENCY = "CAD";
export const DEFAULT_HOUSEHOLD_NAME = "Home";

/**
 * PC Express store for prices (R6.22): Loblaws Greenbank Road, Ottawa. A placeholder ID: the PC Express functions
 * resolve it by name with the store search on first use and cache the real ID (functions/src/pcx/client.ts), so
 * households keep working whatever the real ID is. A household that picks a store in Settings stores the real ID.
 */
export const DEFAULT_PCX_STORE_ID = "loblaws-greenbank-road";
/** The default store's name, for people and ChatGPT. */
export const DEFAULT_PCX_STORE_LABEL = "Loblaws Greenbank Road (Ottawa)";

export const DISPLAY_NAME_MAX = 40;
export const HOUSEHOLD_NAME_MAX = 60;
/** Servings a meal can be planned or cooked for: a recipe's own limit (M30: Add to plan takes the servings as written). */
export const SERVINGS_MAX = 100;
export const PERIOD_DAYS_MAX = 28;
