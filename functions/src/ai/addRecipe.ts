// Add with Gemini (PRD R4.37; TECHNICAL_SPECS §9 "Add with Gemini", Planning/M16): a web recipe link, or a photo of a
// recipe uploaded to `recipe-photos/{uid}/`, becomes a .cook file written by Gemini following the Claude skill
// (SKILL_TEXT, generated from it), which then goes through the drop-folder importer (`importCook`: validation, the
// M15 ingredient judge, duplicates, the link's image, the notification). Allowlisted callers; the owner's Gemini key;
// 10 per person per hour (`aiRate/{uid}`). A file that fails the importer's checks goes back to Gemini once with the
// reason. The photo is never the recipe's image (it's a page of a book) and is deleted afterwards.
import { CooklangError, dropLocalImage, extractCook, notARecipe, pageContent, recipeInstruction, safeRecipeUrl, type RecipeSource } from "@solving-food/core";
import { bucket, db } from "../admin";
import { importCook } from "../dropFolder";
import { CallError, rateLimit } from "../pcx";
import { isEmulator } from "../pcx/client";
import { AI_NOT_SET_UP, AiError, geminiGenerate, geminiReady, type GeminiPart, type GeminiTurn } from "./gemini";
import { SKILL_TEXT } from "./skillText.generated";

export const ADD_PER_HOUR = 10;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type AddInput = { source: "link"; url: string } | { source: "photo"; path: string };

function parseInput(data: unknown): AddInput | null {
  const d = (data ?? {}) as { source?: unknown; url?: unknown; path?: unknown };
  if (d.source === "link" && typeof d.url === "string" && d.url.trim().length >= 8 && d.url.length <= 2000) return { source: "link", url: d.url.trim() };
  if (d.source === "photo" && typeof d.path === "string" && d.path.length >= 1 && d.path.length <= 300) return { source: "photo", path: d.path };
  return null;
}

export interface AddRecipeResult {
  status: "imported" | "pendingDuplicateReview";
  recipeId: string;
  title: string;
  warnings: string[];
}

/** A page's HTML. Under the emulator from `_stubLlm/{uid}` (or config) `pages[url]`; "!<status>" fails like HTTP. */
async function fetchPage(uid: string, url: URL): Promise<string> {
  if (isEmulator()) {
    const own = (await db.doc(`_stubLlm/${uid}`).get()).data()?.pages as Record<string, string> | undefined;
    const html = own?.[url.href] ?? ((await db.doc("_stubLlm/config").get()).data()?.pages as Record<string, string> | undefined)?.[url.href];
    if (html === undefined || html.startsWith("!")) throw new CallError("invalid-argument", `Couldn't open that page (HTTP ${html?.slice(1) || 404})`);
    return html;
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; SolvingFood/1.0; recipe import)", Accept: "text/html,application/xhtml+xml" } });
    if (!res.ok) throw new CallError("invalid-argument", `Couldn't open that page (HTTP ${res.status})`);
    if (!safeRecipeUrl(res.url || url.href)) throw new CallError("invalid-argument", "That page redirects somewhere the app can't open");
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml|text\/plain/i.test(type)) throw new CallError("invalid-argument", `That link isn't a web page (${type.split(";")[0]})`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) throw new CallError("invalid-argument", "That page is too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PAGE_BYTES) throw new CallError("invalid-argument", "That page is too large");
    return buf.toString("utf8");
  } catch (e) {
    if (e instanceof CallError) throw e;
    throw new CallError("invalid-argument", `Couldn't open that page (${(e as Error).name === "AbortError" ? "it took too long" : (e as Error).message})`);
  } finally {
    clearTimeout(t);
  }
}

async function readPhoto(uid: string, path: string): Promise<{ part: GeminiPart; file: ReturnType<ReturnType<typeof bucket>["file"]> }> {
  if (!path.startsWith(`recipe-photos/${uid}/`) || path.includes("..")) throw new CallError("invalid-argument", "That photo isn't yours");
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new CallError("invalid-argument", "The photo didn't arrive; try again");
  const [meta] = await file.getMetadata();
  const mimeType = String(meta.contentType ?? "image/jpeg");
  if (!mimeType.startsWith("image/") || Number(meta.size ?? 0) > MAX_PHOTO_BYTES) throw new CallError("invalid-argument", "That isn't a photo the app can read");
  const [buf] = await file.download();
  return { part: { inlineData: { mimeType, data: buf.toString("base64") } }, file };
}

export async function addRecipeWithGemini(uid: string, data: unknown): Promise<AddRecipeResult> {
  const req = parseInput(data);
  if (!req) throw new CallError("invalid-argument", "Bad request");
  if (!(await geminiReady(uid))) throw new CallError("invalid-argument", AI_NOT_SET_UP);

  let photo: Awaited<ReturnType<typeof readPhoto>> | null = null;
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
      photo = await readPhoto(uid, req.path);
      await rateLimit(uid, Date.now(), { collection: "aiRate", limit: ADD_PER_HOUR, message: `That's ${ADD_PER_HOUR} recipes with Gemini this hour; try again later` });
      source = { kind: "photo" };
      first = [photo.part, { text: "Write the .cook file for the recipe in this photo." }];
      fileName = "your photo";
    }

    const system = recipeInstruction(SKILL_TEXT, source);
    const contents: GeminiTurn[] = [{ role: "user", parts: first }];
    for (let attempt = 0; ; attempt++) {
      const answer = await geminiGenerate(uid, system, contents);
      if (notARecipe(answer)) throw new CallError("invalid-argument", source.kind === "link" ? "Gemini found no recipe on that page" : "Gemini found no recipe in that photo");
      const cook = extractCook(answer);
      try {
        if (!cook) throw new CooklangError("the answer had no .cook file");
        const out = await importCook(uid, fileName, dropLocalImage(cook), { imageWaitMs: 0 });
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
    await photo?.file.delete({ ignoreNotFound: true }).catch(() => undefined);
    if (!photo && req.source === "photo" && req.path.startsWith(`recipe-photos/${uid}/`) && !req.path.includes("..")) await bucket().file(req.path).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}
