// Colour tokens copied verbatim from the design prototype (claude-design-result/Solving Food.dc.html, `const FLAV=`
// and `const ACCENTS=`). These, not @catppuccin/palette, are the source of truth (CLAUDE.md "Design reference").

import type { Accent, Flavour } from "@solving-food/core";

export interface FlavourTokens {
  ink: string;
  sub: string;
  base: string;
  mantle: string;
  pg: string;
  s0: string;
  onc: string;
  desk: string;
  scrim: string;
}

export const FLAV: Record<Flavour, FlavourTokens> = {
  // Latte `sub` is Catppuccin Latte Subtext 1 (#5c5f77) instead of the prototype's #6c6f85, which fails WCAG AA
  // (3.7–4.4:1) for small text on every Latte background. Deviation recorded in Planning/M0-skeleton.md.
  latte: { ink: "#4c4f69", sub: "#5c5f77", base: "#eff1f5", mantle: "#e6e9ef", pg: "#dce0e8", s0: "#ccd0da", onc: "#4c4f69", desk: "#bcc0cc", scrim: "rgba(76,79,105,.55)" },
  frappe: { ink: "#c6d0f5", sub: "#a5adce", base: "#303446", mantle: "#292c3c", pg: "#232634", s0: "#414559", onc: "#232634", desk: "#1a1c26", scrim: "rgba(0,0,0,.6)" },
  macchiato: { ink: "#cad3f5", sub: "#a5adcb", base: "#24273a", mantle: "#1e2030", pg: "#181926", s0: "#363a4f", onc: "#181926", desk: "#11121c", scrim: "rgba(0,0,0,.6)" },
  mocha: { ink: "#cdd6f4", sub: "#a6adc8", base: "#1e1e2e", mantle: "#181825", pg: "#11111b", s0: "#313244", onc: "#11111b", desk: "#0a0a11", scrim: "rgba(0,0,0,.65)" },
};

export const ACCENT_HEX: Record<Accent, string> = {
  green: "#a6da95",
  teal: "#8bd5ca",
  sapphire: "#7dc4e4",
  blue: "#8aadf4",
  lavender: "#b7bdf8",
  mauve: "#c6a0f6",
  pink: "#f5bde6",
  flamingo: "#f0c6c6",
  maroon: "#ee99a0",
  red: "#ed8796",
  peach: "#f5a97f",
  yellow: "#eed49f",
};

export const ACCENT_LABELS: Record<Accent, string> = {
  green: "Green",
  teal: "Teal",
  sapphire: "Sapphire",
  blue: "Blue",
  lavender: "Lavender",
  mauve: "Mauve",
  pink: "Pink",
  flamingo: "Flamingo",
  maroon: "Maroon",
  red: "Red",
  peach: "Peach",
  yellow: "Yellow",
};

/** Fixed signal colours the prototype uses regardless of flavour. */
export const SIGNAL = { red: "#ed8796", peach: "#f5a97f", yellow: "#eed49f", blue: "#8aadf4", green: "#a6da95" } as const;

/**
 * The prototype's "look" switch. Classic ships (CLAUDE.md); the structure stays so Quiet/Loud could be added.
 * Values are the prototype's px converted to rem (÷16) so borders and shadows scale with the fluid root size
 * (TECHNICAL_SPECS §12 "Fluid type and spacing").
 */
export const LOOKS = {
  quiet: { bw: "0.125rem", sh: "0.125rem", r: "0.875rem", tt: "none", tilt: "0deg" },
  classic: { bw: "0.1875rem", sh: "0.25rem", r: "0.375rem", tt: "none", tilt: "0deg" },
  loud: { bw: "0.25rem", sh: "0.375rem", r: "0rem", tt: "uppercase", tilt: "-2deg" },
} as const;
export type Look = keyof typeof LOOKS;
export const LOOK: Look = "classic";
