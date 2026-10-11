// Household food preferences (PRD R11.2; TECHNICAL_SPECS §4.2 `settings.preferences`, §7 "Suggestion score").
//
// Likes and dislikes are typed strings so one list can hold foods, cuisines, main proteins, and free words:
//   "ingredient:<id>"   an ingredient from the seed ("ingredient:salmon-fillet")
//   "cuisine:<c>"       a cuisine from the fixed list ("cuisine:italian")
//   "protein:<p>"       a main protein from the fixed list ("protein:pork")
//   "text:<word>"       anything else, matched against the title, ingredient wording, and tags ("text:olive")
// Diets are keys of DIETS. Likes raise the `preferences` factor; dislikes and diets are hard filters for suggestions
// and the optimiser, and sink a recipe to the bottom of the Suggested sort (it is still listed: a sort never hides).

import { CUISINES, MAIN_PROTEINS, type MainProtein } from "./taxonomy";
import { taxonomyLabel } from "./collection";

export const PREF_KINDS = ["ingredient", "cuisine", "protein", "text"] as const;
export type PrefKind = (typeof PREF_KINDS)[number];

export interface Pref {
  kind: PrefKind;
  value: string;
}

export const PREF_MAX = 40;
export const PREF_TEXT_MAX = 40;

/** "cuisine:italian" → { kind, value }. Unknown kinds and empty values are null. */
export function parsePref(s: string): Pref | null {
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const kind = s.slice(0, i) as PrefKind;
  const value = s.slice(i + 1).trim();
  if (!(PREF_KINDS as readonly string[]).includes(kind) || !value) return null;
  if (kind === "cuisine" && !(CUISINES as readonly string[]).includes(value)) return null;
  if (kind === "protein" && !(MAIN_PROTEINS as readonly string[]).includes(value)) return null;
  return { kind, value };
}

export function formatPref(p: Pref): string {
  return `${p.kind}:${p.kind === "text" ? p.value.trim().toLowerCase().slice(0, PREF_TEXT_MAX) : p.value}`;
}

/** What a chip says: "Italian", "Pork", "Salmon fillet", "“olive”". */
export function prefLabel(s: string, ingredientName?: (id: string) => string | undefined): string {
  const p = parsePref(s);
  if (!p) return s;
  if (p.kind === "cuisine" || p.kind === "protein") return taxonomyLabel(p.value);
  if (p.kind === "ingredient") {
    const n = ingredientName?.(p.value) ?? p.value.replace(/-/g, " ");
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  return `“${p.value}”`;
}

/** The facts of a recipe preferences and diets look at. */
export interface PrefRecipe {
  title: string;
  cuisine: string;
  mainProtein: string;
  tags: readonly string[];
  ingredientIds: readonly string[];
  /** The recipe's wording of its ingredients ("fresh basil"), lower case. */
  ingredientNames?: readonly string[];
}

export interface IngredientMeta {
  category: string;
  name?: string;
  freeUse?: boolean;
}

export type IngredientMetaOf = (id: string) => IngredientMeta | undefined;

function wordMatch(hay: string, word: string): boolean {
  return hay.toLowerCase().includes(word.toLowerCase());
}

/** Does one preference entry match a recipe? */
export function matchesPref(r: PrefRecipe, s: string, meta?: IngredientMetaOf): boolean {
  const p = parsePref(s);
  if (!p) return false;
  switch (p.kind) {
    case "cuisine":
      return r.cuisine === p.value;
    case "protein":
      return r.mainProtein === p.value;
    case "ingredient":
      return r.ingredientIds.includes(p.value);
    case "text": {
      const w = p.value;
      if (wordMatch(r.title, w)) return true;
      if (r.tags.some((t) => wordMatch(t, w))) return true;
      if (r.ingredientNames?.some((n) => wordMatch(n, w))) return true;
      return r.ingredientIds.some((id) => wordMatch(id.replace(/-/g, " "), w) || (meta?.(id)?.name ? wordMatch(meta(id)!.name!, w) : false));
    }
  }
}

/** The entries of `list` that match the recipe (for "You like Italian" and "Disliked: olives"). */
export function matchingPrefs(r: PrefRecipe, list: readonly string[], meta?: IngredientMetaOf): string[] {
  return list.filter((s) => matchesPref(r, s, meta));
}

// ---------- diets (hard filters)

const MEATS: readonly MainProtein[] = ["beef", "pork", "chicken", "turkey", "lamb"];
const FISHES: readonly MainProtein[] = ["fish", "seafood"];
const idHas = (re: RegExp) => (id: string) => re.test(id);
const isEgg = idHas(/(^|-)eggs?($|-)|egg-(white|yolk)|mayonnaise|^mayo/);
const isHoney = idHas(/honey/);
const isGluten = (id: string) =>
  /(flour|bread|pasta|spaghetti|penne|macaroni|linguine|fettuccine|lasagna|noodle|wheat|barley|couscous|bulgur|farro|semolina|tortilla|pita|naan|panko|breadcrumb|cracker|soy-sauce|beer|orzo|rye|bagel|bun|croissant|pizza-dough|puff-pastry|gnocchi|seitan)/.test(id) &&
  !/(rice-flour|almond-flour|coconut-flour|corn-tortilla|rice-noodle|gluten-free|tamari|cornstarch|buckwheat)/.test(id);
const isNut = idHas(/(almond|cashew|peanut|walnut|pecan|pistachio|hazelnut|pine-nut|macadamia|brazil-nut|nut-butter|mixed-nuts|praline|marzipan|nutella)/);
const isPork = idHas(/(pork|bacon|ham($|-)|prosciutto|pancetta|chorizo|salami|pepperoni|lard|guanciale)/);
const isShellfish = idHas(/(shrimp|prawn|crab|lobster|scallop|mussel|clam|oyster|squid|calamari)/);

export interface Diet {
  key: string;
  label: string;
  /** True when the recipe breaks the diet. */
  violates: (r: PrefRecipe, meta: IngredientMetaOf) => boolean;
}

const cat = (meta: IngredientMetaOf, id: string) => meta(id)?.category;

export const DIETS: readonly Diet[] = [
  {
    key: "vegetarian",
    label: "Vegetarian",
    violates: (r, m) => MEATS.includes(r.mainProtein as MainProtein) || FISHES.includes(r.mainProtein as MainProtein) || r.ingredientIds.some((id) => cat(m, id) === "meat" || cat(m, id) === "fish"),
  },
  {
    key: "vegan",
    label: "Vegan",
    violates: (r, m) =>
      DIETS[0]!.violates(r, m) || ["eggs", "dairy"].includes(r.mainProtein) || r.ingredientIds.some((id) => cat(m, id) === "dairy" || isEgg(id) || isHoney(id)),
  },
  {
    key: "pescatarian",
    label: "Pescatarian",
    violates: (r, m) => MEATS.includes(r.mainProtein as MainProtein) || r.ingredientIds.some((id) => cat(m, id) === "meat"),
  },
  { key: "gluten-free", label: "Gluten-free", violates: (r) => r.ingredientIds.some(isGluten) },
  { key: "dairy-free", label: "Dairy-free", violates: (r, m) => r.mainProtein === "dairy" || r.ingredientIds.some((id) => cat(m, id) === "dairy") },
  { key: "nut-free", label: "Nut-free", violates: (r) => r.ingredientIds.some(isNut) },
  { key: "no-pork", label: "No pork", violates: (r) => r.mainProtein === "pork" || r.ingredientIds.some(isPork) },
  { key: "no-shellfish", label: "No shellfish", violates: (r) => r.mainProtein === "seafood" || r.ingredientIds.some(isShellfish) },
];

export const DIET_KEYS = DIETS.map((d) => d.key);

export function dietLabel(key: string): string {
  return DIETS.find((d) => d.key === key)?.label ?? key;
}

/** Diets the recipe breaks (labels), in DIETS order. */
export function brokenDiets(r: PrefRecipe, diets: readonly string[], meta: IngredientMetaOf): string[] {
  return DIETS.filter((d) => diets.includes(d.key) && d.violates(r, meta)).map((d) => d.label);
}

export interface Preferences {
  likes: readonly string[];
  dislikes: readonly string[];
  diets: readonly string[];
}

export const NO_PREFERENCES: Preferences = { likes: [], dislikes: [], diets: [] };

/** Why a recipe is filtered out by preferences (dislike or diet), or null when it isn't. */
export function preferenceBlock(r: PrefRecipe, prefs: Preferences, meta: IngredientMetaOf, name?: (id: string) => string | undefined): string | null {
  const d = brokenDiets(r, prefs.diets, meta);
  if (d.length) return `Not ${d[0]!.toLowerCase()}`;
  const dis = matchingPrefs(r, prefs.dislikes, meta);
  if (dis.length) return `Disliked: ${prefLabel(dis[0]!, name).toLowerCase()}`;
  return null;
}

/** Adds an entry to a preference list (deduplicated, capped). */
export function addPref(list: readonly string[], entry: string): string[] {
  if (!parsePref(entry) || list.includes(entry)) return [...list];
  return [...list, entry].slice(-PREF_MAX);
}
