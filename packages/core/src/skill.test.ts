// The Claude skill (.claude/skills/cooklang-recipe/) must agree with the importer: the generated references are up to
// date, and every Cooklang example in it imports cleanly with the app's own parser and validator (PRD R4.17, R4.25).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cooklangToRecipe } from "./cooklang";
import { renderIngredients, renderTaxonomy } from "./skillDocs";
import { buildIngredientIndex, resolveIngredientName, type IngredientDoc } from "./ingredient";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const skill = join(root, ".claude/skills/cooklang-recipe");
const seed = readdirSync(join(root, "data/ingredients"))
  .filter((f) => f.endsWith(".json"))
  .flatMap(
    (f) =>
      JSON.parse(readFileSync(join(root, "data/ingredients", f), "utf8")) as Array<
        IngredientDoc & { id: string }
      >,
  );

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  );
}

describe("cooklang-recipe skill", () => {
  it("generated references match packages/core and the seed (run pnpm gen:skill)", () => {
    expect(readFileSync(join(skill, "references/taxonomy.md"), "utf8")).toBe(renderTaxonomy());
    expect(readFileSync(join(skill, "references/ingredients.md"), "utf8")).toBe(renderIngredients(seed));
  });

  const blocks = walk(skill).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/```cooklang\n([\s\S]*?)```/g)].map(
      (m, i) => [`${f.slice(skill.length + 1)} #${i + 1}`, m[1]!] as const,
    ),
  );

  it("has worked examples", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  const index = buildIngredientIndex(seed);
  it.each(blocks)("%s imports with every ingredient known to the seed", (_name, src) => {
    const r = cooklangToRecipe(src, { resolve: (n) => resolveIngredientName(n, index) });
    expect(r.newIngredients.map((n) => n.doc.name)).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.content.ingredients.length).toBeGreaterThan(0);
  });
});
