// `pnpm gen:skill`: regenerates the parts of the Claude skill (.claude/skills/solving-food-skill/) that come from code, so
// the skill and the importer can't drift (TECHNICAL_SPECS §4.3, §9 "Claude skill"):
//   references/taxonomy.md     cuisine and main_protein lists from packages/core/src/taxonomy.ts, plus units
//   references/ingredients.md  the seed ingredient names and aliases (data/ingredients/), grouped by category
//   functions/src/ai/skillText.generated.ts  the skill itself as Gemini's prompt for Add with Gemini (M16, R4.37)
// `pnpm gen:skill -- --check` exits non-zero when the files are out of date (packages/core/src/skill.test.ts runs
// the same comparison in the unit tests).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderIngredients, renderTaxonomy } from "../packages/core/src/skillDocs";
import { renderSkillModule, SKILL_PROMPT_FILES } from "../packages/core/src/recipeFromGemini";
import { loadIngredients } from "../data/scripts/ingredients";

const dir = fileURLToPath(new URL("../.claude/skills/solving-food-skill/references/", import.meta.url));
const files: Record<string, string> = {
  [join(dir, "taxonomy.md")]: renderTaxonomy(),
  [join(dir, "ingredients.md")]: renderIngredients(loadIngredients().items),
};
// The prompt module is rendered from the skill as it will be once the references above are written.
const skillDir = join(dir, "..");
const skillFile = (f: string) => files[join(skillDir, f)] ?? readFileSync(join(skillDir, f), "utf8");
files[fileURLToPath(new URL("../functions/src/ai/skillText.generated.ts", import.meta.url))] = renderSkillModule(
  Object.fromEntries(SKILL_PROMPT_FILES.map((f) => [f, skillFile(f)])) as Parameters<typeof renderSkillModule>[0],
);
const check = process.argv.includes("--check");
let stale = 0;
for (const [path, text] of Object.entries(files)) {
  const name = path.split("/").pop();
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
