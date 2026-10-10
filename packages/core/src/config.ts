// App-wide constants shared by the web app and functions.

/** Every Firebase resource lives here (TECHNICAL_SPECS §2). */
export const REGION = "us-east1";

/** The default Cloud Storage bucket (SETUP.md); the drop-folder trigger names it explicitly. */
export const STORAGE_BUCKET = "solvingfood.firebasestorage.app";

/** R2.3: a user can create at most this many households. Enforced in firestore.rules too. */
export const MAX_HOUSEHOLDS_CREATED = 3;

export const DEFAULT_TIMEZONE = "America/Toronto";
export const DEFAULT_SERVINGS = 4;
export const DEFAULT_PERIOD_DAYS = 7;
export const DEFAULT_BUDGET_CENTS = 200_00;
export const CURRENCY = "CAD";
export const DEFAULT_HOUSEHOLD_NAME = "Home";

/**
 * PC Express store for prices (R6.22): Loblaws Greenbank Road, Ottawa.
 * Placeholder until M5 looks the real store ID up with `pcxSearchStores` and replaces this constant.
 */
export const DEFAULT_PCX_STORE_ID = "loblaws-greenbank-road";

export const DISPLAY_NAME_MAX = 40;
export const HOUSEHOLD_NAME_MAX = 60;
export const SERVINGS_MAX = 20;
export const PERIOD_DAYS_MAX = 28;
