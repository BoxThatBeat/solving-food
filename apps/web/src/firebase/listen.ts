// Listener accounting (M23): every Firestore listener the app opens is registered here, so dev and e2e builds can read
// how many are open (`window.__sfListeners`). Production builds keep only the wrapper, without the bookkeeping.
import type { Unsubscribe } from "firebase/firestore";

interface ListenerStats {
  /** Listeners open now, by label (a path or query key). */
  open: Map<string, number>;
  /** Listeners opened since the page loaded. */
  opened: number;
  /** Open listeners right now. */
  active(): number;
}

const counting = import.meta.env.DEV || import.meta.env.VITE_USE_EMULATORS === "true";

const stats: ListenerStats | null = counting
  ? {
      open: new Map(),
      opened: 0,
      active() {
        let n = 0;
        for (const v of this.open.values()) n += v;
        return n;
      },
    }
  : null;

if (stats && typeof window !== "undefined") (window as unknown as { __sfListeners: ListenerStats }).__sfListeners = stats;

/** Registers a listener under `label`; the returned function unsubscribes it (once) and drops it from the count. */
export function tracked(label: string, unsub: Unsubscribe): Unsubscribe {
  if (!stats) return unsub;
  stats.opened++;
  stats.open.set(label, (stats.open.get(label) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    unsub();
    const n = (stats.open.get(label) ?? 1) - 1;
    if (n > 0) stats.open.set(label, n);
    else stats.open.delete(label);
  };
}
