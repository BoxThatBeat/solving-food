// `pnpm review:ingredients` (Planning/M8 item 5): lists every ingredient that needs review with the matcher's suggested
// counterpart, its confidence and the recipes that use it. With `--merge`, merges only the ones the matcher resolves at
// "exact" or "variant" confidence, through the same code the mergeIngredient callable runs (functions/src/ingredients.ts,
// Admin SDK), and prints exactly what moved. Everything else stays in the review list for the owner.
//
//   pnpm review:ingredients                         # live, dry run (gcloud login, read-only)
//   pnpm review:ingredients -- --merge              # live, merges exact/variant matches (needs ADC: see below)
//   pnpm review:ingredients -- --emulator [--merge]
//
// Live merges use the Admin SDK, so they need Application Default Credentials for the owner, e.g.
// GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/legacy_credentials/<owner>/adc.json.
//
// Pairs of two needs-review spellings (m&m's / m&ms) merge into one of them: the one more recipes use, else the shorter
// name. A shipped catalogue ingredient is always the target. Recipes, Supply and households are never deleted.
import { buildIngredientIndex, matchIngredient, suggestIngredients, type IngredientDoc } from "@solving-food/core";
import { openStore } from "./lib/admin-store";

const args = process.argv.slice(2);
const emulator = args.includes("--emulator");
const merge = args.includes("--merge");
const OWNER_UID = "HBebN9sYntQG1Kbdx5Ggw611xyy1";

// The merge code initialises the Admin SDK itself (functions/src/admin.ts), so it loads before the store.
process.env.GOOGLE_CLOUD_PROJECT ??= "solvingfood";
process.env.GCLOUD_PROJECT ??= "solvingfood";
if (emulator) process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
const { mergeIngredient } = merge ? await import("../functions/src/ingredients") : { mergeIngredient: null };
const store = openStore(emulator);
type Ing = IngredientDoc & { id: string };
const all = (await store.listAll("ingredients")).map((d) => ({ id: d.id, ...(d.data as IngredientDoc) })) as Ing[];
const recipes = await store.listAll("recipes");
const byId = new Map(all.map((i) => [i.id, i]));
const usedBy = new Map<string, string[]>();
for (const r of recipes) for (const id of new Set((r.data.ingredientIds as string[]) ?? [])) usedBy.set(id, [...(usedBy.get(id) ?? []), String(r.data.title)]);
const index = buildIngredientIndex(all);
const review = all.filter((i) => i.needsReview && !i.mergedInto).sort((a, b) => a.name.localeCompare(b.name));

interface Row {
  ing: Ing;
  match: string | null;
  confidence: string | null;
  suggestions: string[];
  recipes: string[];
}
const rows: Row[] = review.map((ing) => {
  const m = matchIngredient(ing.name, index, { exclude: ing.id });
  const s = suggestIngredients(ing.name, index, 3, { exclude: ing.id });
  return {
    ing,
    match: m.id,
    confidence: m.confidence,
    suggestions: s.map((x) => `${byId.get(x.id)?.name ?? x.id} (${x.confidence}${x.confidence === "similar" ? ` ${x.score.toFixed(2)}` : ""})`),
    recipes: usedBy.get(ing.id) ?? [],
  };
});

console.log(`${store.where}: ${all.length} ingredients, ${review.length} need review\n`);
console.log("| Name | Suggested match | Confidence | Other suggestions | Recipes |");
console.log("|---|---|---|---|---|");
for (const r of rows) {
  const target = r.match ? byId.get(r.match)?.name ?? r.match : "—";
  console.log(`| ${r.ing.name} | ${target} | ${r.confidence ?? "—"} | ${r.suggestions.join(", ") || "—"} | ${r.recipes.join("; ") || "—"} |`);
}

// The auto-merge plan: exact / variant only.
const auto = rows.filter((r) => r.match && (r.confidence === "exact" || r.confidence === "variant"));
const planned: Array<{ from: Ing; into: Ing; confidence: string }> = [];
const done = new Set<string>();
const weight = (i: Ing) => [-(usedBy.get(i.id)?.length ?? 0), i.name.length, i.id] as const;
for (const r of auto) {
  if (done.has(r.ing.id)) continue;
  let from = r.ing;
  let into = byId.get(r.match!)!;
  // Two needs-review spellings: merge into the canonical one of the pair.
  if (into.needsReview && into.createdBy) {
    const [a, b] = [weight(from), weight(into)];
    const intoFirst = a[0] !== b[0] ? b[0] < a[0] : a[1] !== b[1] ? b[1] < a[1] : b[2] < a[2];
    if (!intoFirst) [from, into] = [into, from];
  }
  if (done.has(from.id) || done.has(into.id)) continue;
  done.add(from.id);
  planned.push({ from, into, confidence: r.confidence! });
}
console.log(`\nAuto-merge (exact / variant only): ${planned.length}`);
for (const p of planned) console.log(`  ${p.from.name} (${p.from.id}) → ${p.into.name} (${p.into.id}) [${p.confidence}]`);

if (!merge) {
  console.log("\ndry run: pass --merge to merge these");
  process.exit(0);
}

console.log("\nMerging:");
for (const p of planned) {
  const r = await mergeIngredient!(OWNER_UID, { fromId: p.from.id, intoId: p.into.id });
  console.log(
    `  merged ${r.fromName} → ${r.intoName}: ${r.recipes} recipes, ${r.versions} versions, ${r.meals} meals, ${r.supplyRows} Supply rows, ${r.planItems} plan items, ${r.groceryLists} grocery lists, ${r.householdDocs} household docs; aliases added: ${r.aliasesAdded.join(", ") || "none"}${r.alreadyMerged ? " (already merged)" : ""}`,
  );
}
