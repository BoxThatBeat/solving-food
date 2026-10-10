// Recipe images (TECHNICAL_SPECS §2, §9): always stored in our bucket (never hot-linked), as three WebP sizes under
// `recipes/{recipeId}/{imageId}/{480|960|1920}.webp`. Paths are unique per image, so they're cached as immutable.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { IMAGE_SIZES, imageVariant } from "@solving-food/core";
import { bucket } from "./admin";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** Resizes to the three standard widths (never enlarging) and uploads them; returns the image base path. */
export async function storeRecipeImage(recipeId: string, input: Buffer): Promise<string> {
  const base = `recipes/${recipeId}/${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const img = sharp(input, { failOn: "error" }).rotate(); // honour EXIF orientation from phone photos
  await Promise.all(
    IMAGE_SIZES.map(async (w) => {
      const out = await img.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: w >= 1920 ? 78 : 80 }).toBuffer();
      await bucket()
        .file(imageVariant(base, w))
        .save(out, { contentType: "image/webp", resumable: false, metadata: { cacheControl: "public, max-age=31536000, immutable" } });
    }),
  );
  return base;
}

/** Downloads an image URL (http/https only) with a timeout and a size cap. */
export async function downloadImage(url: string): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("not an http(s) URL");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "SolvingFood/1.0 (recipe import)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) throw new Error(`not an image (${type})`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_IMAGE_BYTES) throw new Error("image too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("image too large");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}
