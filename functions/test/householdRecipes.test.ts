// All 28 household recipes (data/recipes/cooklang) through the real drop-folder trigger on the emulators, exactly as
// `pnpm drop:recipes` delivers them: referenced photos first (two have spaces in their names), then the .cook files.
// Every one must import as an active recipe with every ingredient resolved to the seed (no new needsReview
// ingredients), its taxonomy, and its image in three sizes when the note had one.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CUISINES, MAIN_PROTEINS, splitFrontMatter } from "@solving-food/core";
import { RECIPES_DIR, bucket, clearFirestore, db, fileExists, poll, seedIngredients } from "./helpers";

const UID = "household-owner";
const files = readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".cook")).sort();
const meta = files.map((f) => {
  const { frontMatter } = splitFrontMatter(readFileSync(join(RECIPES_DIR, f), "utf8"));
  const image = typeof frontMatter.image === "string" ? frontMatter.image : null;
  return { file: f, title: String(frontMatter.title), image, imagePath: image ? resolve(RECIPES_DIR, image) : null };
});

describe("the 28 household recipes import through the drop folder", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedIngredients();
    const [left] = await bucket().getFiles({ prefix: "recipe-drop/" });
    await Promise.all(left.map((f) => f.delete({ ignoreNotFound: true })));
  });

  it("all import active, resolved, classified, and with their photos", async () => {
    expect(files).toHaveLength(28);
    const ingredientsBefore = (await db.collection("ingredients").count().get()).data().count;
    const prefix = `recipe-drop/${UID}/`;
    for (const m of meta.filter((x) => x.imagePath)) {
      const name = basename(m.imagePath!);
      await bucket().file(prefix + name).save(readFileSync(m.imagePath!), { contentType: /\.png$/i.test(name) ? "image/png" : "image/jpeg", resumable: false });
    }
    for (const m of meta) await bucket().file(prefix + m.file).save(readFileSync(join(RECIPES_DIR, m.file)), { contentType: "text/plain", resumable: false });

    const docs = await poll(
      async () => {
        const snap = await db.collection("recipes").get();
        const withImages = snap.docs.filter((d) => (d.data().imagePaths ?? []).length > 0).length;
        return snap.size === 28 && withImages === meta.filter((m) => m.image).length ? snap.docs : null;
      },
      240_000,
      "28 imports",
    );

    const errors = (await db.collection(`users/${UID}/notifications`).where("kind", "==", "error").get()).docs.map((d) => d.data().message);
    expect(errors).toEqual([]);
    expect((await db.collection("ingredients").count().get()).data().count).toBe(ingredientsBefore); // nothing new to review

    const byTitle = new Map(docs.map((d) => [d.data().title as string, d.data()]));
    for (const m of meta) {
      const r = byTitle.get(m.title);
      expect(r, m.file).toBeTruthy();
      expect(r!.status, m.file).toBe("active");
      expect(CUISINES as readonly string[], m.file).toContain(r!.cuisine);
      expect(MAIN_PROTEINS as readonly string[], m.file).toContain(r!.mainProtein);
      expect(r!.ingredients.length, m.file).toBeGreaterThan(0);
      for (const l of r!.ingredients as Array<{ ingredientId: string; optional: boolean; canonicalAmount: number }>) {
        expect(l.ingredientId, m.file).toBeTruthy();
        if (!l.optional) expect(l.canonicalAmount, `${m.file} ${l.ingredientId}`).toBeGreaterThan(0);
      }
      expect(typeof r!.proteinPerServingG, m.file).toBe("number");
      if (m.image) {
        expect(r!.imagePaths, m.file).toHaveLength(1);
        for (const size of [480, 960, 1920]) expect(await fileExists(`${r!.imagePaths[0]}/${size}.webp`), `${m.file} ${size}`).toBe(true);
      } else {
        expect(r!.imagePaths, m.file).toEqual([]);
      }
    }

    // Same-name tokens are summed (moroccan: coriander 2 tbsp + 0.5 tsp); salt and pepper stay separate lines.
    const moroccan = byTitle.get("Moroccan Spiced Chicken Thighs")!;
    const coriander = moroccan.ingredients.filter((l: { ingredientId: string }) => l.ingredientId === "ground-coriander");
    expect(coriander).toHaveLength(1);
    expect(coriander[0].amount).toBeCloseTo(2.167, 2);
    const shrimp = byTitle.get("Garlic Shrimp With Smoked Paprika")!;
    expect(shrimp.ingredientIds).toEqual(expect.arrayContaining(["salt", "black-pepper"]));

    // Every .cook and photo was consumed.
    await poll(async () => {
      const [rest] = await bucket().getFiles({ prefix });
      return rest.length === 0;
    }, 30_000, "drop folder empty");
  }, 300_000);
});
