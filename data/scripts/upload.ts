// `pnpm ingredients:upload[:emulator]`: idempotent upsert of data/ingredients/ into the `ingredients` collection
// (Admin credentials, bypassing rules). Validates first. Ingredients someone edited in the app (they carry
// `updatedBy`) are left alone unless `--force`, except that one without `nutrients` gets the seed's (M10); unchanged
// seed docs are skipped.
//
//   pnpm ingredients:upload:emulator      # local emulator
//   pnpm ingredients:upload               # live project (owner's gcloud login)
//   pnpm ingredients:upload -- --force    # also overwrite in-app edits
import { isDeepStrictEqual } from "node:util";
import { openStore } from "../../scripts/lib/admin-store";
import { loadIngredients, validateIngredients } from "./ingredients";

const args = process.argv.slice(2);
const store = openStore(args.includes("--emulator"));
const force = args.includes("--force");

const { items } = loadIngredients();
const problems = validateIngredients(items);
if (problems.length) {
  console.error(`Refusing to upload: ${problems.length} problem(s). Run pnpm ingredients:validate.`);
  process.exit(1);
}

const existing = await store.getMany(items.map((i) => `ingredients/${i.id}`));
const writes: Array<{ path: string; data: Record<string, never> }> = [];
let edited = 0;
let filled = 0;
let same = 0;
for (const { id, ...doc } of items) {
  const path = `ingredients/${id}`;
  const cur = existing.get(path);
  if (cur && cur.updatedBy && !force) {
    edited++;
    // M10 (R4.30): an in-app-edited ingredient keeps every edit but gets the seed's nutrition facts when it has none,
    // so every recipe gets its Nutrition Facts panel (the ingredient trigger recomputes the recipes).
    if (cur.nutrients === undefined && doc.nutrients && !cur.mergedInto) {
      writes.push({ path, data: { ...cur, nutrients: doc.nutrients, nutrientSource: doc.nutrientSource } as never });
      filled++;
    }
    continue;
  }
  if (cur && isDeepStrictEqual(JSON.parse(JSON.stringify(cur)), JSON.parse(JSON.stringify(doc)))) {
    same++;
    continue;
  }
  writes.push({ path, data: doc as never });
}
// Every ingredient write fires the ingredientRecipes trigger. The Functions emulator starts one worker process per
// concurrent event and keeps it, so 475 writes at once leave dozens of ~80 MB workers and make it drop other events
// (the drop folder's). Small paced batches keep it to a handful. The live project scales and retries on its own.
await store.setMany(writes, store.where === "emulator" ? { chunk: 4, pauseMs: 120 } : {});
console.log(
  `ingredients (${store.where}): ${writes.length} written, ${same} unchanged, ${edited} edited in the app and kept${force ? "" : " (use --force to overwrite)"} (${filled} of them given nutrition facts); ${items.length} in the seed`,
);
