// One-off repair (Planning/M7-review-fixes.md item 2): makes every recipe's current state restorable by writing a
// missing `recipes/{id}/versions/{version}` snapshot from the recipe document, in the shape the editor writes
// (`apps/web/src/data/recipes.ts`): the recipe's fields without `indexChunk`, plus `editedBy` / `editedAt` (the
// recipe's `updatedBy` / `updatedAt`) and `repairedBy` so a repaired snapshot can be told apart.
//
//   pnpm tsx scripts/repair-versions.ts                    # live project, dry run: lists what it would write
//   pnpm tsx scripts/repair-versions.ts -- --write         # live project, writes the missing snapshots
//   pnpm tsx scripts/repair-versions.ts -- --emulator [--write]
//
// Idempotent: snapshots that exist are never touched (writes are create-only). It never changes a recipe document,
// and it can't bring back content that was never snapshotted: a recipe edited before its earlier versions were saved
// keeps only the versions that exist plus its current one.
import { openStore, type Plain } from "./lib/admin-store";

const args = process.argv.slice(2);
const emulator = args.includes("--emulator");
const write = args.includes("--write");
const store = openStore(emulator);

const recipes = await store.listAll("recipes");
const wanted = recipes
  .filter((r) => typeof r.data.version === "number" && (r.data.version as number) >= 1)
  .map((r) => ({ r, path: `recipes/${r.id}/versions/${r.data.version as number}` }));
const have = await store.getMany(wanted.map((w) => w.path));
const missing = wanted.filter((w) => !have.has(w.path));

console.log(`${store.where}: ${recipes.length} recipes, ${wanted.length - missing.length} have their current version snapshot, ${missing.length} missing`);
for (const { r, path } of missing) console.log(`  ${write ? "writing" : "would write"} ${path} (${String(r.data.title)})`);

if (write && missing.length) {
  const docs = missing.map(({ r, path }) => {
    const { indexChunk: _drop, ...rest } = r.data;
    const data = {
      ...rest,
      editedBy: (r.data.updatedBy ?? r.data.createdBy ?? "repair-versions") as string,
      editedAt: (r.data.updatedAt ?? r.data.createdAt ?? new Date()) as Plain,
      repairedBy: "scripts/repair-versions.ts",
    } as Record<string, Plain | undefined>;
    return { path, data };
  });
  await store.setMany(docs, { createOnly: true });
  console.log(`wrote ${docs.length} snapshot(s)`);
} else if (!write && missing.length) {
  console.log("dry run: pass --write to write them");
}
