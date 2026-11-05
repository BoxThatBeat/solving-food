// The drop folder (TECHNICAL_SPECS §9 "Drop folder", PRD R4.16): a `.cook` file uploaded to
// `recipe-drop/{uid}/…` is parsed, validated, its ingredients resolved (unknown ones created with needsReview), its
// image stored in three sizes, checked for duplicates, and saved as a recipe (`active`, or `pendingDuplicateReview`).
// The file is deleted either way and the uploader gets a notification.
//
// Images: `image:` in the front matter is either an http(s) URL (downloaded) or a path relative to the .cook file, in
// which case the image must be uploaded to the same drop folder (any sub-folder); it's matched by file name, waited
// for briefly (uploads run in parallel), and deleted after use. Anything else in the folder is ignored here and
// swept by the weekly maintenance after a day.
//
// Storage triggers fire for every object in the bucket (recipe images included), so this returns immediately for
// anything that isn't a `.cook` file under `recipe-drop/` (counted in the §2 quota table).
import { FieldValue } from "firebase-admin/firestore";
import {
  buildIngredientIndex,
  cooklangToRecipe,
  CooklangError,
  deriveRecipe,
  findDuplicates,
  judgeItems,
  normalizeName,
  resolveIngredientName,
  type IngredientDoc,
  type IngredientIndex,
} from "@solving-food/core";
import { bucket, db } from "./admin";
import { judgeWithGemini } from "./ai/gemini";
import { downloadImage, storeRecipeImage } from "./images";
import { notify } from "./notify";
import { loadIndex } from "./recipeIndex";
import { lookupOf } from "./recipes";

export const DROP_PREFIX = "recipe-drop/";

export type DropOutcome =
  | { status: "skipped"; reason: "not-drop" | "not-cook" | "duplicate-event" | "gone" }
  | { status: "imported" | "pendingDuplicateReview"; recipeId: string; warnings: string[] }
  | { status: "error"; error: string };

/** Splits `recipe-drop/{uid}/{file}`; null when the path isn't a drop-folder file. */
export function parseDropPath(name: string): { uid: string; file: string } | null {
  if (!name.startsWith(DROP_PREFIX)) return null;
  const parts = name.split("/");
  if (parts.length < 3 || !parts[1] || !parts.at(-1)) return null;
  return { uid: parts[1], file: parts.slice(2).join("/") };
}

// Ingredients are cached per instance for a few minutes: a batch of drops reuses one load (Firestore reads, §2).
let cache: { at: number; byId: Map<string, IngredientDoc>; index: IngredientIndex } | null = null;
const CACHE_MS = 5 * 60_000;

export async function ingredientData(): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const snap = await db.collection("ingredients").get();
  const byId = new Map(snap.docs.map((d) => [d.id, d.data() as IngredientDoc]));
  cache = {
    at: Date.now(),
    byId,
    index: buildIngredientIndex(
      [...byId].map(([id, d]) => ({ id, name: d.name, aliases: d.aliases ?? [], mergedInto: d.mergedInto ?? null, needsReview: d.needsReview, category: d.category })),
    ),
  };
  return cache;
}

/** For tests: forget cached ingredients. */
export function resetIngredientCache(): void {
  cache = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Finds an uploaded image next to the .cook file by its file name, waiting up to `waitMs` for it to arrive. */
async function findDroppedImage(uid: string, relPath: string, waitMs: number): Promise<{ name: string; data: Buffer } | null> {
  let name: string;
  try {
    name = decodeURIComponent(relPath.split(/[\\/]/).pop() ?? "");
  } catch {
    name = relPath.split(/[\\/]/).pop() ?? "";
  }
  if (!name) return null;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const [files] = await bucket().getFiles({ prefix: `${DROP_PREFIX}${uid}/` });
    const hit = files.find((f) => f.name.split("/").pop() === name);
    if (hit) {
      const [data] = await hit.download();
      return { name: hit.name, data };
    }
    if (Date.now() >= deadline) return null;
    await sleep(1500);
  }
}

export interface DropOptions {
  /** How long to wait for a referenced image to be uploaded. */
  imageWaitMs?: number;
  /** A picture to use as the recipe's image instead of the file's `image:` (Add with Gemini's dish photo, R4.37). */
  imageData?: Buffer;
}

export async function handleDropObject(objectName: string, generation: string | number | undefined, opts: DropOptions = {}): Promise<DropOutcome> {
  const parsed = parseDropPath(objectName);
  if (!parsed) return { status: "skipped", reason: "not-drop" };
  if (!/\.cook$/i.test(parsed.file)) return { status: "skipped", reason: "not-cook" };
  const { uid, file } = parsed;
  const fileName = file.split("/").pop()!;

  // Storage events can be delivered more than once: one import per object generation.
  const lock = db.collection("dropImports").doc(`${uid}_${String(generation ?? Date.now())}`);
  try {
    await lock.create({ uid, file: objectName, status: "processing", startedAt: FieldValue.serverTimestamp() });
  } catch {
    return { status: "skipped", reason: "duplicate-event" };
  }

  const obj = bucket().file(objectName);
  const [exists] = await obj.exists();
  if (!exists) {
    await lock.update({ status: "gone" });
    return { status: "skipped", reason: "gone" };
  }

  let outcome: DropOutcome;
  try {
    const [buf] = await obj.download();
    outcome = await importCook(uid, fileName, buf.toString("utf8"), opts);
  } catch (e) {
    const reason = e instanceof CooklangError ? e.message : `couldn't be imported (${(e as Error).message})`;
    outcome = { status: "error", error: reason };
    await notify(uid, { kind: "error", message: `${fileName}: ${reason}`, link: "/drop" });
  }
  await obj.delete({ ignoreNotFound: true });
  await lock.update({
    status: outcome.status,
    finishedAt: FieldValue.serverTimestamp(),
    ...(outcome.status === "error" ? { error: outcome.error } : {}),
    ...("recipeId" in outcome ? { recipeId: outcome.recipeId } : {}),
  });
  return outcome;
}

/**
 * Gemini's verdict on each wording the matcher couldn't place (M15, R4.27): normalised wording → the ingredient it means
 * ("same"), or "new" / "unsure". No key, or Gemini failing, leaves them all unsure and says why.
 */
async function judgeUnknown(unknown: readonly string[], ing: NonNullable<typeof cache>, warnings: string[]): Promise<Map<string, string>> {
  const verdicts = new Map<string, string>();
  if (!unknown.length) return verdicts;
  const items = judgeItems(
    unknown.map((name) => ({ name })),
    ing.index,
    (id) => ing.byId.get(id),
  );
  try {
    const v = await judgeWithGemini(items);
    for (const it of items) {
      const x = v.get(it.name) ?? { verdict: "unsure" as const };
      verdicts.set(normalizeName(it.name), x.verdict === "same" ? `same:${x.id}` : x.verdict);
    }
  } catch (e) {
    warnings.push(`names not checked (${(e as Error).message})`);
  }
  return verdicts;
}

/**
 * Parses a .cook file into recipe content (M1 pipeline). Wordings the matcher can't place go to the LLM judge first
 * (M15): one it says is an existing ingredient uses that ingredient and becomes one of its names; the rest are created,
 * marked "new" or "unsure" (`nameCheck`).
 */
export async function prepareCookRecipe(uid: string, text: string) {
  const ing = await ingredientData();
  const unknown = new Map<string, string>();
  cooklangToRecipe(text, {
    resolve: (n) => {
      const id = resolveIngredientName(n, ing.index);
      if (!id && normalizeName(n)) unknown.set(normalizeName(n), n);
      return id;
    },
  });
  const warnings: string[] = [];
  const judged = await judgeUnknown([...unknown.values()], ing, warnings);
  const sameAs = (n: string) => judged.get(normalizeName(n))?.replace(/^same:/, "");
  const learned = new Map<string, string[]>();
  const result = cooklangToRecipe(text, {
    resolve: (n) => {
      const id = resolveIngredientName(n, ing.index);
      if (id) return id;
      const v = judged.get(normalizeName(n));
      if (!v?.startsWith("same:")) return null;
      const into = sameAs(n)!;
      learned.set(into, [...(learned.get(into) ?? []), n.trim().toLowerCase()]);
      return into;
    },
  });
  warnings.unshift(...result.warnings);

  // Wordings Gemini placed become names of the ingredient they mean, so the next import matches them directly.
  for (const [id, words] of learned) {
    const d = ing.byId.get(id);
    if (!d) continue;
    const add = [...new Set(words)].filter((w) => w !== d.name.toLowerCase() && !(d.aliases ?? []).includes(w));
    if (add.length && (d.aliases ?? []).length + add.length <= 40) await db.doc(`ingredients/${id}`).update({ aliases: FieldValue.arrayUnion(...add) });
  }
  if (learned.size) warnings.push(`matched by Gemini: ${[...learned].map(([id, w]) => `${[...new Set(w)].join(", ")} → ${ing.byId.get(id)?.name ?? id}`).join("; ")}`);

  // Unknown ingredients: create them unless someone created them meanwhile, with what Gemini made of the name.
  const lookupMap = new Map(ing.byId);
  for (const n of result.newIngredients) {
    const ref = db.collection("ingredients").doc(n.id);
    const snap = await ref.get();
    if (snap.exists) {
      lookupMap.set(n.id, snap.data() as IngredientDoc);
      continue;
    }
    const wording = n.doc.aliases[0] ?? n.doc.name;
    const nameCheck = judged.get(normalizeName(wording)) === "new" || judged.get(normalizeName(n.doc.name)) === "new" ? "new" : "unsure";
    const doc = { ...n.doc, nameCheck, createdBy: uid, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() };
    await ref.set(doc);
    lookupMap.set(n.id, { ...n.doc, nameCheck });
  }
  if (learned.size || result.newIngredients.length) cache = null; // the next import sees them
  if (result.newIngredients.length) {
    const made = result.newIngredients.map((n) => lookupMap.get(n.id)!);
    const sure = made.filter((d) => d.nameCheck === "new").map((d) => d.name);
    const unsure = made.filter((d) => d.nameCheck !== "new").map((d) => d.name);
    if (sure.length) warnings.push(`new ingredient${sure.length > 1 ? "s" : ""}: ${sure.join(", ")}`);
    if (unsure.length) warnings.push(`not sure whether ${unsure.join(", ")} ${unsure.length > 1 ? "are ingredients" : "is an ingredient"} you already have (Ingredients page)`);
  }

  const content = result.content;
  const derived = deriveRecipe(content, lookupOf(lookupMap));
  return { content, derived, warnings, frontMatter: result.frontMatter, newIngredients: result.newIngredients.length };
}

/**
 * Recreates a recipe from an export's .cook file under its original ID (household import, §13): active, version 1,
 * no duplicate review (the export says this household used it) and no image (the export carries none).
 */
export async function createRecipeFromCook(uid: string, id: string, text: string): Promise<{ title: string; warnings: string[] }> {
  const { content, derived, warnings } = await prepareCookRecipe(uid, text);
  content.imagePaths = [];
  const recipe: Record<string, unknown> = {
    ...content,
    ...derived,
    status: "active",
    createdBy: uid,
    updatedBy: uid,
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  const ref = db.collection("recipes").doc(id);
  batch.set(ref, recipe);
  batch.set(ref.collection("versions").doc("1"), { ...recipe, editedBy: uid, editedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { title: content.title, warnings };
}

export async function importCook(uid: string, fileName: string, text: string, opts: DropOptions): Promise<DropOutcome> {
  const prepared = await prepareCookRecipe(uid, text);
  const { content, derived } = prepared;
  const warnings = prepared.warnings;
  const id = db.collection("recipes").doc().id;

  // Image: URL → download; relative path → a file uploaded next to the .cook.
  const image = prepared.frontMatter.image;
  if (opts.imageData) {
    try {
      content.imagePaths = [await storeRecipeImage(id, opts.imageData)];
    } catch (e) {
      warnings.push(`the photo couldn't be saved as its picture (${(e as Error).message})`);
    }
  } else if (image) {
    try {
      let data: Buffer | null = null;
      let dropped: string | null = null;
      if (/^https?:\/\//i.test(image)) {
        data = await downloadImage(image);
      } else {
        const found = await findDroppedImage(uid, image, opts.imageWaitMs ?? 30_000);
        if (found) {
          data = found.data;
          dropped = found.name;
        }
      }
      if (!data) throw new Error(`${image.split(/[\\/]/).pop()} wasn't uploaded with the recipe`);
      content.imagePaths = [await storeRecipeImage(id, data)];
      if (dropped) await bucket().file(dropped).delete({ ignoreNotFound: true });
    } catch (e) {
      warnings.push(`image couldn't be saved (${(e as Error).message})`);
    }
  }

  const matches = findDuplicates(
    { title: content.title, ingredientIds: derived.ingredientIds, sourceUrlCanonical: derived.sourceUrlCanonical ?? null, fingerprint: derived.fingerprint },
    await loadIndex(),
  );
  const duplicate = matches[0];
  const status = duplicate ? "pendingDuplicateReview" : "active";

  const recipe: Record<string, unknown> = {
    ...content,
    ...derived,
    status,
    createdBy: uid,
    updatedBy: uid,
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (duplicate) recipe.possibleDuplicateOf = duplicate.id;
  const batch = db.batch();
  const ref = db.collection("recipes").doc(id);
  batch.set(ref, recipe);
  batch.set(ref.collection("versions").doc("1"), { ...recipe, editedBy: uid, editedAt: FieldValue.serverTimestamp() });
  await batch.commit();

  const extra = warnings.length ? ` Note: ${warnings.join("; ")}.` : "";
  if (duplicate) {
    await notify(uid, {
      kind: "info",
      message: `"${content.title}" looks like a duplicate of "${duplicate.title}". It's waiting for review on the Recipes page.${extra}`,
      link: "/recipes?review=1",
    });
  } else {
    await notify(uid, { kind: "success", message: `Imported "${content.title}" from ${fileName}.${extra}`, link: `/recipes/${id}` });
  }
  return { status: duplicate ? "pendingDuplicateReview" : "imported", recipeId: id, warnings };
}
