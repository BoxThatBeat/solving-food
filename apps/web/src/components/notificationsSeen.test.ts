import { beforeEach, describe, expect, it } from "vitest";
import { isStale, markSeenHere, prune, seenHere, STALE_AFTER_MS } from "./notificationsSeen";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Pick<Storage, "getItem" | "setItem"> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  };
});

describe("notifications seen on this device (R12.1, M23)", () => {
  it("remembers what this device let clear, per user", () => {
    expect(seenHere("u1", "n1")).toBe(false);
    markSeenHere("u1", "n1", 1000);
    expect(seenHere("u1", "n1")).toBe(true);
    expect(seenHere("u2", "n1")).toBe(false);
  });

  it("forgets entries after 30 days", () => {
    const day = 24 * 3600_000;
    expect(prune({ a: 0, b: 29 * day }, 31 * day)).toEqual({ b: 29 * day });
  });

  it("success and info go stale after a day; errors never do", () => {
    expect(isStale("success", 0, STALE_AFTER_MS + 1)).toBe(true);
    expect(isStale("info", 0, STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale("error", 0, STALE_AFTER_MS * 10)).toBe(false);
    expect(isStale("success", null, STALE_AFTER_MS * 10)).toBe(false);
  });
});
