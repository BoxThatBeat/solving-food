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
  resolveIngredientName,
  type IngredientDoc,
  type IngredientIndex,
} from "@solving-food/core";
import { bucket, db } from "./admin";
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

async function ingredientData(): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const snap = await db.collection("ingredients").get();
  const byId = new Map(snap.docs.map((d) => [d.id, d.data() as IngredientDoc]));
  cache = { at: Date.now(), byId, index: buildIngredientIndex([...byId].map(([id, d]) => ({ id, name: d.name, aliases: d.aliases ?? [] }))) };
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

/** Parses a .cook file into recipe content: unknown ingredients are created (needsReview) on the way (M1 pipeline). */
export async function prepareCookRecipe(uid: string, text: string) {
  const ing = await ingredientData();
  const result = cooklangToRecipe(text, { resolve: (n) => resolveIngredientName(n, ing.index) });
  const warnings = [...result.warnings];

  // Unknown ingredients: create them (needsReview) unless someone created them meanwhile.
  const lookupMap = new Map(ing.byId);
  for (const n of result.newIngredients) {
    const ref = db.collection("ingredients").doc(n.id);
    const snap = await ref.get();
    if (snap.exists) {
      lookupMap.set(n.id, snap.data() as IngredientDoc);
      continue;
    }
    const doc = { ...n.doc, createdBy: uid, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() };
    await ref.set(doc);
    lookupMap.set(n.id, n.doc);
  }
  if (result.newIngredients.length) {
    cache = null; // the next import sees them
    warnings.push(`${result.newIngredients.length} new ingredient${result.newIngredients.length > 1 ? "s" : ""} to review: ${result.newIngredients.map((n) => n.doc.name).join(", ")}`);
  }

  const content = result.content;
  const derived = deriveRecipe(content, lookupOf(lookupMap));
  return { content, derived, warnings, frontMatter: result.frontMatter };
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

async function importCook(uid: string, fileName: string, text: string, opts: DropOptions): Promise<DropOutcome> {
  const prepared = await prepareCookRecipe(uid, text);
  const { content, derived } = prepared;
  const warnings = prepared.warnings;
  const id = db.collection("recipes").doc().id;

  // Image: URL → download; relative path → a file uploaded next to the .cook.
  const image = prepared.frontMatter.image;
  if (image) {
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
