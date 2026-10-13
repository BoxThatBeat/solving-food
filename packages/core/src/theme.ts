// Per-user theme (R11.9). Names only; the colour values live in the web app's theme module, copied from the
// design prototype's FLAV and ACCENTS tables (CLAUDE.md "Design reference").
//
// M9 (owner review 2): Catppuccin Latte is the only flavour. The four flavour names and the token structure stay so a
// flavour could come back; a stored frappé / macchiato / mocha (older user docs, cached themes) is read as Latte.

export const FLAVOURS = ["latte", "frappe", "macchiato", "mocha"] as const;
export type Flavour = (typeof FLAVOURS)[number];

export const FLAVOUR_LABELS: Record<Flavour, string> = {
  latte: "Latte",
  frappe: "Frappé",
  macchiato: "Macchiato",
  mocha: "Mocha",
};

/** The prototype's ACCENTS list, in its order. The first four entries of the design's picker are green, mauve, peach, blue. */
export const ACCENTS = [
  "green",
  "teal",
  "sapphire",
  "blue",
  "lavender",
  "mauve",
  "pink",
  "flamingo",
  "maroon",
  "red",
  "peach",
  "yellow",
] as const;
export type Accent = (typeof ACCENTS)[number];

export interface Theme {
  flavour: Flavour;
  accent: Accent;
}

/** Latte + green is the reference look (CLAUDE.md). */
export const DEFAULT_THEME: Theme = { flavour: "latte", accent: "green" };

export function isFlavour(v: unknown): v is Flavour {
  return typeof v === "string" && (FLAVOURS as readonly string[]).includes(v);
}

export function isAccent(v: unknown): v is Accent {
  return typeof v === "string" && (ACCENTS as readonly string[]).includes(v);
}

/** The flavours a user can have (M9: Latte only; see the header). */
export const ACTIVE_FLAVOURS: readonly Flavour[] = ["latte"];

/**
 * Coerces anything (a stale localStorage value, an old user doc) into a valid theme. A flavour that isn't active
 * (anything but Latte since M9) becomes Latte; the accent is kept.
 */
export function normalizeTheme(v: unknown): Theme {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return {
    flavour: isFlavour(o.flavour) && ACTIVE_FLAVOURS.includes(o.flavour) ? o.flavour : DEFAULT_THEME.flavour,
    accent: isAccent(o.accent) ? o.accent : DEFAULT_THEME.accent,
  };
}
