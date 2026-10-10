// `recipeToCooklang()`: recipe → `.cook` text for export (PRD R4.22), in the same conventions the drop folder reads
// (data/recipes/README.md), so an exported file re-imports to the same recipe.

import { stringify } from "yaml";
import { PLACEHOLDER, type RecipeContent, type RecipeIngredient } from "../recipe";
import { unitDef, pluralize, UNITS } from "../units";

export interface ExportOptions {
  /** Absolute URL of the hero image, written as `image:` (exports never point at a local path). */
  imageUrl?: string;
}

function numberText(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** The unit as written inside `{amount%unit}`. */
function unitText(measure: string, amount: number): string {
  const def = UNITS[measure];
  if (!def) return Math.abs(amount - 1) < 1e-9 ? measure : pluralize(measure);
  if (def.kind === "count") return "";
  return def.key;
}

function token(line: RecipeIngredient, part?: { amount: number; measure: string }): string {
  const mod = line.optional && line.amount > 0 && unitDef(line.measure).kind !== "vague" ? "?" : "";
  const amount = part ? part.amount : line.amount;
  const measure = part ? part.measure || line.measure : line.measure;
  if (amount <= 0) {
    const def = unitDef(measure);
    if (def.kind === "vague" && part === undefined) return `@${mod}${line.displayText}{%${def.key}}`;
    return `@${mod}${line.displayText}{}`;
  }
  const u = unitText(measure, amount);
  return `@${mod}${line.displayText}{${numberText(amount)}${u ? `%${u}` : ""}}`;
}

const TIME_PHRASE = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi;

function timerToken(text: string, seconds: number): string {
  let done = false;
  return text.replace(TIME_PHRASE, (all, n: string, u: string) => {
    if (done) return all;
    const f = /^s/i.test(u) ? 1 : /^h/i.test(u) ? 3600 : 60;
    if (Math.round(Number(n) * f) !== seconds) return all;
    done = true;
    return `~{${n}%${u}}`;
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain text of a prep task: placeholders become the ingredient wording. */
function plainText(text: string, lines: readonly RecipeIngredient[]): string {
  return text.replace(PLACEHOLDER, (_all, id: string) => lines.find((l) => l.id === id)?.displayText ?? "");
}

export function recipeToCooklang(recipe: RecipeContent, opts: ExportOptions = {}): string {
  const fm: Record<string, unknown> = {
    title: recipe.title,
    servings: recipe.servings,
    cuisine: recipe.cuisine,
    main_protein: recipe.mainProtein,
    prep_time: `${recipe.prepMin} minutes`,
    cook_time: `${recipe.cookMin} minutes`,
    tags: recipe.tags.length ? recipe.tags : ["dinner"],
  };
  if (recipe.sourceUrl) fm.source = recipe.sourceUrl;
  if (opts.imageUrl) fm.image = opts.imageUrl;
  if (recipe.defaultLeftoverPortions > 0) fm.leftover_portions = recipe.defaultLeftoverPortions;
  if (recipe.prepTasks.length) fm.prep = recipe.prepTasks.map((p) => plainText(p.text, recipe.ingredients));

  const used = new Set<string>();
  const unplacedTools = new Set(recipe.tools);
  const paras: string[] = [];
  let section: string | undefined;
  for (const step of recipe.steps) {
    if (step.section !== section && step.section) paras.push(`= ${step.section}`);
    section = step.section;
    let text = step.text.replace(PLACEHOLDER, (_all, id: string, amt?: string, measure?: string) => {
      const line = recipe.ingredients.find((l) => l.id === id);
      if (!line) return "";
      used.add(id);
      return amt === undefined ? token(line) : token(line, { amount: Number(amt), measure: measure ?? "" });
    });
    if (step.timerSeconds) text = timerToken(text, step.timerSeconds);
    for (const tool of [...unplacedTools]) {
      const re = new RegExp(`(^|[^@#~\\p{L}])(${escapeRe(tool)})(?![\\p{L}{])`, "iu");
      if (re.test(text)) {
        text = text.replace(re, (_m, pre: string, name: string) => `${pre}#${name}{}`);
        unplacedTools.delete(tool);
      }
    }
    paras.push(text);
  }
  const rest = recipe.ingredients.filter((l) => !used.has(l.id));
  if (rest.length) {
    const list = rest.map((l) => token(l));
    paras.push(`You'll also need ${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0]}.`);
  }
  if (unplacedTools.size) fm.tools = [...unplacedTools];
  if (recipe.notes?.trim()) paras.push(recipe.notes.trim().split("\n").map((l) => `-- ${l}`).join("\n"));

  const yaml = stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${paras.join("\n\n")}\n`;
}

/** A filename for the export: kebab-case of the title. */
export function cooklangFilename(title: string): string {
  return `${
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "recipe"
  }.cook`;
}
