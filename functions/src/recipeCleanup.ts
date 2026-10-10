// Cleanup after a recipe document is deleted (TECHNICAL_SPECS §4.4): the 30-day Trash purge, and an import discarded
// with "Keep existing" in duplicate review. Deletes its versions and images; removes it from saved meals (deleting
// meals left empty) and, in every household, from planned plan items (deleting items left empty), favourites, notes,
// and stats. Cook events, ratings, and history keep their stored titles. The index entry is removed by the index
// function. Idempotent: every step tolerates having run before.
import { db, bucket } from "./admin";

interface RecipeRef {
  recipeId: string;
  servingsMultiplier?: number;
}

export interface CleanupReport {
  versions: number;
  images: number;
  mealsUpdated: number;
  mealsDeleted: number;
  planItemsUpdated: number;
  planItemsDeleted: number;
  householdDocsDeleted: number;
}

export async function cleanupDeletedRecipe(id: string): Promise<CleanupReport> {
  const report: CleanupReport = { versions: 0, images: 0, mealsUpdated: 0, mealsDeleted: 0, planItemsUpdated: 0, planItemsDeleted: 0, householdDocsDeleted: 0 };

  const versions = db.collection("recipes").doc(id).collection("versions");
  report.versions = (await versions.count().get()).data().count;
  await db.recursiveDelete(versions);

  const [files] = await bucket().getFiles({ prefix: `recipes/${id}/` });
  await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
  report.images = files.length;

  // Saved meals (M2 creates them; written here so the purge never leaves dangling references).
  const meals = await db.collection("meals").get();
  for (const m of meals.docs) {
    const list = (m.data().recipes ?? []) as RecipeRef[];
    if (!list.some((r) => r.recipeId === id)) continue;
    const rest = list.filter((r) => r.recipeId !== id);
    if (rest.length === 0) {
      await m.ref.delete();
      report.mealsDeleted++;
    } else {
      await m.ref.update({ recipes: rest });
      report.mealsUpdated++;
    }
  }

  const households = await db.collection("households").listDocuments();
  for (const hh of households) {
    const planned = await hh.collection("planItems").where("status", "==", "planned").get();
    for (const p of planned.docs) {
      const list = (p.data().recipes ?? []) as RecipeRef[];
      if (!list.some((r) => r.recipeId === id)) continue;
      const rest = list.filter((r) => r.recipeId !== id);
      if (rest.length === 0) {
        await p.ref.delete();
        report.planItemsDeleted++;
      } else {
        await p.ref.update({ recipes: rest });
        report.planItemsUpdated++;
      }
    }
    for (const ref of [hh.collection("favourites").doc(`recipe_${id}`), hh.collection("notes").doc(id), hh.collection("stats").doc(`recipe_${id}`)]) {
      const s = await ref.get();
      if (s.exists) {
        await ref.delete();
        report.householdDocsDeleted++;
      }
    }
  }
  return report;
}
