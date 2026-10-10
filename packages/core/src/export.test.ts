import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { strToU8, zipSync } from "fflate";
import {
  buildExport,
  decodeValue,
  encodeValue,
  exportFileName,
  exportSummary,
  ExportError,
  matchRecipe,
  readExportZip,
  reconcileSupply,
  referencedIds,
  remapExport,
  zipExport,
  type ExportInput,
} from "./export";
import { cooklangToRecipe, recipeToCooklang } from "./cooklang";
import { ratingId } from "./commands";

class Ts {
  constructor(private ms: number) {}
  toMillis() {
    return this.ms;
  }
}

function sampleInput(): ExportInput {
  return {
    household: {
      id: "hh1",
      data: { name: "Silbrass Pvt", createdBy: "u1", periodDays: 7, budgetCents: 20000, currency: "CAD", timezone: "America/Toronto", defaultServings: 4, plannedMealTypes: ["dinner"], pcxStoreId: "x", currentPeriodId: "2026-10-05", settings: { tools: ["Wok"] }, createdAt: new Ts(1) },
    },
    collections: {
      stores: [{ id: "costco", data: { name: "Costco", kind: "inStore", bulk: true } }],
      planItems: [{ id: "p1", data: { periodId: "2026-10-05", recipes: [{ recipeId: "r1", servingsMultiplier: 1 }], savedMealId: "m1", addedAt: new Ts(1_700_000_000_000) } }],
      cookEvents: [{ id: "e1", data: { recipeIds: ["r1", "r2"], cookedAt: new Ts(1_700_000_100_000) } }],
      favourites: [{ id: "recipe_r2", data: { type: "recipe", targetId: "r2" } }, { id: "meal_m1", data: { type: "meal", targetId: "m1" } }],
      notes: [{ id: "r3", data: { text: "less salt" } }],
      stats: [{ id: "recipe_r1", data: { timesCooked: 2 } }],
      ratings: [{ id: ratingId("e1", "u1", "recipe", "r2"), data: { uid: "u1", cookEventId: "e1", targetType: "recipe", targetId: "r2", score: 8 } }],
      groceryLists: [{ id: "l1", data: { status: "received", items: {} } }],
    },
    supply: [
      {
        id: "onion",
        data: { ingredientId: "onion", label: "Onion", canonicalUnit: "count", canonicalAmount: 3, lots: [{ lotId: "a", amount: 3, acquiredAt: new Ts(5) }] },
        transactions: [
          { id: "t1", data: { delta: 5, kind: "purchase", lotId: "a", createdAt: new Ts(5) } },
          { id: "t2", data: { delta: -2, kind: "cook", lotId: "a", createdAt: new Ts(6) } },
        ],
      },
    ],
    recipes: [{ id: "r1", title: "Dal Makhani", fingerprint: "fp1", cook: "---\ntitle: Dal\n---\nCook." }],
    meals: [{ id: "m1", name: "Dal night", recipes: [{ recipeId: "r1", servingsMultiplier: 1 }] }],
    nowMs: Date.UTC(2026, 9, 10, 15),
  };
}

describe("encodeValue / decodeValue", () => {
  it("round-trips timestamps through JSON", () => {
    const v = { a: new Ts(42), b: [new Ts(7), { c: new Date(9) }], d: "x", e: null, f: 1.5 };
    const json = JSON.parse(JSON.stringify(encodeValue(v)));
    expect(json).toEqual({ a: { __ts: 42 }, b: [{ __ts: 7 }, { c: { __ts: 9 } }], d: "x", e: null, f: 1.5 });
    const back = decodeValue(json, (ms) => ({ ms })) as Record<string, unknown>;
    expect(back.a).toEqual({ ms: 42 });
    expect((back.b as unknown[])[1]).toEqual({ c: { ms: 9 } });
  });

  it("property: encode → JSON → decode keeps plain data", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const enc = JSON.parse(JSON.stringify(encodeValue(v)));
        const once = JSON.parse(JSON.stringify(v));
        expect(decodeValue(enc, (ms) => ({ __ts: ms }))).toEqual(once === undefined ? null : JSON.parse(JSON.stringify(encodeValue(once))));
      }),
    );
  });
});

describe("export zip round trip", () => {
  it("buildExport → zip → readExportZip gives back the same documents", () => {
    const built = buildExport(sampleInput());
    const parsed = readExportZip(zipExport(built));
    expect(parsed.export).toEqual(built.export);
    expect(parsed.meals).toEqual(built.meals);
    expect([...parsed.cook.values()]).toEqual(["---\ntitle: Dal\n---\nCook."]);
    expect(parsed.export.household.fields).not.toHaveProperty("name");
    expect(parsed.export.household.fields).not.toHaveProperty("createdBy");
    expect(parsed.export.household.name).toBe("Silbrass Pvt");
    expect(parsed.export.collections.planItems[0]!.data.addedAt).toEqual({ __ts: 1_700_000_000_000 });
    expect(parsed.export.recipes[0]!.file).toBe("recipes/dal-makhani-r1.cook");
  });

  it("summarises counts and the documents an import writes", () => {
    const s = exportSummary(readExportZip(zipExport(buildExport(sampleInput()))));
    expect(s.householdName).toBe("Silbrass Pvt");
    expect(s.counts).toMatchObject({ planItems: 1, cookEvents: 1, supply: 1, transactions: 2, recipes: 1, meals: 1, favourites: 2, periods: 0 });
    // household + stores, planItems, cookEvents, 2 favourites, notes, stats, ratings, groceryLists + supply + 2 txs
    expect(s.documents).toBe(13);
  });

  it("rejects things that aren't exports with a readable reason", () => {
    expect(() => readExportZip(strToU8("hello"))).toThrow(ExportError);
    expect(() => readExportZip(zipSync({ "x.txt": strToU8("x") }))).toThrow(/household.json is missing/);
    expect(() => readExportZip(zipSync({ "household.json": strToU8("{nope") }))).toThrow(/valid JSON/);
    expect(() => readExportZip(zipSync({ "household.json": strToU8(JSON.stringify({ schema: "other" })) }))).toThrow(/isn't a Solving Food/);
    const built = buildExport(sampleInput());
    const newer = { ...built.export, version: 99 };
    expect(() => readExportZip(zipSync({ "household.json": strToU8(JSON.stringify(newer)) }))).toThrow(/newer version/);
    const badId = { ...built.export, collections: { ...built.export.collections, stores: [{ id: "a/b", data: {} }] } };
    expect(() => readExportZip(zipSync({ "household.json": strToU8(JSON.stringify(badId)) }))).toThrow(/collections.stores.0.id/);
  });

  it("names the file after the household and the local date", () => {
    expect(exportFileName("Silbrass Pvt", Date.UTC(2026, 9, 11, 2))).toBe("solving-food-silbrass-pvt-2026-10-10.zip");
    expect(exportFileName("  !!", 0, "UTC")).toBe("solving-food-household-1970-01-01.zip");
  });
});

describe("referencedIds and remapExport", () => {
  it("collects recipes and meals from plans, history, favourites, notes, stats and ratings", () => {
    const { recipeIds, mealIds } = referencedIds(sampleInput().collections);
    expect([...recipeIds].sort()).toEqual(["r1", "r2", "r3"]);
    expect([...mealIds]).toEqual(["m1"]);
  });

  it("points references at matched recipes and rebuilds IDs that embed them", () => {
    const e = buildExport(sampleInput()).export;
    const out = remapExport(e, new Map([["r2", "R2"], ["r3", "R3"]]), new Map([["m1", "M1"]]));
    expect(out.collections.cookEvents[0]!.data.recipeIds).toEqual(["r1", "R2"]);
    expect(out.collections.planItems[0]!.data.savedMealId).toBe("M1");
    expect(out.collections.favourites.map((f) => f.id)).toEqual(["recipe_R2", "meal_M1"]);
    expect(out.collections.notes[0]!.id).toBe("R3");
    expect(out.collections.ratings[0]!.id).toBe(ratingId("e1", "u1", "recipe", "R2"));
    expect(out.collections.ratings[0]!.data.targetId).toBe("R2");
    expect(e.collections.notes[0]!.id).toBe("r3"); // input untouched
    expect(remapExport(e, new Map(), new Map())).toBe(e);
  });
});

describe("matchRecipe", () => {
  it("prefers the same ID, then the fingerprint, else create", () => {
    expect(matchRecipe({ id: "a", fingerprint: "f" }, () => true, () => "b")).toEqual({ kind: "id", id: "a" });
    expect(matchRecipe({ id: "a", fingerprint: "f" }, () => false, (fp) => (fp === "f" ? "b" : undefined))).toEqual({ kind: "fingerprint", id: "b" });
    expect(matchRecipe({ id: "a", fingerprint: null }, () => false, () => "b")).toEqual({ kind: "create" });
  });
});

describe("reconcileSupply", () => {
  it("keeps a healthy ledger as it is", () => {
    const s = buildExport(sampleInput()).export.supply[0]!;
    const r = reconcileSupply(s, 1);
    expect(r.reconciled).toBe(false);
    expect(r.transactions).toHaveLength(2);
  });

  it("property: afterwards Σ transactions == canonicalAmount == Σ lots", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 5000, noNaN: true }), { maxLength: 5 }),
        fc.array(fc.double({ min: -5000, max: 5000, noNaN: true }), { maxLength: 8 }),
        fc.double({ min: -100, max: 10000, noNaN: true }),
        (lots, deltas, stated) => {
          const s = {
            id: "x",
            data: { label: "X", canonicalUnit: "g" as const, canonicalAmount: stated, lots: lots.map((amount, i) => ({ lotId: `l${i}`, amount })) },
            transactions: deltas.map((delta, i) => ({ id: `t${i}`, data: { delta, kind: "purchase", lotId: "l0" } })),
          };
          const r = reconcileSupply(s, 1);
          const lotSum = lots.reduce((a, b) => a + b, 0);
          const txSum = r.transactions.reduce((a, t) => a + t.data.delta, 0);
          expect(Math.abs(r.data.canonicalAmount - lotSum)).toBeLessThan(1e-5);
          expect(Math.abs(txSum - r.data.canonicalAmount)).toBeLessThan(1e-5);
        },
      ),
    );
  });
});

describe(".cook files in the export re-import to the same recipe", () => {
  it("recipeToCooklang → cooklangToRecipe keeps the title and servings", () => {
    const content = {
      title: "Weeknight Dal",
      servings: 4,
      prepMin: 10,
      cookMin: 30,
      cuisine: "indian" as const,
      mainProtein: "legumes" as const,
      tags: ["dinner"],
      tools: [],
      ingredients: [{ id: "i1", ingredientId: "red-lentils", amount: 200, measure: "weight" as const, displayText: "red lentils", optional: false }],
      steps: [{ text: "Simmer {{ing:i1}} for 20 minutes.", ingredientRefs: ["i1"] }],
      prepTasks: [],
      defaultLeftoverPortions: 2,
      imagePaths: [],
    };
    const text = recipeToCooklang(content as never, {});
    const back = cooklangToRecipe(text, { resolve: () => ({ id: "red-lentils", name: "red lentils" }) as never });
    expect(back.content.title).toBe("Weeknight Dal");
    expect(back.content.servings).toBe(4);
  });
});
