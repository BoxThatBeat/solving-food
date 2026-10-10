// Cloud Functions for Firebase (2nd gen), region us-east1 (TECHNICAL_SPECS §1–2).
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { REGION } from "@solving-food/core";

// Keep every function small and cheap: free tier is a hard requirement (PRD NFR2).
setGlobalOptions({ region: REGION, maxInstances: 2, memory: "256MiB" });

/** Proves the deploy path and the emulator harness (Planning/M0 §1). */
export const healthcheck = onRequest({ cors: false, invoker: "public" }, (_req, res) => {
  res.status(200).json({ ok: true, service: "solving-food", region: REGION });
});
