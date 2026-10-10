import { normalizeTheme, type Theme } from "@solving-food/core";
import { ACCENT_HEX, FLAV, LOOK, LOOKS } from "./tokens";

const STORAGE_KEY = "sf.theme";

/** The CSS custom properties for a theme, named as in the prototype (without the leading `--`). */
export function themeVars(theme: Theme): Record<string, string> {
  const f = FLAV[theme.flavour];
  return { ...f, line: f.ink, acc: ACCENT_HEX[theme.accent], ...LOOKS[LOOK] };
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const vars = themeVars(theme);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  root.dataset.flavour = theme.flavour;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", vars.pg ?? "");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, vars }));
  } catch {
    // Private mode or storage full: the theme still applies, it just isn't cached for the next load.
  }
}

/** The theme cached by the last applyTheme (the localStorage mirror of users/{uid}.theme). */
export function cachedTheme(): Theme {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { theme?: unknown } | null;
    return normalizeTheme(raw?.theme);
  } catch {
    return normalizeTheme(null);
  }
}
