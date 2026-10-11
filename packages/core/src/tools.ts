// Kitchen tool names (PRD R11.1, R4.14; TECHNICAL_SPECS §9 "Kitchen tools", M7). Recipes name their cookware freely
// ("large skillet", "frying pan", "9x13-inch baking dish"); households list what they own ("Skillet"). Names are shown
// lower-case everywhere (`toolLabel`) and compared by `toolKey`, so owning "skillet" satisfies "frying pan". Stored
// names are never rewritten.

/** Canonical tool → the other names (already normalised: lower-case, no sizes, singular) that mean the same tool. */
export const TOOL_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  "instant pot": ["pressure cooker", "multicooker", "multi cooker", "electric pressure cooker"],
  "slow cooker": ["crockpot", "crock pot"],
  "sheet pan": ["baking sheet", "half sheet pan", "baking tray", "cookie sheet", "tray", "rimmed baking sheet", "sheet tray"],
  skillet: ["frying pan", "fry pan", "pan", "saute pan", "high sided pan", "cast iron skillet", "cast iron pan", "nonstick pan", "nonstick skillet"],
  pot: ["saucepan", "sauce pan", "soup pot", "stock pot", "stockpot"],
  bowl: ["mixing bowl", "serving bowl", "microwave safe bowl"],
  "baking dish": ["casserole dish", "baking pan", "square pan", "aluminum pan", "square baking dish"],
  "muffin tin": ["muffin pan", "muffin tray", "cupcake pan", "cupcake tin"],
  "loaf pan": ["loaf tin"],
  "cake pan": ["round cake pan"],
  "pie dish": ["pie plate", "pie pan"],
  "wire rack": ["cooling rack", "wire cooling rack", "baking rack"],
  "food processor": [],
  "stand mixer": ["mixer", "electric mixer"],
  "hand mixer": [],
  blender: ["high speed blender"],
  "immersion blender": ["hand blender", "stick blender"],
  "air fryer": [],
  "dutch oven": [],
  "cutting board": ["chopping board"],
  whisk: [],
  grater: ["box grater", "cheese grater"],
  spatula: ["rubber spatula"],
  strainer: ["colander", "sieve", "fine mesh strainer"],
  scoop: ["ice cream scoop", "cookie scoop"],
  thermometer: ["meat thermometer", "instant read thermometer"],
  knife: ["chef knife", "chefs knife"],
  jar: ["mason jar"],
  fridge: ["refrigerator"],
  foil: ["aluminum foil", "tin foil"],
  "freezer bag": ["zip top bag", "ziploc bag"],
  skewer: ["wooden skewer"],
};

const ALIAS = new Map<string, string>();
for (const [canon, alts] of Object.entries(TOOL_SYNONYMS)) {
  ALIAS.set(canon, canon);
  for (const a of alts) ALIAS.set(a, canon);
}

/** Size and material words that don't change which tool it is ("large", "oven-safe", "nonstick"…). */
const QUALIFIERS = /\b(?:extra|large|medium|small|mini|big|shallow|deep|rimmed|round|metal|glass|ceramic|heavy(?: bottomed)?|oven safe|ovenproof|oven proof|disposable|digital|sharp|good|sturdy|clean|wide|tall|non stick|nonstick)\b/g;
const KEEP_PLURAL = new Set(["tongs", "scissors", "shears", "chopsticks", "bellows"]);

function singular(word: string): string {
  if (KEEP_PLURAL.has(word) || word.endsWith("ss") || word.length <= 3) return word;
  if (word.endsWith("ives")) return `${word.slice(0, -3)}fe`; // knives
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/**
 * The canonical key of a tool name: lower-case, accents and punctuation dropped, sizes ("9x13-inch", "12-cup",
 * "3.5-quart") and qualifiers ("large", "oven-safe") removed, the last word singular, then the synonym table. A bare
 * "pan" with a size ("9x13 inch pan") is a baking dish; without one it's a skillet. Idempotent and case-insensitive.
 */
export function toolKey(name: string): string {
  // Each pass can expose more to strip ("large or pan"); repeat until stable so the key is idempotent.
  let k = name;
  for (let i = 0; i < 6; i++) {
    const next = keyPass(k);
    if (next === k) break;
    k = next;
  }
  return k;
}

function keyPass(name: string): string {
  let s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9.\s]/g, " ");
  const sized = /\d/.test(s);
  s = s
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|by)\s*\d+(?:\.\d+)?(?:\s*(?:inches|inch|in|cm))?\b/g, " ") // 9x13, 8 by 8, 9x2 inch
    .replace(/\b\d+(?:\.\d+)?\s*(?:inches|inch|in|quarts|quart|qt|ounces|ounce|oz|cups|cup|count|cavity|piece|litres|liters|litre|liter|l|cm)?\b/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:or|and|a|an|the)\s+/, "")
    .replace(/\bdeep dish\s+(?=pie)/, "")
    .replace(QUALIFIERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:or|and|a|an|the)\s+/, "");
  if (!s) return name.trim().toLowerCase();
  const words = s.split(" ");
  const last = words.pop()!;
  s = [...words, singular(last)].join(" ");
  if (KEEP_PLURAL.has(s)) return s;
  if (sized && s === "pan") return "baking dish";
  return ALIAS.get(s) ?? s;
}

/** How a tool name is shown: lower-case, trimmed, whitespace collapsed (storage keeps whatever was typed). */
export function toolLabel(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Tools a recipe needs that the household doesn't own, compared by `toolKey` (owning "skillet" covers "frying pan"). */
export function missingTools(recipeTools: readonly string[], householdTools: readonly string[]): string[] {
  const have = new Set(householdTools.map(toolKey));
  return recipeTools.filter((t) => !have.has(toolKey(t)));
}

export interface ToolGroup {
  key: string;
  /** Shown on the chip: the key itself (the canonical name, or the plainest spelling: "wok" for "large wok"). */
  label: string;
  /** The other spellings seen, lower-case, most common first ("also: frying pan, pan"). */
  also: string[];
}

/** One entry per tool key over all the given names (Settings → Kitchen tools suggestions). Sorted by label. */
export function groupTools(names: Iterable<string>): ToolGroup[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const n of names) {
    const label = toolLabel(n);
    if (!label) continue;
    const k = toolKey(n);
    const m = byKey.get(k) ?? new Map<string, number>();
    m.set(label, (m.get(label) ?? 0) + 1);
    byKey.set(k, m);
  }
  const out: ToolGroup[] = [];
  for (const [key, m] of byKey) {
    const spellings = [...m].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).map(([s]) => s);
    const label = key;
    out.push({ key, label, also: spellings.filter((s) => s !== label) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
