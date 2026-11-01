// The LLM ingredient judge (M15): candidates, the Gemini request, and reading answers from Gemini or a pasted Claude
// reply. A bad answer never names an ingredient that wasn't offered.
import { describe, expect, it } from "vitest";
import { buildIngredientIndex } from "./ingredientMatch";
import { claudePrompt, extractJson, geminiRequest, geminiText, judgeItems, parseClaudeAnswer, readAnswers, verdictSummary, type JudgeItem } from "./ingredientJudge";

const entries = [
  { id: "strawberry-jam", name: "strawberry jam", aliases: ["strawberry preserves"], category: "condiments" },
  { id: "jam", name: "jam", aliases: [], category: "condiments" },
  { id: "ground-beef", name: "ground beef", aliases: [], category: "meat" },
  { id: "beef", name: "beef", aliases: [], category: "meat" },
  { id: "old", name: "old jam", aliases: [], category: "condiments", mergedInto: "jam" },
];
const index = buildIngredientIndex(entries);
const lookup = (id: string) => entries.find((e) => e.id === id);

const items: JudgeItem[] = [
  { name: "strawberry spread", candidates: [{ id: "strawberry-jam", name: "strawberry jam" }, { id: "jam", name: "jam" }] },
  { name: "beef mince", candidates: [{ id: "ground-beef", name: "ground beef" }, { id: "beef", name: "beef" }] },
  { name: "mystery", candidates: [] },
];

describe("judgeItems", () => {
  it("offers the matcher's suggestions with names, never the excluded id or a tombstone", () => {
    const [it1] = judgeItems([{ name: "strawberry jam spread", exclude: ["jam"] }], index, lookup);
    expect(it1!.candidates.map((c) => c.id)).toContain("strawberry-jam");
    expect(it1!.candidates.map((c) => c.id)).not.toContain("jam");
    expect(it1!.candidates.map((c) => c.id)).not.toContain("old");
    expect(it1!.candidates.find((c) => c.id === "strawberry-jam")).toMatchObject({ name: "strawberry jam", category: "condiments", aliases: ["strawberry preserves"] });
  });
});

describe("answers", () => {
  it("reads same / new; an id that wasn't offered, a missing name, or junk is unsure", () => {
    const v = readAnswers(
      { answers: [{ name: "Strawberry Spread", verdict: "same", id: "strawberry-jam" }, { name: "beef mince", verdict: "same", id: "chicken" }, { name: "nobody", verdict: "new" }] },
      items,
    );
    expect(v.get("strawberry spread")).toEqual({ verdict: "same", id: "strawberry-jam" });
    expect(v.get("beef mince")).toEqual({ verdict: "unsure" });
    expect(v.get("mystery")).toEqual({ verdict: "unsure" });
    expect([...readAnswers("nonsense", items).values()].every((x) => x.verdict === "unsure")).toBe(true);
    expect(readAnswers([{ name: "mystery", verdict: "new" }], items).get("mystery")).toEqual({ verdict: "new" });
  });

  it("pulls the JSON out of a pasted chat answer, fenced or with prose around it", () => {
    const fenced = 'Sure! Here you go:\n```json\n{"answers":[{"name":"mystery","verdict":"new"}]}\n```\nLet me know.';
    expect(parseClaudeAnswer(fenced, items).get("mystery")).toEqual({ verdict: "new" });
    const bare = 'Answer: {"answers":[{"name":"beef mince","verdict":"same","id":"ground-beef"}]} (beef mince is ground beef)';
    expect(parseClaudeAnswer(bare, items).get("beef mince")).toEqual({ verdict: "same", id: "ground-beef" });
    expect(extractJson("no json here")).toBeNull();
  });

  it("reads Gemini's response text", () => {
    expect(geminiText({ candidates: [{ content: { parts: [{ text: '{"answers":[]}' }] } }] })).toBe('{"answers":[]}');
    expect(geminiText({})).toBeNull();
  });

  it("summarises", () => {
    expect(verdictSummary([{ verdict: "same", id: "x" }, { verdict: "new" }, { verdict: "unsure" }, { verdict: "new" }])).toEqual({ same: 1, new: 2, unsure: 1 });
  });
});

describe("prompts", () => {
  it("list every name with its candidate ids, and ask for JSON", () => {
    const body = geminiRequest(items);
    const text = body.contents[0]!.parts[0]!.text;
    expect(text).toContain('"strawberry spread"');
    expect(text).toContain('id "strawberry-jam": strawberry jam');
    expect(text).toContain("(no candidates)");
    expect(body.generationConfig).toMatchObject({ temperature: 0, responseMimeType: "application/json" });
    const prompt = claudePrompt(items);
    expect(prompt).toContain("```json");
    expect(prompt).toContain('id "ground-beef": ground beef');
  });
});
