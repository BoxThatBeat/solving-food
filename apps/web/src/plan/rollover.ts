// Period rollover on the client (TECHNICAL_SPECS §7, PRD R6.6; Planning/M2 §1): on app open, on focus, when the
// connection returns, and at the moment the current period ends, run the idempotent bootstrap transaction. No
// scheduler. Offline the ended period stays and the Plan page says it will roll over when online.
import { useEffect, useRef } from "react";
import { bootstrapHousehold } from "@/data/plan";

export function useRollover(hid: string, periodEndMs: number | null | undefined): void {
  const running = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (running.current || cancelled) return;
      running.current = true;
      bootstrapHousehold(hid)
        .catch((e) => console.warn("rollover failed", e))
        .finally(() => {
          running.current = false;
        });
    };
    run();
    const onVisible = () => document.visibilityState === "visible" && run();
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (periodEndMs) {
      const wait = periodEndMs - Date.now() + 1000;
      // setTimeout overflows past ~24.8 days; focus/visibility catch the long waits.
      if (wait > 0 && wait < 2 ** 31 - 1) timer = setTimeout(run, wait);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [hid, periodEndMs]);
}
