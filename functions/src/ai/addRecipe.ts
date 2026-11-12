// Add with Gemini (PRD R4.37; TECHNICAL_SPECS §9 "Add with Gemini", Planning/M16): a web recipe link, or a photo of a
// recipe uploaded to `recipe-photos/{uid}/`, becomes a .cook file written by Gemini following the Claude skill
// (SKILL_TEXT, generated from it), which then goes through the drop-folder importer (`importCook`: validation, the
// M15 ingredient judge, duplicates, the link's image, the notification). Allowlisted callers; the owner's Gemini key;
// 10 per person per hour (`aiRate/{uid}`; one per recipe, however many photos). A file that fails the importer's checks
// goes back to Gemini once with the reason. Up to MAX_RECIPE_PHOTOS photos go together (the pages of a recipe that runs
// over several, and the finished dish), optionally with the recipe's text (copied from a page that won't let the app
// read it, or a book); Gemini says which photo, if any, is the finished dish (`DISH: n`), and that one becomes the
// recipe's picture. A photo of the recipe itself never does. The uploads are deleted afterwards.
import { cleanRecipeText, CooklangError, dishPhotoIndex, dropLocalImage, extractCook, MAX_RECIPE_PHOTOS, notARecipe, pageContent, recipeInstruction, safeRecipeUrl, siteRefusesApps, type RecipeSource } from "@solving-food/core";
import { bucket, db } from "../admin";
import { importCook } from "../dropFolder";
import { CallError, rateLimit } from "../pcx";
import { isEmulator } from "../pcx/client";
import { AI_NOT_SET_UP, AiError, geminiGenerate, geminiReady, type GeminiPart, type GeminiTurn } from "./gemini";
import { SKILL_TEXT } from "./skillText.generated";
import { safeFetch, SafeFetchError } from "../safeFetch";

export const ADD_PER_HOUR = 10;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** All the photos of one recipe together: Gemini takes at most 20 MB per request, and inline data grows by a third as
 * base64. The sheet shrinks each photo to well under this (≤ 2048 px, ~0.3–1 MB). */
const MAX_PHOTOS_BYTES = 14 * 1024 * 1024;
export const MAX_RECIPE_TEXT = 30_000;

type AddInput = { source: "link"; url: string } | { source: "photo"; paths: string[]; text: string };

const isPath = (p: unknown): p is string => typeof p === "string" && p.length >= 1 && p.length <= 300;

function parseInput(data: unknown): AddInput | null {
  const d = (data ?? {}) as { source?: unknown; url?: unknown; path?: unknown; paths?: unknown; text?: unknown };
  if (d.source === "link" && typeof d.url === "string" && d.url.trim().length >= 8 && d.url.length <= 2000) return { source: "link", url: d.url.trim() };
  if (d.source !== "photo" || !(d.text === undefined || (typeof d.text === "string" && d.text.length <= MAX_RECIPE_TEXT * 2))) return null;
  // `path` is the one-photo request from a sheet loaded before multiple photos.
  const paths = d.paths === undefined && isPath(d.path) ? [d.path] : d.paths;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_RECIPE_PHOTOS || !paths.every(isPath) || new Set(paths).size !== paths.length) return null;
  return { source: "photo", paths, text: cleanRecipeText(typeof d.text === "string" ? d.text : "", MAX_RECIPE_TEXT) };
}

const ownPhoto = (uid: string, path: string) => path.startsWith(`recipe-photos/${uid}/`) && !path.includes("..");

export interface AddRecipeResult {
  status: "imported" | "pendingDuplicateReview";
  recipeId: string;
  title: string;
  warnings: string[];
}

/** A page that didn't open; a site that refuses apps gets the way round it. */
function pageError(status: number): CallError {
  return new CallError(
    "invalid-argument",
    siteRefusesApps(status)
      ? `That site doesn't let apps read its recipes (HTTP ${status}). Add a photo instead, with the recipe's text copied from the page.`
      : `Couldn't open that page (HTTP ${status})`,
  );
}

/** A page's HTML. Under the emulator from `_stubLlm/{uid}` (or config) `pages[url]`; "!<status>" fails like HTTP. */
async function fetchPage(uid: string, url: URL): Promise<string> {
  if (isEmulator()) {
    const own = (await db.doc(`_stubLlm/${uid}`).get()).data()?.pages as Record<string, string> | undefined;
    const html = own?.[url.href] ?? ((await db.doc("_stubLlm/config").get()).data()?.pages as Record<string, string> | undefined)?.[url.href];
    if (html === undefined || html.startsWith("!")) throw pageError(Number(html?.slice(1) || 404));
    return html;
  }
  // safeFetch (M22): DNS checked before connecting and on every redirect hop, size and time capped.
  try {
    const res = await safeFetch(url, { timeoutMs: PAGE_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES, headers: { "User-Agent": "Mozilla/5.0 (compatible; SolvingFood/1.0; recipe import)", Accept: "text/html,application/xhtml+xml" } });
    if (!res.ok) throw pageError(res.status);
    const type = res.headers["content-type"] ?? "";
    if (type && !/html|xml|text\/plain/i.test(type)) throw new CallError("invalid-argument", `That link isn't a web page (${type.split(";")[0]})`);
    return res.body.toString("utf8");
  } catch (e) {
    if (e instanceof CallError) throw e;
    if (e instanceof SafeFetchError) {
      if (e.kind === "blocked") throw new CallError("invalid-argument", "That page is (or redirects) somewhere the app can't open");
      if (e.kind === "tooLarge") throw new CallError("invalid-argument", "That page is too large");
      if (e.kind === "timeout") throw new CallError("invalid-argument", "Couldn't open that page (it took too long)");
    }
    throw new CallError("invalid-argument", `Couldn't open that page (${(e as Error).message})`);
  }
}

type Photo = { part: GeminiPart; data: Buffer };

async function readPhoto(path: string): Promise<Photo> {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new CallError("invalid-argument", "The photo didn't arrive; try again");
  const [meta] = await file.getMetadata();
  const mimeType = String(meta.contentType ?? "image/jpeg");
  if (!mimeType.startsWith("image/") || Number(meta.size ?? 0) > MAX_PHOTO_BYTES) throw new CallError("invalid-argument", "That isn't a photo the app can read");
  const [buf] = await file.download();
  return { part: { inlineData: { mimeType, data: buf.toString("base64") } }, data: buf };
}

/** The request's photos in order, each one this person's own, all together small enough for one Gemini request. */
async function readPhotos(uid: string, paths: string[]): Promise<Photo[]> {
  if (!paths.every((p) => ownPhoto(uid, p))) throw new CallError("invalid-argument", "That photo isn't yours");
  const photos = await Promise.all(paths.map(readPhoto));
  if (photos.reduce((n, p) => n + p.data.length, 0) > MAX_PHOTOS_BYTES) throw new CallError("invalid-argument", "Those photos are too large together; add fewer");
  return photos;
}

export async function addRecipeWithGemini(uid: string, data: unknown): Promise<AddRecipeResult> {
  const req = parseInput(data);
  if (!req) throw new CallError("invalid-argument", "Bad request");
  if (!(await geminiReady(uid))) throw new CallError("invalid-argument", AI_NOT_SET_UP);

  let photos: Photo[] = [];
  try {
    let source: RecipeSource;
    let first: GeminiPart[];
    let fileName: string;
    if (req.source === "link") {
      const url = safeRecipeUrl(req.url);
      if (!url) throw new CallError("invalid-argument", "That isn't a web link the app can open (http or https, a public site)");
      await rateLimit(uid, Date.now(), { collection: "aiRate", limit: ADD_PER_HOUR, message: `That's ${ADD_PER_HOUR} recipes with Gemini this hour; try again later` });
      const content = pageContent(url.href, await fetchPage(uid, url));
      if (!content) throw new CallError("invalid-argument", "That page has no recipe the app can read");
      source = { kind: "link", url: url.href };
      first = [{ text: content }];
      fileName = url.hostname;
    } else {
      photos = await readPhotos(uid, req.paths);
      await rateLimit(uid, Date.now(), { collection: "aiRate", limit: ADD_PER_HOUR, message: `That's ${ADD_PER_HOUR} recipes with Gemini this hour; try again later` });
      const n = photos.length;
      source = { kind: "photo", count: n, withText: !!req.text };
      // Each photo labelled with its number, so Gemini's DISH line can name one.
      first = photos.flatMap((p, i): GeminiPart[] => (n > 1 ? [{ text: `Photo ${i + 1}:` }, p.part] : [p.part]));
      first.push({ text: req.text ? `The recipe's text:\n${req.text}` : n > 1 ? "Write the .cook file for the recipe in these photos." : "Write the .cook file for the recipe in this photo." });
      fileName = n > 1 ? "your photos" : "your photo";
    }

    const system = recipeInstruction(SKILL_TEXT, source);
    const contents: GeminiTurn[] = [{ role: "user", parts: first }];
    for (let attempt = 0; ; attempt++) {
      const answer = await geminiGenerate(uid, system, contents);
      if (notARecipe(answer)) throw new CallError("invalid-argument", source.kind === "link" ? "Gemini found no recipe on that page" : photos.length > 1 ? "Gemini found no recipe in those photos" : "Gemini found no recipe in that photo");
      const cook = extractCook(answer);
      try {
        if (!cook) throw new CooklangError("the answer had no .cook file");
        const dishAt = source.kind === "photo" ? dishPhotoIndex(answer, photos.length) : null;
        const dish = dishAt === null ? undefined : photos[dishAt]!.data;
        const out = await importCook(uid, fileName, dropLocalImage(cook), { imageWaitMs: 0, imageData: dish });
        if (out.status !== "imported" && out.status !== "pendingDuplicateReview") throw new CooklangError("it wasn't imported");
        const title = String((await db.doc(`recipes/${out.recipeId}`).get()).data()?.title ?? "");
        return { status: out.status, recipeId: out.recipeId, title, warnings: out.warnings };
      } catch (e) {
        if (!(e instanceof CooklangError)) throw e;
        if (attempt >= 1) throw new CallError("invalid-argument", `Gemini's recipe didn't pass the app's checks: ${e.message}`);
        // Once: tell Gemini what was wrong and ask for the whole file again.
        contents.push({ role: "model", parts: [{ text: answer }] }, { role: "user", parts: [{ text: `The app couldn't import that file: ${e.message}. Fix it and answer with the whole corrected .cook file in one \`\`\`cooklang block.` }] });
      }
    }
  } catch (e) {
    if (e instanceof AiError) throw new CallError("invalid-argument", e.message);
    throw e;
  } finally {
    if (req.source === "photo") await Promise.all(req.paths.filter((p) => ownPhoto(uid, p)).map((p) => bucket().file(p).delete({ ignoreNotFound: true }).catch(() => undefined)));
  }
}
