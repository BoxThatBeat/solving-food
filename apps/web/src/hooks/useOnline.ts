// Connectivity (M23, TECHNICAL_SPECS §11 "Connectivity"): `navigator.onLine` is only half the answer, since it reads
// true on a Wi-Fi network that goes nowhere. The shell also follows the household document with metadata changes
// (<ConnectivityProbe>); when Firestore has been answering only from this device's cache for a few seconds while the
// browser claims to be online, the app counts as offline too. Writes never wait on this: it drives the offline
// banners and the few actions that need the server (restart period, recipe saves, uploads).
import { useSyncExternalStore } from "react";

/** How long Firestore must answer from cache alone before a "connected" browser counts as offline. */
export const CACHE_ONLY_GRACE_MS = 5000;

const listeners = new Set<() => void>();
let serverUnreachable = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const fn of listeners) fn();
}

function setUnreachable(v: boolean): void {
  if (serverUnreachable === v) return;
  serverUnreachable = v;
  emit();
}

/** Fed by the shell's probe: whether the latest snapshot came from the cache only. `null` = no probe (signed out). */
export function reportServerContact(fromCache: boolean | null): void {
  if (fromCache) {
    if (!timer && !serverUnreachable) timer = setTimeout(() => {
      timer = null;
      setUnreachable(true);
    }, CACHE_ONLY_GRACE_MS);
    return;
  }
  if (timer) clearTimeout(timer);
  timer = null;
  setUnreachable(false);
}

/** The current answer, outside React (data functions that need the server). */
export function isOnline(): boolean {
  return (typeof navigator === "undefined" || navigator.onLine !== false) && !serverUnreachable;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
