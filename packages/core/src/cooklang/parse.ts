// A small Cooklang parser (https://cooklang.org/docs/spec/) for drop-folder imports (TECHNICAL_SPECS §9).
//
// Why not @cooklang/cooklang-ts: it predates YAML front matter (our required metadata), sections and notes, and is
// not maintained. The subset here covers what the Claude skill emits and the 28 household recipes use: YAML front
// matter (and legacy `>> key: value` lines), ingredients (single- and multi-word, `?` optional modifier, `(note)`),
// cookware, timers (named or not), `= sections`, `-- comments`, `[- block comments -]`, and `> notes`.
// The zod front-matter schema is the contract, not the parser (Planning/M1 risks).

import { parse as parseYaml } from "yaml";

export interface CookQuantity {
  /** Numeric amount, or null when absent or not a number ("a few"). */
  amount: number | null;
  /** The amount as written ("1/2", "a few", ""). */
  text: string;
  /** Unit as written ("cups", "Tbsp", ""). */
  unit: string;
}

export type CookItem =
  | { type: "text"; value: string }
  | { type: "ingredient"; name: string; quantity: CookQuantity; optional: boolean; note?: string }
  | { type: "cookware"; name: string; quantity: CookQuantity }
  | { type: "timer"; name: string; quantity: CookQuantity };

export interface CookStep {
  section?: string;
  items: CookItem[];
}

export interface CookDocument {
  frontMatter: Record<string, unknown>;
  steps: CookStep[];
  /** Line and block comments plus `>` notes, in order. */
  comments: string[];
}

export class CooklangError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CooklangError";
  }
}

const VULGAR: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

/** "2", "0.5", "1/2", "1 1/2", "1½", "½", "2-3" (→ 2.5), "1,5" (→ 1.5). Null when not a number. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/(\d),(\d)/g, "$1.$2");
  if (!t) return null;
  const range = /^(.+?)\s*[-–]\s*(.+)$/.exec(t);
  if (range) {
    const a = parseAmount(range[1]!);
    const b = parseAmount(range[2]!);
    return a !== null && b !== null ? (a + b) / 2 : null;
  }
  const vulgar = /^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(t);
  if (vulgar) return Number(vulgar[1] ?? 0) + VULGAR[vulgar[2]!]!;
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  if (/^\d*\.?\d+$/.test(t)) return Number(t);
  return null;
}

function parseQuantity(raw: string | undefined): CookQuantity {
  if (raw === undefined) return { amount: null, text: "", unit: "" };
  const i = raw.indexOf("%");
  const text = (i >= 0 ? raw.slice(0, i) : raw).trim();
  const unit = i >= 0 ? raw.slice(i + 1).trim() : "";
  return { amount: parseAmount(text), text, unit };
}

/** Splits the YAML front matter (`---` … `---`) or legacy `>> key: value` lines from the body. */
export function splitFrontMatter(source: string): { frontMatter: Record<string, unknown>; body: string } {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
  if (m) {
    let data: unknown;
    try {
      data = parseYaml(m[1]!);
    } catch (e) {
      throw new CooklangError(`Front matter isn't valid YAML: ${(e as Error).message.split("\n")[0]}`);
    }
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
      throw new CooklangError("Front matter must be a set of key: value pairs");
    }
    return { frontMatter: (data ?? {}) as Record<string, unknown>, body: m[2]! };
  }
  // Legacy metadata: `>> key: value` lines anywhere.
  const fm: Record<string, unknown> = {};
  const body = text
    .split("\n")
    .filter((line) => {
      const meta = /^>>\s*([^:]+):\s*(.*)$/.exec(line);
      if (!meta) return true;
      fm[meta[1]!.trim()] = meta[2]!.trim();
      return false;
    })
    .join("\n");
  return { frontMatter: fm, body };
}

const TOKEN_START = /[@#~]/;

/** Parses one paragraph's text into items. */
function parseInline(text: string): CookItem[] {
  const items: CookItem[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) items.push({ type: "text", value: buf });
    buf = "";
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (!TOKEN_START.test(ch)) {
      buf += ch;
      i++;
      continue;
    }
    const rest = text.slice(i + 1);
    let mod = "";
    if (ch === "@") mod = /^[?&\-+=]*/.exec(rest)![0];
    const afterMod = rest.slice(mod.length);
    // Multi-word: name up to `{` with no other token marker or brace in between.
    const braced = /^([^@#~{}\n]*?)\{([^}]*)\}(?:\(([^)]*)\))?/.exec(afterMod);
    // Single word: letters, digits, apostrophes, hyphens and underscores.
    const word = /^([\p{L}\p{N}_'’-]+)(?:\(([^)]*)\))?/u.exec(afterMod);
    let name: string | null = null;
    let qtyRaw: string | undefined;
    let note: string | undefined;
    let consumed = 0;
    if (braced && (braced[1]!.trim() !== "" || ch === "~")) {
      name = braced[1]!.trim();
      qtyRaw = braced[2];
      note = braced[3];
      consumed = braced[0].length;
    } else if (word && ch !== "~") {
      name = word[1]!.replace(/[-'’]+$/, "");
      if (name.length === word[1]!.length) {
        note = word[2];
        consumed = word[0].length;
      } else {
        consumed = name.length; // a trailing hyphen or apostrophe belongs to the text
      }
    }
    if (name === null || (name === "" && ch !== "~")) {
      buf += ch;
      i++;
      continue;
    }
    flush();
    const quantity = parseQuantity(qtyRaw);
    if (ch === "@") {
      const item: CookItem = { type: "ingredient", name, quantity, optional: mod.includes("?") };
      if (note?.trim()) item.note = note.trim();
      items.push(item);
    } else if (ch === "#") {
      items.push({ type: "cookware", name, quantity });
    } else {
      items.push({ type: "timer", name, quantity });
    }
    i += 1 + mod.length + consumed;
  }
  flush();
  return items;
}

/** Parses a whole `.cook` file. Throws `CooklangError` for malformed front matter or unbalanced braces. */
export function parseCooklang(source: string): CookDocument {
  const { frontMatter, body } = splitFrontMatter(source);
  const comments: string[] = [];
  // Block comments first; they can span lines.
  let text = body.replace(/\[-([\s\S]*?)-\]/g, (_, c: string) => {
    if (c.trim()) comments.push(c.trim());
    return "";
  });
  const open = (text.match(/\{/g) ?? []).length;
  const close = (text.match(/\}/g) ?? []).length;
  if (open !== close) throw new CooklangError(`Unbalanced braces in the recipe body (${open} "{" vs ${close} "}")`);

  const steps: CookStep[] = [];
  let section: string | undefined;
  let para: string[] = [];
  const endPara = () => {
    const joined = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (!joined) return;
    const step: CookStep = { items: parseInline(joined) };
    if (section !== undefined) step.section = section;
    steps.push(step);
  };
  text = text.replace(/\r/g, "");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      endPara();
      continue;
    }
    if (line.startsWith("--")) {
      const c = line.replace(/^--\s?/, "").trim();
      if (c) comments.push(c);
      continue;
    }
    const sec = /^=+\s*(.*?)\s*=*$/.exec(line);
    if (sec) {
      endPara();
      section = sec[1] || undefined;
      continue;
    }
    if (line.startsWith(">") && !line.startsWith(">>")) {
      endPara();
      const n = line.replace(/^>\s?/, "").trim();
      if (n) comments.push(n);
      continue;
    }
    // Trailing inline comment: " -- like this".
    const inline = /^(.*?)\s+--\s(.*)$/.exec(line);
    if (inline) {
      if (inline[2]!.trim()) comments.push(inline[2]!.trim());
      para.push(inline[1]!);
    } else {
      para.push(line);
    }
  }
  endPara();
  return { frontMatter, steps, comments };
}
