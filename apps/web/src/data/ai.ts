// Gemini from the app (PRD R4.27, R4.35, R4.36, R4.37): its status and the owner's key, Check names, and Add with
// Gemini (a recipe from a link or a photo).
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes } from "firebase/storage";
import type { PcxStatus } from "@solving-food/core";
import { functions, storage } from "@/firebase/app";

export interface AiStatus extends PcxStatus {
  waiting: number;
}
export interface CheckReport {
  checked: number;
  merged: Array<{ from: string; into: string }>;
  kept: string[];
  unsure: string[];
  remaining: number;
  message?: string;
}

const STATUS_CHANGED = "ai-status-changed";
const changed = () => window.dispatchEvent(new Event(STATUS_CHANGED));

/** Saves the Gemini key (owner only; "" clears it); the status asks again. */
export async function setAiKey(hid: string, apiKey: string): Promise<PcxStatus> {
  const r = (await httpsCallable<{ hid: string; apiKey: string }, PcxStatus>(functions, "aiSetKey")({ hid, apiKey })).data;
  changed();
  return r;
}

/** Check names (owner only): Gemini judges the waiting names; sure ones are merged or kept. */
export async function checkIngredientNames(hid: string): Promise<CheckReport> {
  const r = (await httpsCallable<{ hid: string }, CheckReport>(functions, "checkIngredientNames", { timeout: 300_000 })({ hid })).data;
  changed();
  return r;
}

/** Gemini's status for this person (null while asking or offline). */
export function useAiStatus(hid: string | null): AiStatus | null {
  const [s, setS] = useState<{ hid: string; status: AiStatus } | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(STATUS_CHANGED, again);
    return () => window.removeEventListener(STATUS_CHANGED, again);
  }, []);
  useEffect(() => {
    if (!hid) return;
    let live = true;
    httpsCallable<{ hid: string }, AiStatus>(functions, "aiStatus")({ hid })
      .then((r) => live && setS({ hid, status: r.data }))
      .catch(() => live && setS({ hid, status: { connected: false, waiting: 0, message: "Couldn't reach the server to check Gemini." } }));
    return () => {
      live = false;
    };
  }, [hid, asked]);
  return s?.hid === hid ? s.status : null;
}

export interface AddRecipeResult {
  status: "imported" | "pendingDuplicateReview";
  recipeId: string;
  title: string;
  warnings: string[];
}

const addRecipe = (data: { source: "link"; url: string } | { source: "photo"; path: string }) =>
  httpsCallable<typeof data, AddRecipeResult>(functions, "addRecipeWithGemini", { timeout: 240_000 })(data).then((r) => r.data);

/** Add with Gemini from a web link (R4.37). */
export function addRecipeFromLink(url: string): Promise<AddRecipeResult> {
  return addRecipe({ source: "link", url });
}

const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif", "image/gif": "gif" };

/** Add with Gemini from a photo (R4.37): uploaded to recipe-photos/{uid}/ (the function deletes it), then read. */
export async function addRecipeFromPhoto(uid: string, file: File): Promise<AddRecipeResult> {
  const type = file.type || "image/jpeg";
  const ext = PHOTO_EXT[type];
  if (!ext) throw new Error("That isn't a photo the app can read (JPEG, PNG, WebP, HEIC)");
  if (file.size > 10 * 1024 * 1024) throw new Error("That photo is over 10 MB");
  const path = `recipe-photos/${uid}/${crypto.randomUUID().replace(/-/g, "")}.${ext}`;
  await uploadBytes(ref(storage, path), file, { contentType: type });
  return addRecipe({ source: "photo", path });
}
