// `pnpm free-use:write`: writes data/free-use.json, the seed's free-use ingredient IDs (R8.14), bundled into the web app
// so the Recipes page can mark "can make" without reading every ingredient. packages/core/src/freeUse.test.ts fails when
// it is stale. Ingredients switched to free-use in the app are honoured on recipe pages (they read the docs) and here
// after the next regeneration.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, loadIngredients } from "./ingredients";

export function freeUseIds(): string[] {
  return loadIngredients()
    .items.filter((i) => i.freeUse)
    .map((i) => i.id)
    .sort();
}

if (process.argv[1]?.endsWith("free-use.ts")) {
  writeFileSync(join(DATA_DIR, "free-use.json"), `${JSON.stringify(freeUseIds(), null, 0)}\n`);
  console.log("wrote data/free-use.json");
}
