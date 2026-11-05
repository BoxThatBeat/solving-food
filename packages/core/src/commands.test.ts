// Command payload schemas (TECHNICAL_SPECS §6; Planning/M22 items 5 and 6): path-safe IDs and receiveGroceries chunks.
import { describe, expect, it } from "vitest";
import { parseCommand, receiveChunks, RECEIVE_CHUNK } from "./commands";

describe("command IDs (M22)", () => {
  const add = (ingredientId: string) => () => parseCommand({ type: "addSupply", payload: { ingredientId, amount: 1, location: "pantry" } });

  it("accepts document IDs", () => {
    for (const ok of ["rice", "leftover_abc", "staple_milk", "a.b", "x".repeat(200)]) expect(add(ok)).not.toThrow();
  });

  it("refuses IDs that aren't one path segment", () => {
    for (const bad of ["", "rice/x", "/", "..", ".", "__id__", "x".repeat(201)]) expect(add(bad)).toThrow();
    expect(() => parseCommand({ type: "receiveGroceries", payload: { listId: "l1", items: [{ itemId: "a/b", amount: 1 }] } })).toThrow();
  });
});

describe("receiveChunks (M22)", () => {
  const line = (itemId: string, ingredientId?: string) => ({ itemId, ...(ingredientId ? { ingredientId } : {}) });

  it("keeps a short list in one chunk, and an empty one as one empty chunk", () => {
    expect(receiveChunks([line("a", "rice"), line("b")])).toEqual([[line("a", "rice"), line("b")]]);
    expect(receiveChunks([])).toEqual([[]]);
  });

  it("never splits one ingredient's lines unless they alone exceed a chunk", () => {
    const items = [line("1", "a"), line("2", "b"), line("3", "a"), line("4", "c"), line("5", "b")];
    const chunks = receiveChunks(items, 3);
    expect(chunks.map((c) => c.map((i) => i.itemId))).toEqual([["1", "3"], ["2", "5", "4"]]);
    const big = Array.from({ length: 7 }, (_, i) => line(`m${i}`, "milk"));
    expect(receiveChunks(big, 3).map((c) => c.length)).toEqual([3, 3, 1]);
  });

  it("covers every line once and stays within the size (property)", () => {
    for (let seed = 1; seed < 40; seed++) {
      const n = (seed * 37) % 401;
      const items = Array.from({ length: n }, (_, i) => line(`i${i}`, i % 5 === 0 ? undefined : `ing${(i * seed) % 23}`));
      const chunks = receiveChunks(items);
      expect(chunks.flat().map((i) => i.itemId).sort()).toEqual(items.map((i) => i.itemId).sort());
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(RECEIVE_CHUNK);
      const where = new Map<string, Set<number>>();
      chunks.forEach((c, k) => c.forEach((i) => i.ingredientId && (where.get(i.ingredientId) ?? where.set(i.ingredientId, new Set()).get(i.ingredientId)!).add(k)));
      for (const s of where.values()) expect(s.size).toBe(1); // ≤ 100 lines per ingredient here
    }
  });
});
