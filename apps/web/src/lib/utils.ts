import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's colour names (prototype tokens). `base` must be known as a colour: Tailwind's `text-base` font size
// is removed in styles/index.css, and tailwind-merge would otherwise drop `text-base` next to a `text-[size]`.
const COLORS = ["ink", "sub", "base", "mantle", "pg", "s0", "onc", "desk", "scrim", "line", "acc", "red", "peach", "yellow", "blue"];

const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      "font-size": [{ text: ["xs", "sm", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl", (v: string) => /^\[(\d|calc|clamp|var|length:)/.test(v)] }],
    },
  },
  extend: {
    theme: { color: COLORS },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
