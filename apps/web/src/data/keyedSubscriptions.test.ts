import { describe, expect, it, vi } from "vitest";
import { KeyedSubscriptions } from "./keyedSubscriptions";

/** A stand-in for onSnapshot: counts subscribes and unsubscribes per ID. */
function mockSnapshots() {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  const onSnapshot = vi.fn((id: string) => {
    subscribed.push(id);
    return () => unsubscribed.push(id);
  });
  return { onSnapshot, subscribed, unsubscribed };
}

describe("KeyedSubscriptions", () => {
  it("subscribes each wanted ID once", () => {
    const m = mockSnapshots();
    const subs = new KeyedSubscriptions(m.onSnapshot);
    expect(subs.sync(["a", "b", "c", "a"])).toEqual({ added: ["a", "b", "c"], removed: [] });
    expect(m.onSnapshot).toHaveBeenCalledTimes(3);
    expect(subs.size).toBe(3);
  });

  it("on a change, opens only the new IDs and closes only the dropped ones", () => {
    const m = mockSnapshots();
    const subs = new KeyedSubscriptions(m.onSnapshot);
    subs.sync(["a", "b", "c"]);
    expect(subs.sync(["b", "c", "d"])).toEqual({ added: ["d"], removed: ["a"] });
    expect(m.subscribed).toEqual(["a", "b", "c", "d"]);
    expect(m.unsubscribed).toEqual(["a"]);
  });

  it("an unchanged set does nothing", () => {
    const m = mockSnapshots();
    const subs = new KeyedSubscriptions(m.onSnapshot);
    subs.sync(["a", "b"]);
    subs.sync(new Set(["b", "a"]));
    expect(m.onSnapshot).toHaveBeenCalledTimes(2);
    expect(m.unsubscribed).toEqual([]);
  });

  it("adding one ID to 50 costs one subscription, not 51", () => {
    const m = mockSnapshots();
    const subs = new KeyedSubscriptions(m.onSnapshot);
    const ids = Array.from({ length: 50 }, (_, i) => `i${i}`);
    subs.sync(ids);
    subs.sync([...ids, "new"]);
    expect(m.onSnapshot).toHaveBeenCalledTimes(51);
    expect(m.unsubscribed).toHaveLength(0);
  });

  it("close unsubscribes everything once", () => {
    const m = mockSnapshots();
    const subs = new KeyedSubscriptions(m.onSnapshot);
    subs.sync(["a", "b"]);
    subs.close();
    subs.close();
    expect(m.unsubscribed.sort()).toEqual(["a", "b"]);
    expect(subs.size).toBe(0);
    expect(subs.has("a")).toBe(false);
  });

  it("an emptied set closes everything", () => {
    const m = mockSnapshots();
    const subs = new KeyedSubscriptions(m.onSnapshot);
    subs.sync(["a"]);
    expect(subs.sync([])).toEqual({ added: [], removed: ["a"] });
  });
});
