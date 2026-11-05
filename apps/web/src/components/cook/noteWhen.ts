// When and by whom a cook note was left (M28, R4.38): "12 Oct, Aaron".
import type { CookNote } from "@solving-food/core";

/** "12 Oct" in the household's time zone. */
export function noteDate(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(ms));
  }
}

/** "12 Oct, Aaron": the date and the cook's first name. */
export function noteWhen(n: Pick<CookNote, "cookedAtMs" | "cookedBy">, names: ReadonlyMap<string, string>, tz: string): string {
  const who = names.get(n.cookedBy)?.trim().split(/\s+/)[0];
  return who ? `${noteDate(n.cookedAtMs, tz)}, ${who}` : noteDate(n.cookedAtMs, tz);
}
