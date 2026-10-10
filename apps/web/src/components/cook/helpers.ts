// Hooks and pure helpers for the cooking views (kept apart from the components for fast refresh).
import * as React from "react";
import { lineText, pendingReviews, renderStep, type IngredientLookup } from "@solving-food/core";
import type { StoredRecipe } from "@/data/recipes";
import { useCookEvents } from "@/data/supply";
import { millis } from "@/data/plan";

/** Screen Wake Lock while cooking (R4.10); re-acquired when the tab comes back. Returns whether it's held. */
export function useWakeLock(on: boolean): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    if (!on) return;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } };
    if (!nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await nav.wakeLock!.request("screen");
        if (cancelled) return void l.release();
        lock = l;
        setHeld(true);
        l.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    void acquire();
    const vis = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", vis);
      void lock?.release();
    };
  }, [on]);
  return held;
}

export function usePendingReviews(hid: string, uid: string) {
  const events = useCookEvents(hid);
  const [now] = React.useState(() => Date.now());
  return React.useMemo(
    () =>
      pendingReviews(
        (events.docs ?? []).map((d) => ({ ...d.data, id: d.id, cookedAtMs: millis(d.data.cookedAt) ?? 0 })),
        uid,
        now,
      ),
    [events.docs, uid, now],
  );
}

/** Prep tasks, or (for recipes without any) "Measure out …" for each ingredient, as the prototype does. */
export function prepList(recipe: StoredRecipe, lookup: IngredientLookup, factor: number): Array<{ text: string; amount: string }> {
  if (recipe.prepTasks.length) {
    return recipe.prepTasks.map((p) => {
      const segs = renderStep(p.text, recipe.ingredients, lookup, factor);
      const amount = segs.find((s) => s.kind === "ingredient" && s.amount);
      return { text: segs.map((s) => (s.kind === "text" ? s.text : s.name)).join(""), amount: amount && amount.kind === "ingredient" ? amount.amount : "" };
    });
  }
  return recipe.ingredients
    .filter((l) => !l.optional)
    .map((l) => {
      const t = lineText(l, lookup, factor);
      return { text: `Measure out ${t.name}`, amount: t.amount };
    });
}

type Layout = "phone" | "phone-landscape" | "tablet-portrait" | "wide";

/** Picks the cooking layout from the container's size and orientation (spec §12 table). */
export function layoutFor(w: number, h: number): Layout {
  const landscape = w > h;
  if (landscape && w >= 900 && h >= 520) return "wide";
  if (landscape) return "phone-landscape";
  if (w >= 700) return "tablet-portrait";
  return "phone";
}

export function timerId(recipeId: string, step: number): string {
  return `${recipeId}-${step}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

