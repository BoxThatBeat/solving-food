// Captures the browser's install prompt so M3's first-timer flow can offer "Install" (iOS shows instructions instead).

import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function initInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** `canPrompt` is true when the browser offered an install prompt; `prompt()` shows it once. */
export function useInstallPrompt(): { canPrompt: boolean; installed: boolean; prompt: () => Promise<boolean> } {
  const canPrompt = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => deferred !== null,
  );
  return {
    canPrompt,
    installed: isStandalone(),
    prompt: async () => {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      emit();
      await e.prompt();
      return (await e.userChoice).outcome === "accepted";
    },
  };
}
