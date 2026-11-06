// Prep task amounts (M29, PRD R4.42): mise en place shows each ingredient a prep task mentions with its amount inline,
// as step mode does (R4.11), scaled to the cook's servings and in one unit system (R8.13, `amountText`). Prep tasks
// written in the editor carry `{{ing:…}}` placeholders and render like steps. Imported ones (a Cooklang `prep:` list)
// are plain text ("Mince 5 garlic cloves", "Chop 0.25 cup basil"): the recipe's ingredient names are found in the
// wording, and a quantity written in front of a name ("5", "0.25 cup") becomes the badge, scaled, instead of staying
// in the text at the recipe's own servings. A name with no quantity in front gets the recipe line's amount.
import { parseAmount } from "./cooklang/parse";
import { PREP_WORDS } from "./ingredientMatch";
import { singularize } from "./names";
import { amountText, PLACEHOLDER, renderStep, type IngredientLookup, type RecipeIngredient, type StepSegment } from "./recipe";
import { fahrenheitOnly, parseUnit, unitDef } from "./units";

const ADJECTIVES = new Set(PREP_WORDS.filter((w) => !w.includes(" ")));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The wordings of a line to look for: "fresh thyme", "thyme" (without preparation words), and the singular. */
function phrasesOf(line: RecipeIngredient): string[] {
  const base = line.displayText.toLowerCase().replace(/\s+/g, " ").trim();
  const bare = base
    .split(" ")
    .filter((w) => !ADJECTIVES.has(w))
    .join(" ");
  const out = new Set<string>();
  for (const p of [base, bare]) {
    if (p.length < 3) continue;
    out.add(p);
    const words = p.split(" ");
    out.add([...words.slice(0, -1), singularize(words.at(-1)!)].join(" "));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** A unit word as written ("cup", "g", "tbsp", "can"); count nouns ("cloves") and other words aren't. */
function isUnitWord(word: string): boolean {
  return /^[a-z]+\.?$/i.test(word) && parseUnit(word).def.kind !== "count";
}

interface Literal {
  /** Where the quantity starts and ends in the text before the name (adjectives after it stay). */
  from: number;
  to: number;
  amount: number;
  measure?: string | undefined;
}

/** A quantity written right before a name: "5 ", "0.25 cup ", "1 1/2 cups large ". */
function literalBefore(before: string): Literal | null {
  const words = [...before.matchAll(/\S+/g)];
  let i = words.length - 1;
  while (i >= 0 && ADJECTIVES.has(words[i]![0].toLowerCase())) i--;
  const keepFrom = i + 1 < words.length ? words[i + 1]!.index : before.length;
  let measure: string | undefined;
  if (i >= 0 && isUnitWord(words[i]![0])) {
    measure = parseUnit(words[i]![0]).measure;
    i--;
  }
  if (i < 0) return null;
  let start = i;
  let amount = parseAmount(words[i]![0]);
  // "1 1/2": a whole number in front of a fraction.
  if (amount !== null && i > 0 && /\//.test(words[i]![0])) {
    const mixed = parseAmount(`${words[i - 1]![0]} ${words[i]![0]}`);
    if (mixed !== null) {
      amount = mixed;
      start = i - 1;
    }
  }
  if (amount === null || amount <= 0) return null;
  return { from: words[start]!.index, to: keepFrom, amount, measure };
}

/**
 * `renderPrepTask()`: a prep task as text and ingredient segments with inline amounts, like `renderStep()`.
 * `factor` scales the amounts (the cook's servings over the recipe's).
 */
export function renderPrepTask(text: string, lines: readonly RecipeIngredient[], lookup: IngredientLookup, factor = 1): StepSegment[] {
  if (new RegExp(PLACEHOLDER.source).test(text)) return renderStep(text, lines, lookup, factor);
  // Every mention of a line's wording; the longest wins where two overlap, and each line is badged once.
  const found: Array<{ line: RecipeIngredient; at: number; end: number }> = [];
  const candidates = lines.flatMap((line) =>
    phrasesOf(line).flatMap((p) => {
      const m = new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?:e?s)?(?![\\p{L}\\p{N}])`, "iu").exec(text);
      return m ? [{ line, at: m.index, end: m.index + m[0].length }] : [];
    }),
  );
  candidates.sort((a, b) => b.end - b.at - (a.end - a.at) || a.at - b.at);
  for (const c of candidates) {
    if (found.some((f) => f.line.id === c.line.id || (c.at < f.end && f.at < c.end))) continue;
    found.push(c);
  }
  found.sort((a, b) => a.at - b.at);

  const out: StepSegment[] = [];
  let last = 0;
  for (const f of found) {
    let before = text.slice(last, f.at);
    let end = f.end;
    let amount: number | null = null;
    let measure: string | undefined;
    const lit = literalBefore(before);
    if (lit) {
      amount = lit.amount;
      measure = lit.measure;
      before = before.slice(0, lit.from) + before.slice(lit.to);
      // "5 garlic cloves": the count noun after the name is the quantity's unit.
      const noun = /^\s+([a-z]+)(?![\p{L}\p{N}])/iu.exec(text.slice(end));
      if (!measure && noun && (singularize(noun[1]!) === f.line.measure || isUnitWord(noun[1]!))) {
        measure = parseUnit(noun[1]!).measure;
        end += noun[0].length;
      }
      measure ??= unitDef(f.line.measure).kind === "count" ? f.line.measure : "count";
    }
    if (before) out.push({ kind: "text", text: fahrenheitOnly(before) });
    const line = f.line;
    const shown = amount !== null ? amountText(amount * factor, measure!, line.ingredientId, lookup) : line.amount > 0 ? amountText(line.amount * factor, line.measure, line.ingredientId, lookup) : "";
    out.push({ kind: "ingredient", lineId: line.id, name: text.slice(f.at, f.end), amount: shown });
    last = end;
  }
  if (last < text.length) out.push({ kind: "text", text: fahrenheitOnly(text.slice(last)) });
  return out;
}
