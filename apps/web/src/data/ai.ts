// Gemini from the app (PRD R4.27, R4.35, R4.36, R4.37): its status and the owner's key, Check names, and Add with
// Gemini (a recipe from a link or a photo).
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes } from "firebase/storage";
import type { MatchedLine, PcxStatus } from "@solving-food/core";
import { functions, storage } from "@/firebase/app";
import { shrinkPhoto } from "@/lib/images";
import { useCallableStatus } from "./callableStatus";

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
const AI_UNREACHABLE: AiStatus = { connected: false, waiting: 0, message: "Couldn't reach the server to check Gemini." };
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
  return useCallableStatus<AiStatus>(hid, "aiStatus", STATUS_CHANGED, AI_UNREACHABLE);
}

export interface AddRecipeResult {
  status: "imported" | "pendingDuplicateReview";
  recipeId: string;
  title: string;
  warnings: string[];
}

const addRecipe = (data: { source: "link"; url: string } | { source: "photo"; paths: string[]; text?: string }) =>
  httpsCallable<typeof data, AddRecipeResult>(functions, "addRecipeWithGemini", { timeout: 240_000 })(data).then((r) => r.data);

/** Add with Gemini from a web link (R4.37). */
export function addRecipeFromLink(url: string): Promise<AddRecipeResult> {
  return addRecipe({ source: "link", url });
}

/** The most photos one recipe takes (the function checks it too). */
export { MAX_RECIPE_PHOTOS } from "@solving-food/core";

const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif", "image/gif": "gif" };

/** One photo shrunk (≤ 2048 px, JPEG) and uploaded to recipe-photos/{uid}/ for the function, which deletes it. */
async function uploadPhoto(uid: string, file: File): Promise<string> {
  const blob = await shrinkPhoto(file, 2048, 4 * 1024 * 1024);
  const type = blob.type || "image/jpeg";
  const ext = PHOTO_EXT[type];
  if (!ext) throw new Error("That isn't a photo the app can read (JPEG, PNG, WebP, HEIC)");
  const path = `recipe-photos/${uid}/${crypto.randomUUID().replace(/-/g, "")}.${ext}`;
  await uploadBytes(ref(storage, path), blob, { contentType: type });
  return path;
}

/** Add with Gemini from photos (R4.37): the pages of a recipe and maybe the finished dish, in order, optionally with
 * the recipe's text. Gemini works out which photo is which. */
export async function addRecipeFromPhotos(uid: string, files: File[], text = ""): Promise<AddRecipeResult> {
  const paths = await Promise.all(files.map((f) => uploadPhoto(uid, f)));
  return addRecipe(text.trim() ? { source: "photo", paths, text: text.trim() } : { source: "photo", paths });
}

export interface ReceiptResult {
  store: string | null;
  date: string | null;
  totalCents: number | null;
  lines: MatchedLine[];
  /** Ordered lines nothing on the receipt says arrived. */
  missing: string[];
}

/**
 * From a receipt (M25, R7.15): Gemini reads a receipt photo (downscaled here, sent inline, never stored) or an order
 * email's text, and the function matches its lines to the ordered list. Writes nothing.
 */
export function readReceipt(hid: string, listId: string, input: { image: { mimeType: string; data: string } } | { text: string }): Promise<ReceiptResult> {
  return httpsCallable<{ hid: string; listId: string } & typeof input, ReceiptResult>(functions, "readReceipt", { timeout: 120_000 })({ hid, listId, ...input }).then((r) => r.data);
}
