// The LLM ingredient judge (PRD R4.27, R4.35; TECHNICAL_SPECS §9 "LLM judge", Planning/M15): for a name the matcher
// can't place, asks whether one of its candidates is the same ingredient. Pure: builds the Gemini request and the Claude
// prompt, and reads either answer. One format serves both: {"answers":[{"name","verdict","id"}]}. Anything that isn't a
// clean answer about a listed candidate reads as "unsure", so a bad answer never merges anything.

import { suggestIngredients, type IngredientIndex } from "./ingredientMatch";

export interface JudgeCandidate {
  id: string;
  name: string;
  category?: string | undefined;
  aliases?: readonly string[] | undefined;
}

export interface JudgeItem {
  name: string;
  candidates: JudgeCandidate[];
}

export type Verdict = { verdict: "same"; id: string } | { verdict: "new" } | { verdict: "unsure" };

/**
 * A household-made name nobody has decided yet (R4.27, R4.35): the judge was unsure, or it was flagged for review before
 * M15 and never checked. Catalogue ingredients, merged ones, and names already judged new never wait.
 */
export function isNameWaiting(d: { createdBy?: string | undefined; mergedInto?: string | undefined; nameCheck?: "new" | "unsure" | undefined; needsReview: boolean }): boolean {
  return !!d.createdBy && !d.mergedInto && (d.nameCheck === "unsure" || (!d.nameCheck && d.needsReview));
}

/** Names per request: keeps prompts short and well inside the free tier's request limits. */
export const JUDGE_BATCH = 20;
/** Candidates offered per name. */
export const JUDGE_CANDIDATES = 6;

/** Each name with its likely candidates (the matcher's suggestions), skipping `exclude` (itself, when re-judging). */
export function judgeItems(
  names: readonly { name: string; exclude?: readonly string[] }[],
  index: IngredientIndex,
  lookup: (id: string) => Omit<JudgeCandidate, "id"> | undefined,
): JudgeItem[] {
  return names.map(({ name, exclude }) => ({
    name,
    candidates: suggestIngredients(name, index, JUDGE_CANDIDATES, { exclude: exclude ?? [] }).flatMap((s) => {
      const d = lookup(s.id);
      return d ? [{ id: s.id, name: d.name, category: d.category, aliases: (d.aliases ?? []).slice(0, 8) }] : [];
    }),
  }));
}

export const JUDGE_RULES = `You decide whether a new ingredient name from a recipe is the same ingredient as one already in a household's list.
"Same" means a shopper would buy the identical product for either name and a recipe could use either without change.
Plurals, spelling variants, brand names, preparation words (chopped, diced, minced, softened) and size words don't make it different.
Different forms are different ingredients: ground beef vs beef, cooked rice vs rice, egg yolk vs egg, dried vs fresh herbs, lemon juice vs lemon, chocolate chips vs chocolate.
For each name answer "same" with the id of the matching candidate (only an id from that name's candidates), "new" when no candidate is the same, or "unsure" when you can't tell.`;

function listing(items: readonly JudgeItem[]): string {
  return items
    .map((it, i) => {
      const c = it.candidates.length
        ? it.candidates.map((c) => `   - id "${c.id}": ${c.name}${c.category ? ` (${c.category})` : ""}${c.aliases?.length ? `; also called ${c.aliases.join(", ")}` : ""}`).join("\n")
        : "   (no candidates)";
      return `${i + 1}. "${it.name}"\n${c}`;
    })
    .join("\n");
}

/** The Gemini generateContent body: rules, the names with their candidates, a JSON response schema. */
export function geminiRequest(items: readonly JudgeItem[]) {
  return {
    systemInstruction: { parts: [{ text: JUDGE_RULES }] },
    contents: [{ role: "user", parts: [{ text: `Names and their candidates:\n${listing(items)}` }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          answers: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING" }, verdict: { type: "STRING", enum: ["same", "new", "unsure"] }, id: { type: "STRING" } },
              required: ["name", "verdict"],
            },
          },
        },
        required: ["answers"],
      },
    },
  };
}

/** The text of a Gemini generateContent response (first candidate), or null. */
export function geminiText(json: unknown): string | null {
  const parts = (json as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] })?.candidates?.[0]?.content?.parts;
  const text = parts?.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  return text ? text : null;
}

/** Reads answers for `items`: by name (case-insensitive); unknown names ignored; anything doubtful is "unsure". */
export function readAnswers(value: unknown, items: readonly JudgeItem[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>(items.map((it) => [it.name, { verdict: "unsure" }]));
  const answers = Array.isArray(value) ? value : (value as { answers?: unknown })?.answers;
  if (!Array.isArray(answers)) return out;
  const byName = new Map(items.map((it) => [it.name.trim().toLowerCase(), it]));
  for (const a of answers) {
    const o = (a ?? {}) as { name?: unknown; verdict?: unknown; id?: unknown };
    const it = typeof o.name === "string" ? byName.get(o.name.trim().toLowerCase()) : undefined;
    if (!it) continue;
    if (o.verdict === "new") out.set(it.name, { verdict: "new" });
    else if (o.verdict === "same" && typeof o.id === "string" && it.candidates.some((c) => c.id === o.id)) out.set(it.name, { verdict: "same", id: o.id });
  }
  return out;
}

/** The first JSON object or array in a text (a pasted chat answer, maybe in a ```json fence, maybe with prose). */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1]! : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const close = body[start] === "{" ? "}" : "]";
  for (let end = body.lastIndexOf(close); end > start; end = body.lastIndexOf(close, end - 1)) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      // prose after the JSON: try a shorter slice
    }
  }
  return null;
}

/** A prompt to paste into Claude (R4.35): the same rules and names, asking for the JSON answer in a code block. */
export function claudePrompt(items: readonly JudgeItem[]): string {
  return `${JUDGE_RULES}

Answer with only a JSON code block in this form:
\`\`\`json
{"answers":[{"name":"<name as given>","verdict":"same","id":"<candidate id>"},{"name":"<name>","verdict":"new"}]}
\`\`\`

Names and their candidates:
${listing(items)}`;
}

/** Reads a pasted Claude answer (R4.35). */
export function parseClaudeAnswer(text: string, items: readonly JudgeItem[]): Map<string, Verdict> {
  return readAnswers(extractJson(text), items);
}

/** "merge 3 · keep 2 as new · 1 still unsure" */
export function verdictSummary(verdicts: Iterable<Verdict>): { same: number; new: number; unsure: number } {
  const n = { same: 0, new: 0, unsure: 0 };
  for (const v of verdicts) n[v.verdict]++;
  return n;
}
