import { registerSW } from "virtual:pwa-register";

/** Registers the Workbox service worker (app shell precache). Updates apply on the next load. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  registerSW({ immediate: true });
}
