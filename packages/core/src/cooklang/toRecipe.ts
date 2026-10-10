// `cooklangToRecipe()`: a parsed `.cook` file → recipe content (TECHNICAL_SPECS §9 "Drop folder").
//
// Ingredients are resolved by name or alias; unknown names become new ingredients flagged `needsReview` with defaults
// inferred from a guessed category. An ingredient mentioned several times with amounts (batter + streusel, two water
// additions) is summed into one line when the units are compatible, and each mention keeps its own amount in the
// step text (`{{ing:l3|0.5|cup}}`).

import { defaultLeftoverMealType, placeholder, type RecipeContent, type RecipeIngredient, type RecipeStep } from "../recipe";
import { newIngredient, type IngredientDoc } from "../ingredient";
import { ingredientSlug } from "../names";
import { parseUnit, unitDef, UNITS } from "../units";
import { CooklangError, parseCooklang, type CookItem, type CookQuantity } from "./parse";
import { validateFrontMatter, type FrontMatter } from "./frontMatter";

export interface ImportOptions {
  /** Resolves a recipe's ingredient wording to an existing ingredient ID, or null when unknown. */
  resolve: (name: string) => string | null;
}

export interface ImportResult {
  content: RecipeContent;
  /** The validated front matter (image is resolved by the caller: URL download or a file next to the .cook). */
  frontMatter: FrontMatter;
  /** Ingredients that didn't resolve, to create (flagged needsReview) before saving the recipe. */
  newIngredients: Array<{ id: string; doc: IngredientDoc }>;
  /** Non-fatal notes for the import notification. */
  warnings: string[];
}

const SECONDS: Record<string, number> = { s: 1, sec: 1, second: 1, m: 60, min: 60, minute: 60, h: 3600, hr: 3600, hour: 3600 };

function timerSeconds(q: CookQuantity): number | null {
  if (q.amount === null || q.amount <= 0) return null;
  const u = q.unit.toLowerCase().replace(/s$/, "");
  const f = SECONDS[u] ?? (u === "" ? 60 : null);
  return f === null ? null : Math.round(q.amount * f);
}

function timerText(q: CookQuantity, name: string): string {
  const t = [q.text, q.unit].filter(Boolean).join(" ");
  return name ? (t ? `${t} (${name})` : name) : t;
}

interface Mention {
  stepIndex: number;
  itemIndex: number;
  lineIndex: number;
  /** The amount this mention contributed, in its own measure; null for a name-only mention. */
  part: { amount: number; measure: string } | null;
}

/** A unit kind used for merging: amounts merge when they share a kind (count nouns only with the same noun). */
function mergeKey(measure: string): string {
  const def = unitDef(measure);
  if (def.kind === "count" && !UNITS[measure]) return `noun:${measure}`;
  return def.kind;
}

function convert(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const a = unitDef(from);
  const b = unitDef(to);
  if (a.kind !== b.kind || (a.kind !== "weight" && a.kind !== "volume")) return null;
  return (amount * a.factor) / b.factor;
}

/** Converts Cooklang source to recipe content. Throws `CooklangError` with a readable reason on invalid input. */
export function cooklangToRecipe(source: string, opts: ImportOptions): ImportResult {
  const doc = parseCooklang(source);
  const fmResult = validateFrontMatter(doc.frontMatter);
  if (!fmResult.ok) throw new CooklangError(`Front matter: ${fmResult.error}`);
  const fm = fmResult.value;
  const warnings: string[] = [];
  const unknownKeys = Object.keys(doc.frontMatter).filter(
    (k) => !["title", "servings", "cuisine", "main_protein", "prep_time", "cook_time", "tags", "source", "image", "leftover_portions", "prep", "tools"].includes(k),
  );
  if (unknownKeys.length) warnings.push(`Ignored front matter: ${unknownKeys.join(", ")}`);

  const lines: RecipeIngredient[] = [];
  const mentions: Mention[] = [];
  const newIngredients = new Map<string, { id: string; doc: IngredientDoc }>();
  const tools: string[] = [];

  const idFor = (name: string): string => {
    const found = opts.resolve(name);
    if (found) return found;
    const created = newIngredient(name);
    const key = created.id || ingredientSlug(name);
    if (!newIngredients.has(key)) newIngredients.set(key, { id: key, doc: created.doc });
    return key;
  };

  doc.steps.forEach((step, stepIndex) => {
    step.items.forEach((item, itemIndex) => {
      if (item.type === "cookware") {
        const t = item.name.trim().toLowerCase();
        if (t && !tools.includes(t)) tools.push(t);
        return;
      }
      if (item.type !== "ingredient") return;
      const ingredientId = idFor(item.name);
      const hasAmount = item.quantity.amount !== null && item.quantity.amount > 0;
      const { measure, def } = parseUnit(item.quantity.unit);
      const vague = def.kind === "vague";
      // An existing line for the same ingredient that this mention can merge into.
      let lineIndex = lines.findIndex(
        (l) => l.ingredientId === ingredientId && (!hasAmount || l.amount === 0 || mergeKey(l.measure) === mergeKey(measure)),
      );
      if (lineIndex >= 0 && hasAmount) {
        const line = lines[lineIndex]!;
        if (line.amount === 0) {
          line.amount = item.quantity.amount!;
          line.measure = measure;
          line.optional = item.optional || vague;
        } else {
          const add = convert(item.quantity.amount!, measure, line.measure) ?? (line.measure === measure ? item.quantity.amount! : null);
          if (add === null) lineIndex = -1;
          else line.amount = round(line.amount + add);
        }
      }
      if (lineIndex < 0) {
        lines.push({
          id: `l${lines.length + 1}`,
          ingredientId,
          amount: hasAmount ? item.quantity.amount! : 0,
          measure: hasAmount || vague ? measure : "count",
          canonicalAmount: 0,
          displayText: item.name.trim(),
          optional: item.optional || vague || !hasAmount,
        });
        lineIndex = lines.length - 1;
        if (!hasAmount && item.quantity.text) warnings.push(`"${item.name}": couldn't read the amount "${item.quantity.text}"`);
      }
      mentions.push({ stepIndex, itemIndex, lineIndex, part: hasAmount ? { amount: item.quantity.amount!, measure } : null });
    });
  });

  // Lines whose total came from a single mention use the short placeholder; others carry each mention's part.
  const amountMentions = new Map<number, number>();
  for (const m of mentions) if (m.part) amountMentions.set(m.lineIndex, (amountMentions.get(m.lineIndex) ?? 0) + 1);

  const steps: RecipeStep[] = doc.steps.map((step, stepIndex) => {
    let text = "";
    let timer: number | null = null;
    const refs: string[] = [];
    step.items.forEach((item: CookItem, itemIndex) => {
      switch (item.type) {
        case "text":
          text += item.value;
          break;
        case "cookware":
          text += item.name;
          break;
        case "timer": {
          const s = timerSeconds(item.quantity);
          if (timer === null && s !== null) timer = s;
          text += timerText(item.quantity, item.name);
          break;
        }
        case "ingredient": {
          const m = mentions.find((x) => x.stepIndex === stepIndex && x.itemIndex === itemIndex)!;
          const line = lines[m.lineIndex]!;
          const single = (amountMentions.get(m.lineIndex) ?? 0) <= 1;
          if (m.part && single) text += placeholder(line.id);
          else if (m.part) text += placeholder(line.id, m.part);
          else if ((amountMentions.get(m.lineIndex) ?? 0) === 0) text += placeholder(line.id);
          else text += placeholder(line.id, { amount: 0, measure: "" });
          if (!refs.includes(line.id)) refs.push(line.id);
          break;
        }
      }
    });
    const out: RecipeStep = { text: text.replace(/\s+/g, " ").trim(), ingredientRefs: refs };
    if (timer !== null) out.timerSeconds = timer;
    if (step.section) out.section = step.section;
    return out;
  });

  if (!steps.length) throw new CooklangError("The recipe has no steps");
  if (!lines.length) throw new CooklangError("The recipe has no @ingredients");

  for (const t of fm.tools ?? []) if (!tools.includes(t.toLowerCase())) tools.push(t.toLowerCase());

  const tags = [...new Set(fm.tags.map((t) => t.trim().toLowerCase()).filter((t) => t && t !== "recipe"))];
  const leftovers = fm.leftover_portions ?? 0;
  const content: RecipeContent = {
    title: fm.title,
    servings: fm.servings,
    prepMin: fm.prep_time,
    cookMin: fm.cook_time,
    cuisine: fm.cuisine,
    mainProtein: fm.main_protein,
    tags,
    tools,
    ingredients: lines,
    steps: steps.filter((s) => s.text.length > 0),
    prepTasks: (fm.prep ?? []).map((text) => ({ text, ingredientRefs: [] })),
    defaultLeftoverPortions: leftovers,
    imagePaths: [],
  };
  if (leftovers > 0) content.leftoverMealType = defaultLeftoverMealType(tags);
  if (doc.comments.length) content.notes = doc.comments.join("\n");
  if (fm.source) {
    if (/^https?:\/\//i.test(fm.source)) content.sourceUrl = fm.source;
    else warnings.push(`source isn't a URL: ${fm.source}`);
  }
  return { content, frontMatter: fm, newIngredients: [...newIngredients.values()], warnings };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
