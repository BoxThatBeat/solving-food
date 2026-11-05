// Recipe images (TECHNICAL_SPECS §2, §9): always stored in our bucket (never hot-linked), as three WebP sizes under
// `recipes/{recipeId}/{imageId}/{480|960|1920}.webp`. Paths are unique per image, so they're cached as immutable.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { IMAGE_SIZES, imageVariant } from "@solving-food/core";
import { bucket } from "./admin";
import { safeFetch, SafeFetchError } from "./safeFetch";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** Retries a transient failure (dropped connection, 5xx) a couple of times with a short backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
}

/** Resizes to the three standard widths (never enlarging) and uploads them; returns the image base path. */
export async function storeRecipeImage(recipeId: string, input: Buffer): Promise<string> {
  const base = `recipes/${recipeId}/${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const img = sharp(input, { failOn: "error" }).rotate(); // honour EXIF orientation from phone photos
  await Promise.all(
    IMAGE_SIZES.map(async (w) => {
      const out = await img.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: w >= 1920 ? 78 : 80 }).toBuffer();
      await withRetry(() =>
        bucket()
          .file(imageVariant(base, w))
          .save(out, { contentType: "image/webp", resumable: false, metadata: { cacheControl: "public, max-age=31536000, immutable" } }),
      );
    }),
  );
  return base;
}

/**
 * Downloads an image URL with a timeout and a size cap, through safeFetch (M22): http(s) only, never a private, loopback,
 * link-local or metadata address, checked on every redirect hop. The image ends up public in the bucket, so this guard
 * is what stops a recipe's `image:` line from copying something internal out.
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_IMAGE_BYTES, headers: { "User-Agent": "SolvingFood/1.0 (recipe import)" } }).catch((e: Error) => {
    throw new Error(e instanceof SafeFetchError && e.kind === "tooLarge" ? "image too large" : e.message);
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers["content-type"] ?? "";
  if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) throw new Error(`not an image (${type})`);
  return res.body;
}
