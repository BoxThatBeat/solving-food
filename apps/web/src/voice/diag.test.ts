// Hidden voice diagnostics (M13): off unless `?voicedebug=1` (remembered until `?voicedebug=0`), at most 50 events,
// copied as plain text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDiag, DIAG_KEY, diag, diagEvents, diagText, readDiagFlag, setDiagEnabled } from "./diag";

function stubPage(search: string, stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  vi.stubGlobal("window", { location: { search } });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setDiagEnabled(false);
  clearDiag();
});

describe("voice diagnostics", () => {
  it("is off without the flag, on with ?voicedebug=1 (remembered), off again with ?voicedebug=0", () => {
    let store = stubPage("");
    expect(readDiagFlag()).toBe(false);
    store = stubPage("?step=0&voicedebug=1");
    expect(readDiagFlag()).toBe(true);
    expect(store.get(DIAG_KEY)).toBe("1");
    stubPage("", Object.fromEntries(store));
    expect(readDiagFlag()).toBe(true);
    store = stubPage("?voicedebug=0", Object.fromEntries(store));
    expect(readDiagFlag()).toBe(false);
    expect(store.has(DIAG_KEY)).toBe(false);
  });

  it("records nothing while off; keeps the last 50 events while on; copies as text", () => {
    diag("ignored");
    expect(diagEvents()).toEqual([]);
    setDiagEnabled(true);
    for (let i = 0; i < 60; i++) diag("segment", { ms: i, rms: 0.01234, text: '"next"', skip: undefined });
    expect(diagEvents()).toHaveLength(50);
    expect(diagEvents()[0]!.detail).toBe('ms=10 rms=0.0123 text="next"');
    const text = diagText();
    expect(text.split("\n").filter((l) => / segment ms=/.test(l))).toHaveLength(50);
    expect(text).toMatch(/^\d\d:\d\d:\d\d\.\d{3} segment ms=59/m);
  });
});
