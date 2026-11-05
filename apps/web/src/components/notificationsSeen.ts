// Per-device notification state (M23, R12.1): success and info banners clear themselves after a few seconds on the
// device that showed them, without telling the server, so the person's other devices still show them. This device
// remembers which ones it already showed (and let clear), so they don't come back on reload. Only an explicit dismiss
// (×, Dismiss all, following its link, its action) writes `dismissedAt`, which takes the banner down everywhere. A
// success or info notification nobody dismissed is marked dismissed by whichever device sees it after a day.

export const STALE_AFTER_MS = 24 * 3600_000;
const KEEP_MS = 30 * 24 * 3600_000;
const KEY = "sf.seenNotifications";

type Seen = Record<string, number>; // notification id → when this device let it clear

function load(uid: string): Seen {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { uid?: string; seen?: Seen };
    return all.uid === uid && all.seen ? all.seen : {};
  } catch {
    return {};
  }
}

/** Drops entries older than 30 days (the server prunes dismissed notifications after 30 days, M22). */
export function prune(seen: Seen, nowMs: number): Seen {
  return Object.fromEntries(Object.entries(seen).filter(([, at]) => nowMs - at < KEEP_MS));
}

export function seenHere(uid: string, id: string): boolean {
  return id in load(uid);
}

export function markSeenHere(uid: string, id: string, nowMs = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ uid, seen: { ...prune(load(uid), nowMs), [id]: nowMs } }));
  } catch {
    /* storage blocked: it may show again on reload here */
  }
}

/** A success or info notification older than a day: cleared for everyone instead of shown. Errors wait for a person. */
export function isStale(kind: string, createdAtMs: number | null, nowMs: number): boolean {
  return kind !== "error" && createdAtMs !== null && nowMs - createdAtMs > STALE_AFTER_MS;
}
