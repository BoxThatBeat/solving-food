import { registerSW } from "virtual:pwa-register";
import { onUpdateReady } from "./update";

/** How often an open app asks the server for a new worker (browsers only check on navigation, and an installed app rarely navigates). */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the Workbox service worker (app shell precache) in "prompt" mode and keeps it fresh: checks for a new
 * build hourly and whenever the app comes to the foreground, then hands the waiting worker to the update store,
 * which reloads the page at once (or after the current cook session, see update.ts).
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const update = registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => undefined);
      };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
    onNeedRefresh() {
      // update(true) posts SKIP_WAITING to the waiting worker and reloads once it controls the page.
      onUpdateReady(() => update(true));
    },
  });
}
