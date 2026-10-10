import {
  BookOpen,
  CalendarDays,
  History,
  Package,
  Settings,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export interface NavPage {
  to: "/plan" | "/recipes" | "/meals" | "/supply" | "/grocery" | "/history" | "/settings";
  label: string;
  icon: LucideIcon;
  sub: string;
}

/** The seven pages (PRD §12). */
export const PAGES: NavPage[] = [
  { to: "/plan", label: "Plan", icon: CalendarDays, sub: "This period's meals and budget" },
  { to: "/recipes", label: "Recipes", icon: BookOpen, sub: "The shared library" },
  { to: "/meals", label: "Meals", icon: UtensilsCrossed, sub: "Saved recipe collections" },
  { to: "/supply", label: "Supply", icon: Package, sub: "What's in the kitchen" },
  { to: "/grocery", label: "Grocery", icon: ShoppingCart, sub: "The list, by store" },
  { to: "/history", label: "History", icon: History, sub: "What you cooked, ratings, stats" },
  { to: "/settings", label: "Settings", icon: Settings, sub: "Household, brands, tools, weights, theme" },
];

