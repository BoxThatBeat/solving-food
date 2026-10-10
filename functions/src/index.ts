// Cloud Functions for Firebase (2nd gen), region us-east1 (TECHNICAL_SPECS §1–2).
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { REGION, STORAGE_BUCKET } from "@solving-food/core";
import { syncRecipeIndex } from "./recipeIndex";
import { cleanupDeletedRecipe } from "./recipeCleanup";
import { conversionChanged, recomputeRecipesUsing } from "./recipes";
import { DROP_PREFIX, handleDropObject } from "./dropFolder";
import { runMaintenance } from "./maintenance";

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

/** Weekly maintenance (§13): Monday 04:00 Toronto time. M5 adds the price refresh here. */
export const maintenance = onSchedule({ schedule: "every monday 04:00", timeZone: "America/Toronto", timeoutSeconds: 540 }, async () => {
  const report = await runMaintenance();
  logger.info("maintenance", report);
});
