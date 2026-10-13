// `pnpm nutrition:write` (M10, PRD R4.30; TECHNICAL_SPECS §5 "Nutrition facts"): fills `nutrients` (per 100 g) and
// `nutrientSource` on every seed ingredient from data/nutrition-sources.json:
//   { "<ingredientId>": { "cnf": <food code>, "desc": "<CNF description>" } }               Canadian Nutrient File
//   { "<ingredientId>": { "ref": "USDA FDC … | estimate: …", "values": { "kcal": …, … } } }  when CNF has nothing fitting
// plus optional "fill": { "sugarsG": … } and "fillSource" for a value the source lacks (CNF has no sugars for a few foods).
// CNF values come from Health Canada's public API (no key), one request per food code, cached in data/.cnf-cache/
// (gitignored; `--refresh` refetches). Protein and fibre keep their own fields (M1/M9 values) and aren't touched.
//
//   pnpm nutrition:write              # write data/ingredients/*.json (then pnpm ingredients:validate)
//   pnpm nutrition:write -- --check   # exit 1 when the JSON doesn't match the sources (offline, uses the cache)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CNF_NUTRIENT_IDS, NUTRITION_KEYS, type Nutrients, type NutritionKey } from "../../packages/core/src/nutrition";
import { DATA_DIR, INGREDIENTS_DIR } from "./ingredients";

/** `fill` supplies values the source lacks (e.g. CNF has no sugars for a food), with `fillSource` saying where from. */
type Source = ({ cnf: number; desc?: string } | { ref: string; values: Nutrients }) & { fill?: Nutrients; fillSource?: string };
const API = "https://food-nutrition.canada.ca/api/canadian-nutrient-file/nutrientamount/";
const CACHE = join(DATA_DIR, ".cnf-cache");

export function loadSources(): Record<string, Source> {
  return JSON.parse(readFileSync(join(DATA_DIR, "nutrition-sources.json"), "utf8")) as Record<string, Source>;
}

/** Stored precision: energy whole, iron 2 decimals, other milligrams 1, grams 2. */
export function roundPer100g(key: NutritionKey, v: number): number {
  const d = key === "kcal" ? 0 : key === "ironMg" ? 2 : key.endsWith("Mg") ? 1 : 2;
  return Number(v.toFixed(d));
}

async function cnfAmounts(code: number, refresh: boolean, offline: boolean): Promise<Array<{ nutrient_name_id: number; nutrient_value: number }>> {
  const path = join(CACHE, `${code}.json`);
  if (existsSync(path) && !refresh) return JSON.parse(readFileSync(path, "utf8"));
  if (offline) throw new Error(`CNF ${code} not cached; run pnpm nutrition:write`);
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}?id=${code}&lang=en&type=json`);
    if (r.ok) {
      const rows = (await r.json()) as Array<{ nutrient_name_id: number; nutrient_value: number }>;
      if (!Array.isArray(rows) || !rows.length) throw new Error(`CNF ${code}: no nutrient amounts`);
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(path, JSON.stringify(rows));
      return rows;
    }
    if (attempt >= 3) throw new Error(`CNF ${code}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
}

/** The `nutrients` and `nutrientSource` for one source entry. */
export async function nutrientsFor(src: Source, opts: { refresh?: boolean; offline?: boolean } = {}): Promise<{ nutrients: Nutrients; nutrientSource: string }> {
  const out: Nutrients = {};
  if ("cnf" in src) {
    const rows = await cnfAmounts(src.cnf, !!opts.refresh, !!opts.offline);
    for (const key of NUTRITION_KEYS) {
      const row = rows.find((x) => x.nutrient_name_id === CNF_NUTRIENT_IDS[key]);
      if (row && Number.isFinite(row.nutrient_value)) out[key] = roundPer100g(key, Math.max(0, row.nutrient_value));
    }
    return withFill(out, `CNF ${src.cnf}${src.desc ? ` ${src.desc}` : ""}`, src);
  }
  for (const key of NUTRITION_KEYS) {
    const v = src.values[key];
    if (typeof v === "number") out[key] = roundPer100g(key, v);
  }
  return withFill(out, src.ref, src);
}

function withFill(out: Nutrients, source: string, src: Source): { nutrients: Nutrients; nutrientSource: string } {
  const filled: string[] = [];
  for (const key of NUTRITION_KEYS) {
    const v = src.fill?.[key];
    if (typeof v === "number" && out[key] === undefined) {
      out[key] = roundPer100g(key, v);
      filled.push(key);
    }
  }
  // Keys in label order, so the JSON reads the same however it was filled.
  const ordered: Nutrients = {};
  for (const key of NUTRITION_KEYS) if (out[key] !== undefined) ordered[key] = out[key];
  const note = filled.length ? `${source}; ${filled.join(", ")}: ${src.fillSource ?? "estimate"}` : source;
  return { nutrients: ordered, nutrientSource: note.slice(0, 160) };
}

/** Inserts the two fields after `fibrePer100g` (or replaces them), keeping the rest of the key order. */
function withNutrients(doc: Record<string, unknown>, n: { nutrients: Nutrients; nutrientSource: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "nutrients" || k === "nutrientSource") continue;
    out[k] = v;
    if (k === "fibrePer100g") Object.assign(out, n);
  }
  if (!("nutrients" in out)) Object.assign(out, n);
  return out;
}

if (process.argv[1]?.endsWith("nutrition.ts")) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const sources = loadSources();
  let changed = 0;
  const problems: string[] = [];
  for (const f of readdirSync(INGREDIENTS_DIR).filter((x) => x.endsWith(".json")).sort()) {
    const path = join(INGREDIENTS_DIR, f);
    const list = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown> & { id: string }>;
    const next = [];
    for (const doc of list) {
      const src = sources[doc.id];
      if (!src) {
        problems.push(`${doc.id}: no entry in data/nutrition-sources.json`);
        next.push(doc);
        continue;
      }
      const n = await nutrientsFor(src, { refresh: args.includes("--refresh"), offline: check });
      const updated = withNutrients(doc, n);
      if (JSON.stringify(updated) !== JSON.stringify(doc)) changed++;
      next.push(updated);
    }
    if (!check) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  const seen = new Set(readdirSync(INGREDIENTS_DIR).filter((x) => x.endsWith(".json")).flatMap((f) => (JSON.parse(readFileSync(join(INGREDIENTS_DIR, f), "utf8")) as Array<{ id: string }>).map((d) => d.id)));
  for (const id of Object.keys(sources)) if (!seen.has(id)) problems.push(`data/nutrition-sources.json: ${id} is not a seed ingredient`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  if (check) {
    if (changed) {
      console.error(`${changed} ingredient(s) out of date with data/nutrition-sources.json; run pnpm nutrition:write`);
      process.exit(1);
    }
    console.log("nutrients up to date");
  } else {
    // The files are prettier-formatted (short arrays on one line).
    execFileSync(join(DATA_DIR, "..", "node_modules", ".bin", "prettier"), ["--write", "--log-level", "warn", INGREDIENTS_DIR], { stdio: "inherit" });
    console.log(`nutrients: ${changed} ingredient(s) updated`);
  }
}
