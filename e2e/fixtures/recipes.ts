// Recipe seed and helpers (TECHNICAL_SPECS §14.1 "Seed data"; Planning/M1 "Test data already exists").
//
// The library is global, and specs run in parallel against one Emulator Suite, so:
// - The 28 household recipes (data/recipes/cooklang) are loaded once per run by global-setup, through the real drop
//   folder (Storage → dropFolder function), as the uploader `e2e-seed`. Specs only read them.
// - A spec that edits, trashes, or dedupes a recipe makes its own with `makeRecipe()` and a unique title.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  buildIngredientIndex,
  cooklangToRecipe,
  deriveRecipe,
  lookupFrom,
  resolveIngredientName,
  type IngredientDoc,
  type RecipeContent,
  type RecipeIngredientInfo,
} from "../../packages/core/src/index";
import { loadIngredients } from "../../data/scripts/ingredients";
import { dropAndWait, dropItems } from "../../scripts/lib/drop";
import { adminDb } from "./admin";

export const SEED_UID = "e2e-seed";
export const BUCKET = "solvingfood.firebasestorage.app";
export const RECIPES_DIR = fileURLToPath(new URL("../../data/recipes/cooklang/", import.meta.url));
export const ATTACHMENTS_DIR = fileURLToPath(new URL("../../data/recipes/obsidian/attachments/", import.meta.url));
export const SEED_FILES = readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".cook")).sort();

export const bucket = () => getStorage().bucket(BUCKET);

/** Ingredients (paced, see data/scripts/upload.ts) and the 28 recipes via the drop folder. Idempotent. */
export async function seedLibrary(log: (m: string) => void = () => {}): Promise<void> {
  const have = await adminDb.collection("recipes").where("createdBy", "==", SEED_UID).count().get();
  if (have.data().count >= SEED_FILES.length) return;

  const { items } = loadIngredients();
  const existing = await adminDb.collection("ingredients").count().get();
  if (existing.data().count < items.length) {
    for (let i = 0; i < items.length; i += 4) {
      const b = adminDb.batch();
      for (const { id, ...doc } of items.slice(i, i + 4)) b.set(adminDb.doc(`ingredients/${id}`), doc);
      await b.commit();
      await new Promise((r) => setTimeout(r, 120));
    }
    log(`seeded ${items.length} ingredients`);
  }

  const prefix = `recipe-drop/${SEED_UID}/`;
  const b = bucket();
  await dropAndWait(
    dropItems(RECIPES_DIR, SEED_FILES),
    {
      put: async (path, name, contentType) => void (await b.file(prefix + name).save(readFileSync(path), { contentType, resumable: false })),
      list: async () => (await b.getFiles({ prefix }))[0].map((f) => f.name.slice(prefix.length)),
    },
    { concurrency: 3, staleMs: 60_000, log },
  );
  // The index function runs after each recipe write; wait until every seed recipe is searchable.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const chunks = await adminDb.collection("recipeIndex").get();
    const n = chunks.docs.reduce((s, d) => s + Object.values((d.data().recipes ?? {}) as Record<string, { id: string }>).length, 0);
    if (n >= SEED_FILES.length) break;
    if (Date.now() > deadline) throw new Error(`Only ${n} recipes indexed`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The seeded recipe with this title (from data/recipes). */
export async function seedRecipeId(title: string): Promise<string> {
  const snap = await adminDb.collection("recipes").where("title", "==", title).where("createdBy", "==", SEED_UID).get();
  if (snap.empty) throw new Error(`No seed recipe "${title}"`);
  return snap.docs[0]!.id;
}

let ingredientCache: Map<string, IngredientDoc> | null = null;
async function ingredientMap(): Promise<Map<string, IngredientDoc>> {
  if (!ingredientCache) {
    const snap = await adminDb.collection("ingredients").get();
    ingredientCache = new Map(snap.docs.map((d) => [d.id, d.data() as IngredientDoc]));
  }
  return ingredientCache;
}

/** Recipe content from Cooklang text, with overrides (no image, no source URL unless given). */
export async function contentFromCook(text: string, overrides: Partial<RecipeContent> = {}): Promise<RecipeContent> {
  const map = await ingredientMap();
  const index = buildIngredientIndex([...map].map(([id, d]) => ({ id, name: d.name, aliases: d.aliases ?? [] })));
  const r = cooklangToRecipe(text, { resolve: (n) => resolveIngredientName(n, index) });
  const { sourceUrl: _drop, ...content } = r.content;
  return { ...content, imagePaths: [], ...overrides };
}

/** Recipe content from one of the household .cook files (see contentFromCook). */
export function contentFrom(file: string, overrides: Partial<RecipeContent> = {}): Promise<RecipeContent> {
  return contentFromCook(readFileSync(join(RECIPES_DIR, file), "utf8"), overrides);
}

/**
 * A household .cook with front-matter overrides (null removes a key), no source URL, and an extra step with a
 * randomly sized ingredient. Imports are deduplicated against the whole library by title, source URL, and a
 * fingerprint of amounts per serving, and specs run in several projects at once: this makes each copy distinct.
 */
export function uniqueCook(file: string, set: Record<string, string | null>): string {
  let src = readFileSync(join(RECIPES_DIR, file), "utf8");
  for (const [k, v] of Object.entries({ source: null, ...set })) {
    const re = new RegExp(`^${k}:.*\n`, "m");
    if (v === null) src = src.replace(re, "");
    else if (re.test(src)) src = src.replace(re, `${k}: ${v}\n`);
    else src = src.replace(/^---\n/, `---\n${k}: ${v}\n`);
  }
  const ml = 1000 + 100 * Math.floor(Math.random() * 400);
  return `${src.trimEnd()}\n\nRinse everything with @water{${ml}%ml}.\n`;
}

/**
 * A recipe of the spec's own (Admin SDK, as a client save would write it: version 1 plus its versions/1 snapshot).
 * Defaults to cuisine "other" so it doesn't change what the browse specs' cuisine filters show.
 */
export async function makeRecipe(
  title: string,
  opts: { from?: string; cook?: string; content?: Partial<RecipeContent>; status?: "active" | "trashed" | "pendingDuplicateReview"; extra?: Record<string, unknown>; uid?: string } = {},
): Promise<string> {
  const base = { cuisine: "other" as const, ...opts.content, title };
  const content = opts.cook ? await contentFromCook(opts.cook, base) : await contentFrom(opts.from ?? "tzatziki-sauce.cook", base);
  const lookup = lookupFrom((await ingredientMap()) as Map<string, RecipeIngredientInfo>);
  const derived = deriveRecipe(content, lookup);
  const ref = adminDb.collection("recipes").doc();
  const uid = opts.uid ?? "e2e-author";
  const doc: Record<string, unknown> = {
    ...content,
    ...derived,
    status: opts.status ?? "active",
    createdBy: uid,
    updatedBy: uid,
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...opts.extra,
  };
  const clean = stripUndefined(doc);
  const batch = adminDb.batch();
  batch.set(ref, clean);
  batch.set(ref.collection("versions").doc("1"), { ...clean, editedBy: uid, editedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return ref.id;
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && v.constructor === Object) {
      return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(o) as Record<string, unknown>;
}

/** Waits until the index function has (or hasn't) got this recipe. */
export async function waitForIndexed(id: string, present = true, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const chunks = await adminDb.collection("recipeIndex").get();
    const has = chunks.docs.some((d) => !!(d.data().recipes ?? {})[id]);
    if (has === present) return;
    if (Date.now() > deadline) throw new Error(`recipe ${id} ${present ? "never indexed" : "still indexed"}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export function uniqueTitle(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
