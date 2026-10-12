// Ingredient matching (TECHNICAL_SPECS §9 "Unknown ingredients", Planning/M8 item 1). A recipe's wording of an
// ingredient ("2 boneless chicken thighs, diced", "diced green chilies", "M&M's") is matched against every ingredient
// name and alias in tiers, and the weakest tier used is reported as the match's confidence:
//
//   exact    the normalised wording (names.ts `normalizeName`: lower-case, accents, punctuation, singular) is a name or
//            alias;
//   variant  the same after spelling and regional variants are folded (`variantKey`: chile/chili/chilli, m&m's/m&ms,
//            yoghurt, aubergine, courgette, scallion, capsicum, garbanzo, caster/icing sugar, cornflour, rocket, prawn,
//            mince…) on both sides;
//   soft     the same after qualifiers are dropped: anything after a comma or in parentheses, preparation words
//            anywhere (`PREP_WORDS`: chopped, boneless, softened, to taste…), then state words (`STATE_WORDS`: ground,
//            dried, canned, frozen…) when what is left names an ingredient and no "<state> <rest>" one exists.
//
// State words are never dropped onto an ingredient whose own name says the opposite ("dried mint" is not "fresh mint")
// or, for "ground", onto meat or fish ("ground pork" is not "pork loin"). "cooked" is not a state word: "cooked
// chicken" and "cooked rice" are different things to buy than their raw forms.
//
// Pure string work over an index built from the ingredient list; no Firebase.

import { normalizeName } from "./names";

/** Lookup from every normalised name and alias to an ingredient ID (the first claimant: catalogue entries win). */
export type IngredientIndex = Map<string, string>;

export interface IndexEntry {
  id: string;
  name: string;
  aliases: readonly string[];
  /** A merged duplicate: its names resolve to this ingredient instead (M8, "Merge into…"). */
  mergedInto?: string | null;
  /** Incomplete or unreviewed: loses to a reviewed ingredient that claims the same name. */
  needsReview?: boolean;
  category?: string;
}

export type MatchConfidence = "exact" | "variant" | "soft";

export interface IngredientMatch {
  id: string | null;
  confidence: MatchConfidence | null;
}

export interface IngredientSuggestion {
  id: string;
  /** How it matched: a matcher tier, or "similar" (shared words) / "prefix". */
  confidence: MatchConfidence | "similar" | "prefix";
  /** 0..1 for similar / prefix; 1 for a matcher hit. */
  score: number;
}

/**
 * Preparation, size and serving words: dropped anywhere in the wording for a second matching attempt. They describe
 * what the cook does with the ingredient, not what is bought. Multi-word phrases are matched on the normalised text.
 */
export const PREP_WORDS: readonly string[] = [
  "fresh",
  "freshly",
  "large",
  "small",
  "medium",
  "chopped",
  "minced",
  "diced",
  "sliced",
  "organic",
  "whole",
  "raw",
  "boneless",
  "skinless",
  "shredded",
  "grated",
  "crushed",
  "crumbled",
  "ripe",
  "packed",
  "thawed",
  "peeled",
  "seeded",
  "pitted",
  "halved",
  "quartered",
  "cubed",
  "julienned",
  "trimmed",
  "softened",
  "melted",
  "divided",
  "plus",
  "optional",
  "extra",
  "finely",
  "roughly",
  "thinly",
  "coarsely",
  "lightly",
  "about",
  "mild",
  "room temperature",
  "at room temperature",
  "to taste",
  "for serving",
  "for garnish",
  "for topping",
  "or more",
  "cut into pieces",
  "cut into chunks",
  "cut into strips",
];

/**
 * Words that change what is bought: dropped only after the preparation words, only when what is left names an
 * ingredient, and never onto an ingredient whose name says the opposite (see the module comment).
 */
export const STATE_WORDS: readonly string[] = ["ground", "dry", "dried", "canned", "tinned", "frozen", "uncooked"];

/** Only preparation words that never name a product: what `cleanIngredientName` drops from a new ingredient's name. */
const NEW_NAME_DROP = new Set([
  "freshly",
  "chopped",
  "minced",
  "diced",
  "sliced",
  "peeled",
  "seeded",
  "pitted",
  "halved",
  "quartered",
  "cubed",
  "julienned",
  "trimmed",
  "softened",
  "melted",
  "thawed",
  "divided",
  "optional",
  "finely",
  "roughly",
  "thinly",
  "coarsely",
  "lightly",
  "about",
  "plus",
  "mild",
]);

const MEATS = "beef|pork|lamb|chicken|turkey|veal|meat|bison|venison";

/**
 * Spelling, regional and form variants, folded on normalised (singular) text. Both the wording and every indexed name
 * go through it, so the direction only has to be consistent. Ordered: the possessive "s" goes first ("m&m's" →
 * "m and m s" → "m and m").
 */
export const INGREDIENT_VARIANTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^| )s(?= |$)/g, "$1"], // possessive: "confectioner's", "baker's", "m&m's"
  [/\bm and ms\b|\bmms\b|\bm m\b/g, "m and m"], // m&ms, mms, m m
  [/\bchil(?:i|li|e|ly)\b/g, "chile"], // chili, chilli, chile (plurals are singular already)
  [/\byoghurt\b/g, "yogurt"],
  [/\baubergine\b/g, "eggplant"],
  [/\bcourgette\b/g, "zucchini"],
  [/\bcoriander lea(?:f)\b/g, "cilantro"],
  [/\bfresh coriander\b/g, "fresh cilantro"],
  [/\b(?:scallion|spring onion)\b/g, "green onion"],
  [/\bcapsicum\b/g, "bell pepper"],
  [/\bgarbanzo(?: bean)?\b/g, "chickpea"],
  [/\b(?:caster|castor|superfine) sugar\b/g, "caster sugar"],
  [/\b(?:icing|powdered|confectioner|confectioners) sugar\b/g, "icing sugar"],
  [/\bcornflour\b/g, "cornstarch"],
  [/\brocket\b/g, "arugula"],
  [/\bprawn\b/g, "shrimp"],
  [new RegExp(`\\b(${MEATS}) mince\\b`, "g"), "ground $1"],
  [new RegExp(`\\bminced (${MEATS})\\b`, "g"), "ground $1"],
  [/^mince$/g, "ground beef"],
];

/** The variants `INGREDIENT_VARIANTS` folds, readable (the skill's generated reference lists them; a test checks them). */
export const SPELLING_VARIANTS: ReadonlyArray<readonly [canonical: string, others: readonly string[]]> = [
  ["green chile", ["green chili", "green chilli", "green chilies", "green chillies"]],
  ["m&ms", ["m&m's", "m and ms", "mms"]],
  ["yogurt", ["yoghurt"]],
  ["eggplant", ["aubergine"]],
  ["zucchini", ["courgette"]],
  ["cilantro", ["coriander leaves"]],
  ["fresh cilantro", ["fresh coriander"]],
  ["green onion", ["scallion", "spring onion"]],
  ["red bell pepper", ["red capsicum"]],
  ["chickpeas", ["garbanzo beans", "garbanzos"]],
  ["caster sugar", ["superfine sugar"]],
  ["icing sugar", ["powdered sugar", "confectioners' sugar"]],
  ["cornstarch", ["cornflour"]],
  ["arugula", ["rocket"]],
  ["shrimp", ["prawns"]],
  ["ground beef", ["beef mince", "minced beef", "mince"]],
  ["ground pork", ["pork mince", "minced pork"]],
];

/** Folds spelling and regional variants of normalised text ("diced green chilli" → "diced green chile"). */
export function variantKey(normalised: string): string {
  let s = normalised;
  for (const [re, to] of INGREDIENT_VARIANTS) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

// ---------- the index

interface IndexMeta {
  /** Every claimant of a normalised name, in priority order. */
  all: Map<string, string[]>;
  /** Every claimant of a variant key, in priority order. */
  variants: Map<string, string[]>;
  info: Map<string, { name: string; category?: string }>;
  /** Suggestion words per normalised name, computed on first use. */
  tokens?: Map<string, Set<string>>;
}

const META = new WeakMap<IngredientIndex, IndexMeta>();

function push(m: Map<string, string[]>, k: string, id: string) {
  if (!k) return;
  const l = m.get(k);
  if (!l) m.set(k, [id]);
  else if (!l.includes(id)) l.push(id);
}

/**
 * Builds the lookup from every normalised name and alias to an ingredient ID. When two ingredients claim a name, a
 * reviewed one wins over one that needs review. A merged duplicate's names resolve to the ingredient it was merged
 * into (following chains).
 */
export function buildIngredientIndex(list: Iterable<IndexEntry>): IngredientIndex {
  const entries = [...list];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const finalId = (id: string): string => {
    let cur = id;
    for (let n = 0; n < 10; n++) {
      const next = byId.get(cur)?.mergedInto;
      if (!next || next === cur) return cur;
      cur = next;
    }
    return cur;
  };
  const rank = (e: IndexEntry) => (e.mergedInto ? 2 : e.needsReview ? 1 : 0);
  const ordered = entries.map((e, k) => ({ e, k })).sort((a, b) => rank(a.e) - rank(b.e) || a.k - b.k);
  const idx: IngredientIndex = new Map();
  const meta: IndexMeta = { all: new Map(), variants: new Map(), info: new Map() };
  for (const { e } of ordered) {
    const target = e.mergedInto ? finalId(e.id) : e.id;
    if (!e.mergedInto) meta.info.set(e.id, { name: e.name, ...(e.category ? { category: e.category } : {}) });
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const k = normalizeName(n);
      if (!k) continue;
      if (!idx.has(k)) idx.set(k, target);
      push(meta.all, k, target);
      push(meta.variants, variantKey(k), target);
    }
  }
  META.set(idx, meta);
  return idx;
}

/** The sidecar of an index; built from the bare map for indexes made by hand (tests). */
function metaOf(index: IngredientIndex): IndexMeta {
  let m = META.get(index);
  if (m) return m;
  m = { all: new Map(), variants: new Map(), info: new Map() };
  for (const [k, id] of index) {
    push(m.all, k, id);
    push(m.variants, variantKey(k), id);
    if (!m.info.has(id)) m.info.set(id, { name: k });
  }
  META.set(index, m);
  return m;
}

// ---------- matching

const normalisedWords = new WeakMap<readonly string[], string[]>();

function stripPhrases(n: string, list: readonly string[]): { text: string; removed: string[] } {
  let words = normalisedWords.get(list);
  if (!words) {
    // Normalised like the text ("cut into pieces" → "cut into piece"), longest first so "at room temperature" goes
    // before "room temperature".
    words = list.map(normalizeName).sort((a, b) => b.length - a.length);
    normalisedWords.set(list, words);
  }
  const removed: string[] = [];
  let s = ` ${n} `;
  for (const w of words) {
    const needle = ` ${w} `;
    while (s.includes(needle)) {
      s = s.replace(needle, " ");
      removed.push(w);
    }
  }
  return { text: s.replace(/\s+/g, " ").trim(), removed };
}

/** Drops text after the first comma and anything in parentheses or brackets: "butter (softened)", "thighs, boneless". */
function stripQualifiers(raw: string): string {
  const noParens = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const head = noParens.split(/[,;]/)[0] ?? "";
  return head.trim() ? head : noParens;
}

const OPPOSITE_OF_STATE = /\b(fresh|raw)\b/;

function stateAllowed(removed: string[], targetId: string, meta: IndexMeta): boolean {
  const info = meta.info.get(targetId);
  const name = info ? normalizeName(info.name) : "";
  if (removed.some((w) => w !== "ground") && OPPOSITE_OF_STATE.test(name)) return false;
  if (removed.includes("ground") && (info?.category === "meat" || info?.category === "fish")) return false;
  return true;
}

function lookup(meta: IndexMeta, key: string, exclude: ReadonlySet<string>, variant: boolean): string | null {
  const l = (variant ? meta.variants.get(variantKey(key)) : meta.all.get(key)) ?? [];
  return l.find((id) => !exclude.has(id)) ?? null;
}

function excludeSet(opts?: { exclude?: string | readonly string[] }): ReadonlySet<string> {
  const e = opts?.exclude;
  return new Set(e === undefined ? [] : typeof e === "string" ? [e] : e);
}

/**
 * Matches a recipe's wording to an ingredient: exact, then spelling variants, then without qualifiers, preparation and
 * state words. `exclude` ignores some IDs (an ingredient being reviewed against the others).
 */
export function matchIngredient(name: string, index: IngredientIndex, opts?: { exclude?: string | readonly string[] }): IngredientMatch {
  const meta = metaOf(index);
  const exclude = excludeSet(opts);
  const n = normalizeName(name);
  if (!n) return { id: null, confidence: null };
  const exact = lookup(meta, n, exclude, false);
  if (exact) return { id: exact, confidence: "exact" };
  const variant = lookup(meta, n, exclude, true);
  if (variant) return { id: variant, confidence: "variant" };

  // Soft: qualifiers, then preparation words, then state words.
  const base = normalizeName(stripQualifiers(name));
  const prep = stripPhrases(base, PREP_WORDS).text;
  for (const k of [base, prep]) {
    if (!k) continue;
    const hit = lookup(meta, k, exclude, false) ?? lookup(meta, k, exclude, true);
    if (hit) return { id: hit, confidence: "soft" };
  }
  const state = stripPhrases(prep, STATE_WORDS);
  if (state.text && state.removed.length) {
    const hit = lookup(meta, state.text, exclude, false) ?? lookup(meta, state.text, exclude, true);
    if (hit && stateAllowed(state.removed, hit, meta)) return { id: hit, confidence: "soft" };
  }
  return { id: null, confidence: null };
}

/** Resolves a recipe's wording to an ingredient ID (`matchIngredient` at any confidence), or null. */
export function resolveIngredientName(name: string, index: IngredientIndex): string | null {
  return matchIngredient(name, index).id;
}

// ---------- new ingredients

/**
 * The name a new ingredient gets from a recipe's wording: qualifiers after a comma or in parentheses and pure
 * preparation words are dropped ("diced green chilies" → "green chilies", "butter (softened)" → "butter"); state and
 * form words that describe the product stay ("frozen peas", "shredded cheese", "canned chicken").
 */
export function cleanIngredientName(name: string): string {
  const lower = stripQualifiers(name.trim().toLowerCase()).replace(/\s+/g, " ").trim();
  const words = lower.split(" ");
  const meat = new RegExp(`^(${MEATS})`);
  const kept = words.filter((w, k) => {
    const n = normalizeName(w);
    if (!NEW_NAME_DROP.has(n)) return true;
    // "minced beef" is ground beef, not beef.
    return n === "minced" && meat.test(normalizeName(words[k + 1] ?? ""));
  });
  const out = kept.join(" ").trim();
  return out || name.trim().toLowerCase();
}

/** A new ingredient's document ID: the kebab-case variant key, so spelling variants of one name share it. */
export function newIngredientId(name: string): string {
  return variantKey(normalizeName(name)).replace(/\s+/g, "-") || "ingredient";
}

// ---------- suggestions

function tokens(s: string): Set<string> {
  const t = variantKey(stripPhrases(normalizeName(stripQualifiers(s)), PREP_WORDS).text);
  return new Set(t.split(" ").filter(Boolean));
}

function jaccardOf(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const RANK: Record<IngredientSuggestion["confidence"], number> = { exact: 4, variant: 3, soft: 2, similar: 1, prefix: 1 };

/**
 * Ranked candidates an ingredient's wording may mean, for review ("Looks like: chicken thigh · green chile"): the
 * matcher's hit first (exact → variant → soft), then shared words (Jaccard on normalised words ≥ 0.3) and prefixes.
 */
export function suggestIngredients(name: string, index: IngredientIndex, max = 5, opts?: { exclude?: string | readonly string[] }): IngredientSuggestion[] {
  const meta = metaOf(index);
  const exclude = excludeSet(opts);
  const best = new Map<string, IngredientSuggestion>();
  const offer = (s: IngredientSuggestion) => {
    if (exclude.has(s.id)) return;
    const cur = best.get(s.id);
    if (!cur || RANK[s.confidence] > RANK[cur.confidence] || (RANK[s.confidence] === RANK[cur.confidence] && s.score > cur.score)) best.set(s.id, s);
  };
  const m = matchIngredient(name, index, opts);
  if (m.id && m.confidence) offer({ id: m.id, confidence: m.confidence, score: 1 });

  const q = tokens(name);
  const qKey = [...q].join(" ");
  if (q.size) {
    meta.tokens ??= new Map([...meta.all.keys()].map((k) => [k, tokens(k)]));
    for (const [k, ids] of meta.all) {
      const t = meta.tokens.get(k)!;
      const j = jaccardOf(q, t);
      const tKey = [...t].join(" ");
      const prefix = qKey.length >= 3 && tKey.length >= 3 && (tKey.startsWith(qKey) || qKey.startsWith(tKey));
      if (j < 0.3 && !prefix) continue;
      // The same words in another order ("milk chocolate" / "chocolate milk") are not quite the same thing.
      const score = j === 1 && tKey !== qKey ? 0.9 : j;
      for (const id of ids) {
        if (j >= 0.3) offer({ id, confidence: "similar", score });
        else offer({ id, confidence: "prefix", score: 0.25 });
      }
    }
  }
  const nameLen = (id: string) => meta.info.get(id)?.name.length ?? 99;
  return [...best.values()]
    .sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.score - a.score || nameLen(a.id) - nameLen(b.id) || a.id.localeCompare(b.id))
    .slice(0, max);
}
