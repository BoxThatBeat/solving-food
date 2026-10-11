// Drop folder pipeline (TECHNICAL_SPECS §9, §14): good file, bad file, duplicate, image download and resize, image
// failure, non-drop path ignored. Uploads go to the Storage emulator, so the deployed-in-emulator trigger runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ATTACHMENTS_DIR, bucket, clearFirestore, db, fileExists, poll, readRecipe, seedIngredients } from "./helpers";
import { handleDropObject, parseDropPath } from "../src/dropFolder";

const UID = "dropper";

async function upload(path: string, data: string | Buffer, contentType: string) {
  await bucket().file(path).save(data, { contentType, resumable: false });
}

async function recipeByTitle(title: string) {
  const snap = await db.collection("recipes").where("title", "==", title).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

async function notifications() {
  const snap = await db.collection(`users/${UID}/notifications`).get();
  return snap.docs.map((d) => d.data());
}

describe("drop folder", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedIngredients();
  });

  it("parses drop paths", () => {
    expect(parseDropPath("recipe-drop/u1/a.cook")).toEqual({ uid: "u1", file: "a.cook" });
    expect(parseDropPath("recipe-drop/u1/sub/a.cook")).toEqual({ uid: "u1", file: "sub/a.cook" });
    expect(parseDropPath("recipes/r1/x/480.webp")).toBeNull();
    expect(parseDropPath("recipe-drop/u1")).toBeNull();
  });

  it("ignores non-drop paths and non-.cook files without touching anything", async () => {
    expect(await handleDropObject("recipes/r1/img/480.webp", 1)).toEqual({ status: "skipped", reason: "not-drop" });
    expect(await handleDropObject(`recipe-drop/${UID}/photo.jpg`, 1)).toEqual({ status: "skipped", reason: "not-cook" });
    expect((await db.collection("dropImports").get()).size).toBe(0);
  });

  it("imports a household recipe with its image (uploaded alongside), resolves every ingredient, deletes the files, notifies", async () => {
    const img = readFileSync(join(ATTACHMENTS_DIR, "Pasted image 20240116181103.png"));
    await upload(`recipe-drop/${UID}/Pasted image 20240116181103.png`, img, "image/png");
    await upload(`recipe-drop/${UID}/cake-mix-brownies.cook`, readRecipe("cake-mix-brownies.cook").replace(/^image: .*$/m, "image: ../obsidian/attachments/Pasted image 20240116181103.png"), "text/plain");
    const [r] = await poll(async () => {
      const list = await recipeByTitle("Cake Mix Brownies");
      return list.length && list[0]!.data.imagePaths?.length ? list : null;
    }, 45_000, "imported recipe");
    expect(r!.data).toMatchObject({ status: "active", version: 1, createdBy: UID, cuisine: "american" });
    expect(r!.data.proteinApproximate).toBe(false);
    const base = r!.data.imagePaths[0] as string;
    for (const size of [480, 960, 1920]) expect(await fileExists(`${base}/${size}.webp`)).toBe(true);
    // Its v1 snapshot exists in the editor's shape, so the first edit (v2) can be undone (M7 review item 2, R4.19).
    const v1 = (await db.doc(`recipes/${r!.id}/versions/1`).get()).data();
    expect(v1).toMatchObject({ title: "Cake Mix Brownies", version: 1, status: "active", editedBy: UID, imagePaths: r!.data.imagePaths, ingredients: r!.data.ingredients, steps: r!.data.steps });
    expect(v1!.editedAt).toBeTruthy();
    await poll(async () => !(await fileExists(`recipe-drop/${UID}/cake-mix-brownies.cook`)), 10_000, ".cook deleted");
    expect(await fileExists(`recipe-drop/${UID}/Pasted image 20240116181103.png`)).toBe(false);
    const n = await poll(async () => (await notifications()).find((x) => String(x.message).includes("Cake Mix Brownies")), 10_000, "notification");
    expect(n).toMatchObject({ kind: "success", link: `/recipes/${r!.id}`, dismissedAt: null });
    // Indexed, so search finds it.
    await poll(async () => (await db.doc("recipeIndex/0").get()).data()?.recipes?.[r!.id], 20_000, "index");
  });

  it("a bad file gets an error notification naming the file and the reason, and is deleted", async () => {
    await upload(`recipe-drop/${UID}/broken.cook`, "---\ntitle: Broken\nservings: 2\n---\nStir @salt{}.", "text/plain");
    const n = await poll(async () => (await notifications()).find((x) => String(x.message).startsWith("broken.cook")), 30_000, "error notification");
    expect(n.kind).toBe("error");
    expect(n.message).toMatch(/missing cuisine/);
    await poll(async () => !(await fileExists(`recipe-drop/${UID}/broken.cook`)), 10_000, "deleted");
    expect(await recipeByTitle("Broken")).toEqual([]);
  });

  it("a duplicate waits for review", async () => {
    await upload(`recipe-drop/${UID}/brownies-again.cook`, readRecipe("cake-mix-brownies.cook").replace(/^image: .*$/m, ""), "text/plain");
    const list = await poll(async () => {
      const l = await recipeByTitle("Cake Mix Brownies");
      return l.length === 2 ? l : null;
    }, 30_000, "second import");
    const pending = list.find((x) => x.data.status === "pendingDuplicateReview")!;
    const original = list.find((x) => x.data.status === "active")!;
    expect(pending.data.possibleDuplicateOf).toBe(original.id);
    expect((await db.doc(`recipes/${pending.id}/versions/1`).get()).data()).toMatchObject({ version: 1, status: "pendingDuplicateReview", editedBy: UID });
    const n = await poll(async () => (await notifications()).find((x) => String(x.message).includes("looks like a duplicate")), 10_000, "dupe notification");
    expect(n).toMatchObject({ kind: "info", link: "/recipes?review=1" });
    expect((await db.doc("recipeIndex/0").get()).data()?.recipes?.[pending.id]).toBeUndefined();
  });

  it("an image that can't be downloaded still imports the recipe and says so", async () => {
    const src = readRecipe("tzatziki-sauce.cook").replace(/^image: .*$/m, "").replace(/^title: .*$/m, "title: Tzatziki Without Image\nimage: http://127.0.0.1:9/nope.jpg");
    await upload(`recipe-drop/${UID}/tzatziki.cook`, src, "text/plain");
    const [r] = await poll(async () => {
      const l = await recipeByTitle("Tzatziki Without Image");
      return l.length ? l : null;
    }, 45_000, "import without image");
    expect(r!.data.imagePaths).toEqual([]);
    const n = await poll(async () => (await notifications()).find((x) => String(x.message).includes("Tzatziki Without Image")), 10_000, "notification");
    expect(n.message).toMatch(/image couldn't be saved/);
  });

  it("unknown ingredients are created flagged needsReview", async () => {
    const src = `---\ntitle: Rambutan Bowl\nservings: 1\ncuisine: other\nmain_protein: none\nprep_time: 5 minutes\ncook_time: 0 minutes\ntags: [snack]\n---\nSlice @rambutan{6} and add @greek yogurt{0.5%cup}.`;
    await upload(`recipe-drop/${UID}/rambutan.cook`, src, "text/plain");
    const [r] = await poll(async () => {
      const l = await recipeByTitle("Rambutan Bowl");
      return l.length ? l : null;
    }, 30_000, "import");
    expect(r!.data.ingredientIds).toEqual(["greek-yogurt", "rambutan"]);
    expect((await db.doc("ingredients/rambutan").get()).data()).toMatchObject({ needsReview: true, createdBy: UID, category: "pantry" });
    expect(r!.data.proteinApproximate).toBe(true);
  });
});
