// Ingredient name normalisation (TECHNICAL_SPECS §5 "Ingredient picker", §9 "Unknown ingredients").
// Used to match a recipe's ingredient wording ("All-Purpose Flour", "eggs") against ingredient names and aliases,
// both in the drop-folder importer and in the typeahead. Pure string work, no data.

const IRREGULAR: Record<string, string> = {
  leaves: "leaf",
  loaves: "loaf",
  halves: "half",
  knives: "knife",
  potatoes: "potato",
  tomatoes: "tomato",
  mangoes: "mango",
  avocados: "avocado",
  radishes: "radish",
  peaches: "peach",
  squashes: "squash",
  dishes: "dish",
  anchovies: "anchovy",
  cherries: "cherry",
  berries: "berry",
  chilies: "chili",
  chiles: "chile",
  chillies: "chilli",
  molasses: "molasses",
  hummus: "hummus",
  couscous: "couscous",
  asparagus: "asparagus",
  citrus: "citrus",
  swiss: "swiss",
  oats: "oat",
  grits: "grits",
  greens: "green",
  peas: "pea",
  lentils: "lentil",
  chickpeas: "chickpea",
  noodles: "noodle",
  cloves: "clove",
};

/** Never singularised: these end in "s" but aren't plurals. */
const KEEP = new Set([
  "molasses",
  "hummus",
  "couscous",
  "asparagus",
  "citrus",
  "swiss",
  "grits",
  "bass",
  "brussels",
  "watercress",
  "cress",
  "series",
  "species",
  "harissa",
  "quinoa",
  "tapas",
  "mascarpone",
  "gras",
  "glass",
  "lemongrass",
  "bitters",
  "schnapps",
  "jus",
  "tahini",
]);

/** Singularise one English word, conservatively. */
export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (KEEP.has(w)) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/**
 * Canonical matching key: lower-case, accents stripped, punctuation and hyphens to spaces, whitespace collapsed,
 * every word singularised. "All-Purpose Flour" → "all purpose flour"; "Eggs" → "egg";
 * "boneless, skinless chicken breasts" → "boneless skinless chicken breast".
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .join(" ");
}

/** Document ID for an ingredient name: kebab-case of the normalised name. */
export function ingredientSlug(name: string): string {
  return normalizeName(name).replace(/\s+/g, "-") || "ingredient";
}

/** URL-safe kebab-case of a title (recipes). Keeps plurals, unlike `ingredientSlug`. */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "recipe"
  );
}
