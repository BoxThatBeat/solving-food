// "Merge into…" (Planning/M8 item 2): the pure decisions the mergeIngredient function applies.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { copiedHistory, mergeFactor, mergeGroceryItems, mergedTarget, mergeRefusal, moveLots, repointSides, uniqueIds } from "./ingredientMerge";
import { recomputeAmount, type LedgerLot } from "./ledger";
import type { GroceryItem, IngredientDoc } from "./types";

const base: IngredientDoc = {
  name: "tater tots",
  aliases: ["frozen tater tots"],
  category: "frozen",
  defaultLocation: "freezer",
  allowedMeasures: ["weight"],
  canonicalUnit: "g",
  proteinPer100g: 3,
  shelfLifeDays: { freezer: 240 },
  freezable: true,
  isStaple: false,
  freeUse: false,
  needsReview: false,
};
const dup: IngredientDoc = { ...base, name: "frozen tater tot nuggets", aliases: ["tot nuggets", "Frozen Tater Tots"], proteinPer100g: undefined, needsReview: true, createdBy: "u1" };
const lot = (lotId: string, amount: number): LedgerLot => ({ lotId, amount, location: "freezer", acquiredAtMs: 1000 });

describe("mergeIngredient decisions", () => {
  it("unit factor: same unit, grams ↔ pieces by weight per piece, else refused", () => {
    expect(mergeFactor(base, base)).toBe(1);
    expect(mergeFactor({ canonicalUnit: "g" }, { canonicalUnit: "count", unitWeightG: 50 })).toBe(0.02);
    expect(mergeFactor({ canonicalUnit: "count", unitWeightG: 50 }, { canonicalUnit: "g" })).toBe(50);
    expect(mergeFactor({ canonicalUnit: "count" }, { canonicalUnit: "g" })).toBeNull();
  });

  it("refuses self, unknown, merged targets, catalogue into new, and unconvertible units", () => {
    expect(mergeRefusal("a", base, "a", base)).toMatch(/itself/);
    expect(mergeRefusal("a", undefined, "b", base)).toMatch(/No ingredient a/);
    expect(mergeRefusal("a", dup, "b", { ...base, mergedInto: "c" })).toMatch(/merged into another/);
    expect(mergeRefusal("a", { ...dup, mergedInto: "c" }, "b", base)).toMatch(/already merged/);
    expect(mergeRefusal("a", { ...dup, mergedInto: "b" }, "b", base)).toBeNull(); // re-run: idempotent
    expect(mergeRefusal("seed", base, "new", dup)).toMatch(/shipped catalogue/);
    expect(mergeRefusal("new", dup, "seed", base)).toBeNull();
    expect(mergeRefusal("a", { ...dup, canonicalUnit: "count" }, "b", base)).toMatch(/weight per piece/);
  });

  it("learns the duplicate's names as aliases (no repeats, case-folded) and fills what the target lacks", () => {
    const r = mergedTarget({ ...base, proteinPer100g: undefined, needsReview: true }, { ...dup, proteinPer100g: 2.5 });
    expect(r.aliasesAdded).toEqual(["frozen tater tot nuggets", "tot nuggets"]);
    expect(r.doc.aliases).toEqual(["frozen tater tots", "frozen tater tot nuggets", "tot nuggets"]);
    expect(r.doc.proteinPer100g).toBe(2.5);
    expect(r.doc.needsReview).toBe(false);
    const full = mergedTarget({ ...base, aliases: Array.from({ length: 40 }, (_, i) => `a${i}`) }, dup);
    expect(full.doc.aliases).toHaveLength(40);
  });

  it("moves lots (renaming a clash) and writes the source's − merge transactions", () => {
    const m = moveLots([lot("x", 100)], [lot("x", 50), lot("y", 25), lot("z", 0)], 1, "merged into tater tots");
    expect(m.lots.map((l) => [l.lotId, l.amount])).toEqual([["x", 100], ["x-m1", 50], ["y", 25]]);
    expect(m.moved).toBe(75);
    expect(m.renamed).toEqual(new Map([["x", "x-m1"]]));
    expect(m.sourceTxs).toEqual([
      { delta: -50, kind: "merge", lotId: "x", note: "merged into tater tots" },
      { delta: -25, kind: "merge", lotId: "y", note: "merged into tater tots" },
    ]);
  });

  it("property: Σ transactions == amount on both rows after the move", () => {
    const lotsArb = fc.array(fc.integer({ min: 1, max: 2000 }), { maxLength: 6 });
    fc.assert(
      fc.property(lotsArb, lotsArb, fc.constantFrom(1, 0.02, 50), (t, s, factor) => {
        const target = t.map((a, i) => lot(`l${i}`, a));
        const source = s.map((a, i) => lot(`l${i}`, a));
        // Each row's ledger: one purchase per lot (consistent before the merge).
        const targetTxs = target.map((l) => ({ delta: l.amount, lotId: l.lotId }));
        const sourceTxs = source.map((l) => ({ delta: l.amount, lotId: l.lotId }));
        const m = moveLots(target, source, factor, "m");
        const h = copiedHistory(sourceTxs, m.moved, factor, m.renamed);
        const targetSum = [...targetTxs, ...h.copies].reduce((x, y) => x + y.delta, 0) + h.balance;
        expect(targetSum).toBeCloseTo(recomputeAmount(m.lots), 4);
        const sourceSum = [...sourceTxs, ...m.sourceTxs].reduce((x, y) => x + y.delta, 0);
        expect(sourceSum).toBeCloseTo(0, 6);
        for (const c of h.copies) expect(m.lots.some((l) => l.lotId === c.lotId)).toBe(true);
      }),
    );
  });

  it("repoints sides without listing one twice, and ingredient ID lists", () => {
    expect(repointSides([{ ingredientId: "a", portion: 1 }, { ingredientId: "b", portion: 2 }], "a", "b").sides).toEqual([{ ingredientId: "b", portion: 1 }]);
    expect(repointSides([{ ingredientId: "c", portion: 1 }], "a", "b").changed).toBe(false);
    expect(uniqueIds(["a", "b", "c"], "a", "b")).toEqual(["b", "c"]);
  });

  it("grocery lists: the plan line joins the target's line at the same store; other lines change ingredient", () => {
    const line = (over: Partial<GroceryItem>): GroceryItem => ({ amount: 100, measure: "g", packs: 1, productName: "x", storeId: "pc", estPriceCents: 300, source: "plan", checked: false, need: 80, ...over });
    const out = mergeGroceryItems(
      { a: line({ ingredientId: "a" }), b: line({ ingredientId: "b", amount: 200, estPriceCents: null }), manual_1: line({ ingredientId: "a", source: "manual" }), c: line({ ingredientId: "c" }) },
      "a",
      "b",
      1,
    )!;
    expect(Object.keys(out).sort()).toEqual(["b", "c", "manual_1"]);
    expect(out.b).toMatchObject({ ingredientId: "b", amount: 300, packs: 2, need: 160, estPriceCents: 300 });
    expect(out.manual_1!.ingredientId).toBe("b");
    expect(mergeGroceryItems({ c: line({ ingredientId: "c" }) }, "a", "b", 1)).toBeNull();
    const moved = mergeGroceryItems({ a: line({ ingredientId: "a" }) }, "a", "b", 2)!;
    expect(moved.b).toMatchObject({ ingredientId: "b", amount: 200, need: 160 });
  });
});
