// Shared helpers for the emulator tests.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { db, bucket } from "../src/admin";
import { loadIngredients } from "../../data/scripts/ingredients";

export const RECIPES_DIR = fileURLToPath(new URL("../../data/recipes/cooklang/", import.meta.url));
export const ATTACHMENTS_DIR = fileURLToPath(new URL("../../data/recipes/obsidian/attachments/", import.meta.url));
export const readRecipe = (f: string) => readFileSync(join(RECIPES_DIR, f), "utf8");

export async function poll<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000, label = "condition"): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

let seeded = false;
/** The ingredient seed, once per run (Admin SDK). */
export async function seedIngredients(): Promise<void> {
  if (seeded) return;
  const { items } = loadIngredients();
  for (let i = 0; i < items.length; i += 400) {
    const b = db.batch();
    for (const { id, ...doc } of items.slice(i, i + 400)) b.set(db.collection("ingredients").doc(id), doc);
    await b.commit();
  }
  seeded = true;
}

export async function clearFirestore(): Promise<void> {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/solvingfood/databases/(default)/documents`, { method: "DELETE" });
  seeded = false;
}

export async function fileExists(path: string): Promise<boolean> {
  const [e] = await bucket().file(path).exists();
  return e;
}

export { db, bucket };
