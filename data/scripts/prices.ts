// `pnpm prices:check [-- --write]` (Planning/M2 §6): validates data/price-estimates.json against the ingredient seed,
// flags seeded ingredients without an estimate and estimates for unknown ingredients, and with --write fills each
// estimate's `centsPerUnit` (cents per canonical unit, from the seed's conversions) used by the recipe cost filter.
// The file is bundled into the web app; nothing is uploaded.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packToCanonical, priceEstimatesFileSchema } from "../../packages/core/src/index";
import { DATA_DIR, loadIngredients } from "./ingredients";

const FILE = join(DATA_DIR, "price-estimates.json");
const write = process.argv.includes("--write");

const parsed = priceEstimatesFileSchema.safeParse(JSON.parse(readFileSync(FILE, "utf8")));
if (!parsed.success) {
  console.error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}
const file = parsed.data;
const { items } = loadIngredients();
const byId = new Map(items.map((i) => [i.id, i]));
const problems: string[] = [];

for (const i of items) if (!file.estimates[i.id]) problems.push(`no estimate: ${i.id}`);
for (const [id, e] of Object.entries(file.estimates)) {
  const ing = byId.get(id);
  if (!ing) {
    problems.push(`estimate for unknown ingredient: ${id}`);
    continue;
  }
  const c = packToCanonical(e.packAmount, e.packMeasure, ing);
  if (!c) {
    problems.push(`${id}: ${e.packAmount} ${e.packMeasure} can't be converted (missing density or unit weight?)`);
    continue;
  }
  const cpu = Math.round((e.priceCents / c) * 10_000) / 10_000;
  if (write) e.centsPerUnit = cpu;
  else if (e.centsPerUnit === undefined || Math.abs(e.centsPerUnit - cpu) > 1e-4) problems.push(`${id}: centsPerUnit is stale (run with --write)`);
}

if (write) {
  const sorted = Object.fromEntries(Object.entries(file.estimates).sort(([a], [b]) => a.localeCompare(b)));
  const lines = Object.entries(sorted).map(([id, e]) => `    ${JSON.stringify(id)}: ${JSON.stringify(e).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }")}`);
  const head = `{\n  "schemaVersion": 1,\n  "currency": "CAD",\n  "region": ${JSON.stringify(file.region ?? "")},\n  "estimates": {\n`;
  writeFileSync(FILE, `${head}${lines.join(",\n")}\n  }\n}\n`);
}

const n = Object.keys(file.estimates).length;
if (problems.filter((p) => !(write && p.includes("stale"))).length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s); ${n} estimates for ${items.length} ingredients.`);
  process.exit(1);
}
console.log(`${n} estimates for ${items.length} ingredients: all present${write ? ", centsPerUnit written" : ""}.`);
