// Web push for cooking timers (PRD R4.23; TECHNICAL_SPECS §11, §12 "Cooking timers"). The first timer asks for
// notification permission, gets an FCM token with the project's VAPID key on the app's own service worker, and stores
// it as users/{uid}/devices/{token}; the `timers` function pushes to every device of the user when a timer ends, and
// public/push-sw.js (imported by the Workbox worker) shows the notification. iOS delivers web push only to the
// installed app (16.4+), so Safari outside the home screen gets the install prompt instead.
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { app, db, functions, useEmulators } from "@/firebase/app";
import { isStandalone } from "./install";

export const VAPID_KEY = "BDJ6cML5GULVZZ0X3Zd2B2m02s_aGTbRRkbKPrV38lLZr6YE9SrkbwL4_aOGAQp72B5eDVeoQ-iui05v0vn1Rgk";

export type PushState = "ready" | "denied" | "unsupported" | "needs-install" | "offline";

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

/** Can this device get timer pushes at all, before asking? */
export function pushSupport(): PushState {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (!navigator.onLine) return "offline";
  return "ready";
}

let registered: Promise<boolean> | null = null;

/** Asks permission (once) and registers this device for pushes. Resolves false when that isn't possible. */
export function ensureDevice(uid: string): Promise<boolean> {
  if (registered) return registered;
  registered = (async () => {
    if (pushSupport() !== "ready") return false;
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
      if (!(await isSupported())) return false;
      const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if (!token) return false;
      await setDoc(doc(db, "users", uid, "devices", token), { platform: navigator.userAgent.slice(0, 40) || "web", createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() }, { merge: true });
      return true;
    } catch (e) {
      console.warn("push registration failed", e);
      return false;
    }
  })();
  void registered.then((ok) => {
    if (!ok) registered = null; // allow a later retry
  });
  return registered;
}

const scheduleFn = () => httpsCallable<{ timerId: string; endsAt: number; label: string; title?: string; link: string }, { taskId: string }>(functions, "scheduleTimer");
const cancelFn = () => httpsCallable<{ timerId: string }, { ok: boolean }>(functions, "cancelTimer");

/**
 * Schedules the locked-phone alert for a running timer. In emulator builds the call still goes to the Functions
 * emulator, whose stub queue records the task (e2e checks it); no push is ever sent there.
 */
export async function schedulePush(uid: string, t: { timerId: string; endsAt: number; label: string; title?: string; link: string }): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (!useEmulators && !(await ensureDevice(uid))) return false;
  try {
    await scheduleFn()(t);
    return true;
  } catch (e) {
    console.warn("scheduleTimer failed", e);
    return false;
  }
}

export async function cancelPush(timerId: string): Promise<void> {
  if (!navigator.onLine) return;
  try {
    await cancelFn()({ timerId });
  } catch (e) {
    console.warn("cancelTimer failed", e);
  }
}
