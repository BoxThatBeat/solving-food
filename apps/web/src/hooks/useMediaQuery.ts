import { useSyncExternalStore } from "react";

/** Live `matchMedia` result, e.g. `useMediaQuery("(min-width: 48rem)")` for the md breakpoint. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const MD = "(min-width: 48rem)";
