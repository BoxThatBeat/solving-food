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

/** Resizes a picked photo and uploads the three sizes; returns the image base path for `imagePaths`. */
export async function uploadRecipeImage(recipeId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't an image");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const imageId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const base = `recipes/${recipeId}/${imageId}`;
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
