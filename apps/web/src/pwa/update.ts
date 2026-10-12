// App-update store (TECHNICAL_SPECS §12 "Updates"). The service worker runs in "prompt" mode: a new build installs
// and waits until the page tells it to take over. Normally the page does that at once and reloads itself, so a
// deploy reaches every open copy of the app within an hour. During a cooking session the reload is deferred, and a
// sticky "Reload" banner is shown instead; the update applies on its own when the session ends.

import { useSyncExternalStore } from "react";

type Apply = () => Promise<void> | void;

let apply: Apply | null = null;
let deferred = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** A new worker is installed and waiting: apply it now, or hold it while a cook session is on screen. */
export function onUpdateReady(fn: Apply): void {
  apply = fn;
  if (deferred) emit();
  else void fn();
}

/** `true` while a cooking session is mounted; clearing it applies any update that arrived meanwhile. */
export function setUpdateDeferred(on: boolean): void {
  if (deferred === on) return;
  deferred = on;
  emit();
  if (!on && apply) void apply();
}

/** Reloads into the waiting build (the banner's "Reload"). No-op when nothing is waiting. */
export function applyUpdate(): void {
  if (apply) void apply();
}

/** `true` when an update is waiting and held back by a cook session. */
export function isUpdatePending(): boolean {
  return apply !== null && deferred;
}

export function useUpdatePending(): boolean {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, isUpdatePending);
}

/** Test hook. */
export function resetUpdateStore(): void {
  apply = null;
  deferred = false;
  listeners.clear();
}
