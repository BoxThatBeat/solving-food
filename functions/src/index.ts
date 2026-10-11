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
import { runMaintenance } from "./maintenance";
import { applyCommand } from "./commands";
import { cleanupIfEmpty } from "./households";
import { cancelTimer as cancelTimerLogic, fireTimer, scheduleTimer as scheduleTimerLogic, type TimerTask } from "./timers";
import { defineSecret, defineString } from "firebase-functions/params";
import { CallError, pcxStatus as pcxStatusLogic, searchProducts, searchStores } from "./pcx";

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

// PC Express (§8): the credentials are Secret Manager secrets, bound only once the owner has set them and switched the
// module on with PCX_ENABLED=true in functions/.env (a deploy that names a missing secret fails). Until then every
// PC Express function answers "not connected" and the app prices from the bundled estimates.
const PCX_ON = process.env.PCX_ENABLED === "true";
const PCX_SECRETS = PCX_ON ? [defineSecret("PCX_EMAIL"), defineSecret("PCX_PASSWORD")] : [];
/** Who hears about failed price refreshes (SETUP.md: the owner's uid). */
const OWNER_UID = defineString("OWNER_UID", { default: "HBebN9sYntQG1Kbdx5Ggw611xyy1" });

/** Weekly maintenance (§13): Monday 04:00 Toronto time; trash purge, index refresh, and the PC Express price refresh. */
export const maintenance = onSchedule({ schedule: "every monday 04:00", timeZone: "America/Toronto", timeoutSeconds: 540, secrets: PCX_SECRETS }, async () => {
  const report = await runMaintenance(Date.now(), { ownerUid: OWNER_UID.value() || null });
  logger.info("maintenance", report);
});

function memberUid(auth: { uid: string; token: { email_verified?: boolean } } | undefined): string {
  if (!auth || auth.token.email_verified !== true) throw new HttpsError("unauthenticated", "Sign in first");
  return auth.uid;
}

async function pcxCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CallError) throw new HttpsError(e.code, e.message);
    throw e;
  }
}

/** PC Express store search for the store picker (R6.22). */
export const pcxSearchStores = onCall({ cors: true, secrets: PCX_SECRETS }, (req) => pcxCall(() => searchStores(memberUid(req.auth), req.data)));
/** PC Express product search for brand mappings (R7.10); writes the results' prices. */
export const pcxSearchProducts = onCall({ cors: true, secrets: PCX_SECRETS }, (req) => pcxCall(() => searchProducts(memberUid(req.auth), req.data)));
/** Whether PC Express is connected (Settings). */
export const pcxStatus = onCall({ cors: true, secrets: PCX_SECRETS }, (req) => pcxCall(() => pcxStatusLogic(memberUid(req.auth), req.data)));

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

function timerUid(auth: { uid: string; token: { email_verified?: boolean } } | undefined): string {
  if (!auth || auth.token.email_verified !== true) throw new HttpsError("unauthenticated", "Sign in first");
  return auth.uid;
}

/** Cooking timers (§12): schedule or reschedule the push for a running timer. */
export const scheduleTimer = onCall({ cors: true }, async (req) => {
  const uid = timerUid(req.auth);
  const d = (req.data ?? {}) as Record<string, unknown>;
  try {
    const taskId = await scheduleTimerLogic(uid, { timerId: String(d.timerId ?? ""), endsAt: Number(d.endsAt), label: String(d.label ?? "Timer"), title: d.title ? String(d.title) : undefined, link: String(d.link ?? "/") });
    return { taskId };
  } catch (e) {
    throw new HttpsError("invalid-argument", (e as Error).message);
  }
});

/** Pause or cancel a timer: its push won't fire. */
export const cancelTimer = onCall({ cors: true }, async (req) => {
  const uid = timerUid(req.auth);
  await cancelTimerLogic(uid, String((req.data as { timerId?: unknown })?.timerId ?? ""));
  return { ok: true };
});

/** The `timers` Cloud Tasks queue's handler: sends the push when a timer ends. */
export const timers = onTaskDispatched({ retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 }, rateLimits: { maxConcurrentDispatches: 6 } }, async (req) => {
  const r = await fireTimer(req.data as TimerTask);
  logger.info("timer", r);
});
