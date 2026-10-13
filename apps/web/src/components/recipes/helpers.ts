// Non-component helpers for the recipe views (kept apart so component files stay fast-refresh friendly).
import { IMAGE_SIZES, imageVariant, type HouseholdFacts } from "@solving-food/core";
import { publicUrl } from "@/firebase/app";

/** The prototype's cuisine tints (TINTS), keyed by taxonomy value. */
const TINTS: Record<string, string> = {
  japanese: "#f0c6c6",
  italian: "#eed49f",
  indian: "#f5a97f",
  mexican: "#a6da95",
  "middle-eastern": "#ee99a0",
  chinese: "#8bd5ca",
  french: "#b7bdf8",
  greek: "#7dc4e4",
  korean: "#f5bde6",
  thai: "#91d7e3",
  mediterranean: "#8bd5ca",
  american: "#eed49f",
  canadian: "#ee99a0",
  british: "#b7bdf8",
  caribbean: "#a6da95",
  nordic: "#91d7e3",
  spanish: "#f5a97f",
  vietnamese: "#a6da95",
};

export function tintFor(cuisine: string): string {
  return TINTS[cuisine] ?? "#ccd0da";
}

export function stripes(cuisine: string, step = 9): string {
  return `repeating-linear-gradient(135deg, ${tintFor(cuisine)} 0 ${step}px, var(--base) ${step}px ${step * 2}px)`;
}

export function srcSetFor(base: string): string {
  return IMAGE_SIZES.map((w) => `${publicUrl(imageVariant(base, w))} ${w}w`).join(", ");
}

// Day first, as the prototype writes dates ("LAST 21 SEP").
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "MADE 14× · LAST 21 SEP"; empty when the household has never cooked it (the card then shows no line, M7). */
export function madeLine(f: HouseholdFacts): string {
  if (!f.timesCooked) return "";
  const last = f.lastCookedAtMs ? ` · LAST ${SHORT_DATE.format(new Date(f.lastCookedAtMs)).toUpperCase()}` : "";
  return `MADE ${f.timesCooked}×${last}`;
}


/** The thumbnail base path of a stored recipe (its first image), for <RecipeThumb> (M10, R4.29). */
export function thumbOf(r: { imagePaths?: readonly string[] | undefined } | null | undefined): string | null {
  return r?.imagePaths?.[0] ?? null;
}
