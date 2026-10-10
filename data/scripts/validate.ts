// `pnpm ingredients:validate`: schema, completeness, and uniqueness of names/aliases in data/ingredients/, and that
// every ingredient the 28 household recipes mention resolves to one of them. Exit 1 on any problem.
import { loadIngredients, unresolvedRecipeNames, validateIngredients } from "./ingredients";

const { items, files } = loadIngredients();
const problems = [...validateIngredients(items), ...unresolvedRecipeNames(items).map((n) => `unresolved recipe ingredient: ${n}`)];

for (const [f, n] of Object.entries(files)) console.log(`${f.padEnd(18)} ${String(n).padStart(4)}`);
console.log(`${"total".padEnd(18)} ${String(items.length).padStart(4)}`);
for (const p of problems) console.log(`  ✗ ${p}`);
console.log(problems.length ? `\n${problems.length} problem(s)` : "\ningredients valid; every recipe ingredient resolves");
process.exit(problems.length ? 1 : 0);
