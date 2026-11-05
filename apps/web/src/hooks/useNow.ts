import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` (default a minute) and again whenever the page becomes visible, so an
 * installed app left open overnight shows the right day as soon as it's looked at (M23).
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    const vis = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
    };
  }, [intervalMs]);
  return now;
}
