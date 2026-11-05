// Cloud Functions for Firebase (2nd gen), region us-east1 (TECHNICAL_SPECS §1–2).
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { REGION, STORAGE_BUCKET } from "@solving-food/core";
import { syncRecipeIndex } from "./recipeIndex";
import { cleanupDeletedRecipe } from "./recipeCleanup";
import { conversionChanged, recomputeRecipesUsing } from "./recipes";
import { DROP_PREFIX, handleDropObject } from "./dropFolder";
import { runScheduledMaintenance } from "./maintenance";
import { applyCommand } from "./commands";
import { cleanupIfEmpty } from "./households";
import { cancelTimer as cancelTimerLogic, fireTimer, scheduleTimer as scheduleTimerLogic, timerRateLimit, type TimerTask } from "./timers";
import { defineString } from "firebase-functions/params";
import { CallError, pcxStatus as pcxStatusLogic, searchProducts, searchStores, setKey } from "./pcx";
import { aiSetKey as aiSetKeyLogic, aiStatus as aiStatusLogic, checkIngredientNames as checkNamesLogic } from "./ai";
import { addRecipeWithGemini as addRecipeLogic } from "./ai/addRecipe";
import { readReceiptCall } from "./ai/receipt";
import { MergeError, ownerMergeIngredient, requireAllowed } from "./ingredients";

// Keep every function small and cheap: free tier is a hard requirement (PRD NFR2).
setGlobalOptions({ region: REGION, maxInstances: 2, memory: "256MiB" });

/** Proves the deploy path and the emulator harness (Planning/M0 §1). */
export const healthcheck = onRequest({ cors: false, invoker: "public" }, (_req, res) => {
  res.status(200).json({ ok: true, service: "solving-food", region: REGION });
});

/** Keeps recipeIndex/{chunk} in step with every recipe write (§9 "Search"). */
export const recipeIndex = onDocumentWritten("recipes/{id}", async (event) => {
  const before = event.data?.before.exists ? event.data.before.data()! : null;
  const after = event.data?.after.exists ? event.data.after.data()! : null;
  await syncRecipeIndex(event.params.id, before, after);
});

/** Purge and discarded-import cleanup (§4.4). */
export const recipeCleanup = onDocumentDeleted("recipes/{id}", async (event) => {
  const report = await cleanupDeletedRecipe(event.params.id);
  logger.info("recipe cleanup", { id: event.params.id, ...report });
});

/** Protein and canonical amounts follow ingredient edits (§5). */
export const ingredientRecipes = onDocumentWritten("ingredients/{id}", async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : undefined;
  const after = event.data?.after.exists ? event.data.after.data() : undefined;
  if (!before || !after || !conversionChanged(before, after)) return;
  const n = await recomputeRecipesUsing(event.params.id);
  if (n) logger.info("recipes recomputed", { ingredient: event.params.id, recipes: n });
});

/** The drop folder (§9). Fires for every object in the bucket; returns at once unless it's a recipe-drop .cook. */
export const dropFolder = onObjectFinalized({ bucket: STORAGE_BUCKET, memory: "512MiB", timeoutSeconds: 120 }, async (event) => {
  const name = event.data.name ?? "";
  if (!name.startsWith(DROP_PREFIX)) return;
  const outcome = await handleDropObject(name, event.data.generation);
  logger.info("drop", { name, ...outcome });
});

// PC Express (§8): no account and no secrets, only the website's public API key, which the owner saves in Settings →
// Stores (R6.28, pcxSetKey). Until then every PC Express function answers "not connected" and the app prices from the
// bundled estimates.
/** Who hears about failed price refreshes and may change the PC Express key (SETUP.md: the owner's uid). */
const OWNER_UID = defineString("OWNER_UID", { default: "HBebN9sYntQG1Kbdx5Ggw611xyy1" });

/**
 * Weekly maintenance (§13): Monday 04:00 Toronto time; trash purge, index refresh, the PC Express price refresh, and (M22)
 * stuck commands, retention and orphaned uploads. Two failures in a row reach the owner (system/maintenance).
 */
export const maintenance = onSchedule({ schedule: "every monday 04:00", timeZone: "America/Toronto", timeoutSeconds: 540 }, async () => {
  const report = await runScheduledMaintenance(Date.now(), { ownerUid: OWNER_UID.value() || null });
  logger.info("maintenance", report);
});

type Auth = { uid: string; token: { email?: string; email_verified?: boolean } } | undefined;

/** Maps the modules' own errors to HttpsError (the message reaches the person). */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CallError || e instanceof MergeError) throw new HttpsError(e.code, e.message);
    throw e;
  }
}

/**
 * Every callable runs `fn` for a verified, allowlisted caller only (M22): email-link sign-in verifies any address, so a
 * verified token alone would let a stranger call PC Express, Gemini or Cloud Tasks.
 */
const allowedCall = <T>(auth: Auth, fn: (uid: string) => Promise<T>) => call(async () => fn(await requireAllowed(auth)));

/** PC Express store search for the store picker (R6.22). */
export const pcxSearchStores = onCall({ cors: true }, (req) => allowedCall(req.auth, (uid) => searchStores(uid, req.data)));
/** PC Express product search for brand mappings (R7.10); writes the results' prices. */
export const pcxSearchProducts = onCall({ cors: true }, (req) => allowedCall(req.auth, (uid) => searchProducts(uid, req.data)));
/** Whether PC Express is connected (Settings). */
export const pcxStatus = onCall({ cors: true }, (req) => allowedCall(req.auth, (uid) => pcxStatusLogic(uid, req.data, OWNER_UID.value() || null)));
/** Gemini for the ingredient judge (R4.27, R4.36): status, the owner's key, and Check names (5 minutes: merges). */
export const aiStatus = onCall({ cors: true }, (req) => allowedCall(req.auth, (uid) => aiStatusLogic(uid, req.data, OWNER_UID.value() || null)));
export const aiSetKey = onCall({ cors: true }, (req) => allowedCall(req.auth, (uid) => aiSetKeyLogic(uid, req.data, OWNER_UID.value() || null)));
export const checkIngredientNames = onCall({ cors: true, timeoutSeconds: 300 }, (req) => allowedCall(req.auth, (uid) => checkNamesLogic(uid, req.data, OWNER_UID.value() || null)));
function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Add with Gemini (R4.37): a link or photo becomes a recipe. Allowlisted callers; Gemini can take a while, a photo is big. */
export const addRecipeWithGemini = onCall({ cors: true, timeoutSeconds: 240, memory: "512MiB" }, async (req) => {
  try {
    const uid = await requireAllowed(req.auth);
    return await addRecipeLogic(uid, req.data);
  } catch (e) {
    // Logged so a failure can be read later (the person only sees the message); never the page, photo or text.
    const d = (req.data ?? {}) as { source?: unknown; url?: unknown };
    logger.warn("add with Gemini failed", { uid: req.auth?.uid, source: d.source, host: typeof d.url === "string" ? safeHost(d.url) : undefined, error: (e as Error).message });
    if (e instanceof MergeError) throw new HttpsError(e.code, e.message);
    if (e instanceof CallError) throw new HttpsError(e.code, e.message);
    throw e;
  }
});
/**
 * From a receipt (M25, R7.15): Gemini reads a receipt photo or an order confirmation's text and the lines are matched to
 * the ordered list. Writes nothing; the photo is only in memory. A photo is a few hundred kB to a few MB, so 512 MiB.
 */
export const readReceipt = onCall({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (req) => {
  try {
    const uid = await requireAllowed(req.auth);
    return await readReceiptCall(uid, req.data);
  } catch (e) {
    // Logged without the receipt (no lines, text or photo), so a failure can be read later.
    logger.warn("read receipt failed", { uid: req.auth?.uid, source: (req.data as { image?: unknown } | null)?.image ? "photo" : "text", error: (e as Error).message });
    if (e instanceof MergeError) throw new HttpsError(e.code, e.message);
    if (e instanceof CallError) throw new HttpsError(e.code, e.message);
    throw e;
  }
});

/** Saves the PC Express API key (owner only, R6.28). */
export const pcxSetKey = onCall({ cors: true }, (req) => allowedCall(req.auth, (uid) => setKey(uid, req.data, OWNER_UID.value() || null)));

/**
 * "Merge into…" (§6 "Merging ingredients", R4.27, R4.35, R8.16): moves a duplicate ingredient's recipes, meals, Supply,
 * plan and grocery lines onto the ingredient it means, in every household. The owner only (M22): it rewrites everyone's
 * data. Rare (Claude's answer on the Ingredients page), so 5 minutes is plenty.
 */
export const mergeIngredient = onCall({ cors: true, timeoutSeconds: 300 }, (req) =>
  allowedCall(req.auth, async (uid) => {
    const report = await ownerMergeIngredient(uid, req.data, OWNER_UID.value() || null);
    if (!report.dryRun) logger.info("ingredient merged", report);
    return report;
  }),
);

/**
 * Supply commands (§6): every supply change, cook event, rating, and stat goes through here. 512 MiB and 5 minutes
 * for importHousehold (§13), which unzips an export and rewrites the household; other commands take about a second.
 */
export const commands = onDocumentCreated({ document: "households/{hid}/commands/{id}", retry: false, memory: "512MiB", timeoutSeconds: 300 }, async (event) => {
  const r = await applyCommand(event.params.hid, event.params.id);
  logger.info("command", { hid: event.params.hid, id: event.params.id, ...r });
});

/** Empty-household cleanup (§10, R2.13): the last member leaving deletes the household and all of its data. */
export const householdCleanup = onDocumentDeleted({ document: "households/{hid}/members/{uid}", timeoutSeconds: 300 }, async (event) => {
  const r = await cleanupIfEmpty(event.params.hid);
  if (r.status !== "kept") logger.info("household cleanup", { hid: event.params.hid, ...r });
});

/** Cooking timers (§12): schedule or reschedule the push for a running timer. Allowlisted, rate limited (M22). */
export const scheduleTimer = onCall({ cors: true }, (req) =>
  allowedCall(req.auth, async (uid) => {
    await timerRateLimit(uid);
    const d = (req.data ?? {}) as Record<string, unknown>;
    try {
      const taskId = await scheduleTimerLogic(uid, { timerId: String(d.timerId ?? ""), endsAt: Number(d.endsAt), label: String(d.label ?? "Timer"), title: d.title ? String(d.title) : undefined, link: String(d.link ?? "/") });
      return { taskId };
    } catch (e) {
      throw new HttpsError("invalid-argument", (e as Error).message);
    }
  }),
);

/** Pause or cancel a timer: its push won't fire. */
export const cancelTimer = onCall({ cors: true }, (req) =>
  allowedCall(req.auth, async (uid) => {
    await cancelTimerLogic(uid, String((req.data as { timerId?: unknown })?.timerId ?? ""));
    return { ok: true };
  }),
);

/** The `timers` Cloud Tasks queue's handler: sends the push when a timer ends. */
export const timers = onTaskDispatched({ retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 }, rateLimits: { maxConcurrentDispatches: 6 } }, async (req) => {
  const r = await fireTimer(req.data as TimerTask);
  logger.info("timer", r);
});
