// Browser-side image resizing for recipe photos (TECHNICAL_SPECS §2): three widths (480 / 960 / 1920 px), WebP, uploaded
// to `recipes/{recipeId}/{imageId}/{size}.webp`. Browsers that can't encode WebP from a canvas (Safari) get JPEG under
// the same names; Storage serves the real content type, so <img> doesn't care.
import { ref, uploadBytes } from "firebase/storage";
import { IMAGE_SIZES, imageVariant } from "@solving-food/core";
import { storage } from "@/firebase/app";

const MAX_BYTES = 2 * 1024 * 1024; // storage.rules

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!jpeg) throw new Error("This browser couldn't encode the image");
  return jpeg;
}

async function resized(bitmap: ImageBitmap, width: number): Promise<Blob> {
  const w = Math.min(width, bitmap.width);
  const h = Math.round((bitmap.height * w) / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await encode(canvas, q);
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("The image is too large even after compression");
}

/** A new image's base path, `recipes/{recipeId}/{imageId}`, before anything is uploaded. */
export function newImageBase(recipeId: string): string {
  return `recipes/${recipeId}/${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Resizes a picked photo and uploads the three sizes; returns the image base path for `imagePaths`. Storage only takes
 * uploads for a recipe that exists (M22), so a new recipe's photo waits for the save and is uploaded under the base it
 * was given then (`base`).
 */
export async function uploadRecipeImage(recipeId: string, file: File, base = newImageBase(recipeId)): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't an image");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    for (const size of IMAGE_SIZES) {
      const blob = await resized(bitmap, size);
      await uploadBytes(ref(storage, imageVariant(base, size)), blob, {
        contentType: blob.type,
        cacheControl: "public, max-age=31536000, immutable",
      });
    }
    return base;
  } finally {
    bitmap.close();
  }
}

const GEMINI_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * A photo shrunk for Gemini: its longest side at most `maxEdge` px (2048 keeps a long till receipt's small print and a
 * cookbook page readable), JPEG. A photo the browser can't decode (HEIC outside Safari) goes as it is when it's small
 * enough.
 */
export async function shrinkPhoto(file: File, maxEdge = 2048, maxBytes = 4 * 1024 * 1024): Promise<Blob> {
  let bitmap: ImageBitmap | null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    const type = file.type || "image/jpeg";
    if (!GEMINI_TYPES.has(type)) throw new Error("That isn't a photo the app can read (JPEG, PNG, WebP, HEIC)");
    if (file.size > maxBytes) throw new Error("That photo is too large; take it again or crop it");
    return file.type ? file : new Blob([file], { type });
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= maxBytes) return blob;
    }
    throw new Error("That photo is too large even after shrinking it");
  } finally {
    bitmap.close();
  }
}

/** A photo for Gemini to read (M25, a receipt): shrunk (`shrinkPhoto`), as base64 for a callable. Never uploaded. */
export async function photoForGemini(file: File, maxEdge = 2048, maxBytes = 4 * 1024 * 1024): Promise<{ mimeType: string; data: string }> {
  const blob = await shrinkPhoto(file, maxEdge, maxBytes);
  return { mimeType: blob.type, data: toBase64(await blob.arrayBuffer()) };
}
