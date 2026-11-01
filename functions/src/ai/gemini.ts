// Gemini for the ingredient judge (PRD R4.27, R4.36; TECHNICAL_SPECS §9 "LLM judge"): one HTTPS call per batch of
// names to the Gemini API's free tier, with the key the owner saved in Settings → Ingredients (`aiSession/config`,
// function-only). Not Firebase AI Logic: that bills through this (Blaze) project; the key must come from a Google
// project without billing. Under the emulator (and in tests with PCX_STUB=1) a stub answers from `_stubLlm/config`:
// { answers: { "<name>": "<ingredient id>" | "new" | "unsure" }, mode?: "down" | "off" }; unlisted names are unsure.
import { geminiRequest, geminiText, JUDGE_BATCH, readAnswers, type JudgeItem, type Verdict } from "@solving-food/core";
import { db } from "../admin";
import { isEmulator } from "../pcx/client";

export const AI_CONFIG_DOC = "aiSession/config";
export const STUB_GEMINI_KEY = "stub-gemini-key";
const TIMEOUT_MS = 20_000;

export class AiError extends Error {}
export const AI_NOT_SET_UP = "Gemini isn't set up: the owner saves its API key in Settings → Ingredients.";

/** The saved key, or "" when none is saved. */
export async function storedGeminiKey(): Promise<string> {
  const k = (await db.doc(AI_CONFIG_DOC).get()).data()?.apiKey;
  return typeof k === "string" ? k : "";
}

/** Is there a judge to ask (a saved key, or the stub not switched off)? */
export async function geminiReady(): Promise<boolean> {
  if (isEmulator()) return (await stubConfig()).mode !== "off";
  return !!(await storedGeminiKey());
}

async function stubConfig(): Promise<{ mode?: string; answers?: Record<string, string> }> {
  return ((await db.doc("_stubLlm/config").get().catch(() => null))?.data() ?? {}) as { mode?: string; answers?: Record<string, string> };
}

async function stubJudge(items: readonly JudgeItem[], apiKey?: string): Promise<Map<string, Verdict>> {
  const s = await stubConfig();
  if (s.mode === "off") throw new AiError(AI_NOT_SET_UP);
  if (s.mode === "down") throw new AiError("Gemini answered 503");
  if (apiKey !== undefined && apiKey !== STUB_GEMINI_KEY) throw new AiError("Gemini answered 400: API key not valid");
  const answers = items.map((it) => {
    const a = s.answers?.[it.name.toLowerCase()] ?? "unsure";
    return a === "new" || a === "unsure" ? { name: it.name, verdict: a } : { name: it.name, verdict: "same", id: a };
  });
  return readAnswers({ answers }, items);
}

async function callGemini(items: readonly JudgeItem[], key: string): Promise<Map<string, Verdict>> {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(geminiRequest(items)),
      signal: ctl.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (json as { error?: { message?: string } } | null)?.error?.message;
      throw new AiError(`Gemini answered ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ""}`);
    }
    const text = geminiText(json);
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // unreadable: every name stays unsure
    }
    return readAnswers(parsed, items);
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(`Gemini didn't answer: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Verdicts for `items` (names with their candidates), in batches. `apiKey` tries a key before it is saved; otherwise
 * the saved one. Throws AiError when there's no key or Gemini fails; callers then treat every name as unsure.
 */
export async function judgeWithGemini(items: readonly JudgeItem[], apiKey?: string): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (!items.length) return out;
  const key = isEmulator() ? undefined : (apiKey ?? (await storedGeminiKey()));
  if (!isEmulator() && !key) throw new AiError(AI_NOT_SET_UP);
  for (let i = 0; i < items.length; i += JUDGE_BATCH) {
    const batch = items.slice(i, i + JUDGE_BATCH);
    const v = isEmulator() ? await stubJudge(batch, apiKey) : await callGemini(batch, key!);
    for (const [k, x] of v) out.set(k, x);
  }
  return out;
}
