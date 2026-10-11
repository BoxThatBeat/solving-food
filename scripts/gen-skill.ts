// `pnpm gen:skill`: regenerates the parts of the Claude skill (.claude/skills/solving-food-skill/) that come from code, so
// the skill and the importer can't drift (TECHNICAL_SPECS §4.3, §9 "Claude skill"):
//   references/taxonomy.md     cuisine and main_protein lists from packages/core/src/taxonomy.ts, plus units
//   references/ingredients.md  the seed ingredient names and aliases (data/ingredients/), grouped by category
// `pnpm gen:skill -- --check` exits non-zero when the files are out of date (packages/core/src/skill.test.ts runs
// the same comparison in the unit tests).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderIngredients, renderTaxonomy } from "../packages/core/src/skillDocs";
import { loadIngredients } from "../data/scripts/ingredients";

const dir = fileURLToPath(new URL("../.claude/skills/solving-food-skill/references/", import.meta.url));
const files: Record<string, string> = {
  "taxonomy.md": renderTaxonomy(),
  "ingredients.md": renderIngredients(loadIngredients().items),
};
const check = process.argv.includes("--check");
let stale = 0;
for (const [name, text] of Object.entries(files)) {
  const path = join(dir, name);
  let cur = "";
  try {
    cur = readFileSync(path, "utf8");
  } catch {
    /* missing */
  }
  if (cur === text) continue;
  stale++;
  if (check) console.error(`${name} is out of date; run pnpm gen:skill`);
  else {
    writeFileSync(path, text);
    console.log(`wrote ${name}`);
  }
}
if (check && stale) process.exit(1);
if (!stale) console.log("skill references up to date");
