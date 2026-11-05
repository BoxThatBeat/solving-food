// Where "/" goes (R12 landing, M23): Plan when the active household's current period has items, else Recipes. The
// shell's plan model writes the answer to this device whenever its plan items load, so opening the app redirects at
// once from what the last visit saw; only a first visit on this device asks Firestore.
const KEY = "sf.landing";

export function rememberLanding(hid: string, hasItems: boolean): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
    if (all[hid] === hasItems) return;
    localStorage.setItem(KEY, JSON.stringify({ ...all, [hid]: hasItems }));
  } catch {
    /* storage blocked: "/" asks Firestore */
  }
}

export function rememberedLanding(hid: string): boolean | null {
  try {
    const v = (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>)[hid];
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}
