import { describe, expect, it } from "vitest";
import { addDays, localDate, nextPeriod, periodBounds, planRestart } from "./period";
import { atStartSummary, listsForView, restartUpcoming, rolloverTarget, supplyAtStart, upcomingPeriod } from "./upcoming";
import { adoptDraft, buildList, needsFor, NEXT_DRAFT_ID, DEFAULT_STORES, type BuildContext, type GroceryIngredient, type PlanItemInput, type RecipeLines } from "./grocery";
import { expiringSpare } from "./scoring";
import type { LedgerLot } from "./ledger";
import type { GroceryItem } from "./types";

const TZ = "America/Toronto";
const DAY = 86_400_000;

describe("the upcoming period's ID (M26)", () => {
  it("starts on the current period's end date, with the household's length", () => {
    const cur = periodBounds("2026-11-02", 7, TZ);
    const up = upcomingPeriod(cur, 7, TZ);
    expect(up.id).toBe("2026-11-09");
    expect(up.startMs).toBe(cur.endMs);
    expect(up.endDate).toBe("2026-11-16");
    // A new length applies from the next period (R11.5); the ID is still the end date.
    expect(upcomingPeriod(cur, 14, TZ).endDate).toBe("2026-11-23");
  });

  it("is the ID the rollover gives the next period, across DST", () => {
    const cur = periodBounds("2026-10-29", 7, TZ); // Toronto falls back on 1 Nov
    const up = upcomingPeriod(cur, 7, TZ);
    expect(up.id).toBe(nextPeriod(cur.endMs, 7, TZ, cur.endMs + 3_600_000).id);
    expect(up.endMs - up.startMs).toBe(7 * DAY);
  });

  it("follows a period a restart cut short", () => {
    const cur = { startMs: periodBounds("2026-11-02", 7, TZ).startMs, endMs: periodBounds("2026-11-05", 1, TZ).startMs };
    expect(upcomingPeriod(cur, 7, TZ).id).toBe("2026-11-05");
  });
});

describe("rollover adopts the upcoming period (M26, R3.3)", () => {
  const cur = periodBounds("2026-11-02", 7, TZ);
  it("adopts it when it is the period containing now", () => {
    const t = rolloverTarget(cur, 7, TZ, cur.endMs + 3_600_000);
    expect(t).toMatchObject({ upcomingId: "2026-11-09", adopts: true });
    expect(t.bounds.id).toBe("2026-11-09");
  });
  it("doesn't when the upcoming period was skipped (nobody opened the app for a whole period)", () => {
    const t = rolloverTarget(cur, 7, TZ, cur.endMs + 8 * DAY);
    expect(t).toMatchObject({ upcomingId: "2026-11-09", adopts: false });
    expect(t.bounds.id).toBe("2026-11-16");
  });
});

describe("restart moves the next period with it (M26, R3.1)", () => {
  const now = periodBounds("2026-11-05", 1, TZ).startMs + 10 * 3_600_000;
  const cur = periodBounds("2026-11-02", 7, TZ);
  it("re-keys from the old end date to the new one", () => {
    const plan = planRestart(cur, now, "tomorrow", 7, TZ);
    expect(restartUpcoming(cur, plan, 7, TZ)).toEqual({ from: "2026-11-09", to: "2026-11-13" });
  });
  it("re-keys when a period that hasn't started yet moves", () => {
    const tomorrow = periodBounds(addDays(localDate(now, TZ), 1), 7, TZ);
    const plan = planRestart(tomorrow, now, "today", 7, TZ);
    expect(plan.kind).toBe("move");
    expect(restartUpcoming(tomorrow, plan, 7, TZ)).toEqual({ from: "2026-11-13", to: "2026-11-12" });
  });
  it("does nothing on a noop or without a current period", () => {
    const today = periodBounds("2026-11-05", 7, TZ);
    expect(restartUpcoming(today, planRestart(today, now, "today", 7, TZ), 7, TZ)).toBeNull();
    expect(restartUpcoming(null, planRestart(null, now, "today", 7, TZ), 7, TZ)).toBeNull();
  });
});

const lot = (lotId: string, amount: number, expiresMs: number | null): LedgerLot => ({ lotId, amount, location: "fridge", acquiredAtMs: 0, expiresFreshMs: expiresMs });

describe("Supply at the start of the next period (M26, R3.4)", () => {
  const now = 1_000 * DAY;
  const start = now + 3 * DAY;
  it("lets the current plan use the soonest-expiring lots first, then drops what expires before the start", () => {
    const lots = new Map([["chicken", [lot("late", 500, now + 10 * DAY), lot("soon", 400, now + 2 * DAY)]]]);
    const r = supplyAtStart(lots, new Map([["chicken", 300]]), new Map(), new Map(), now, start);
    // 300 g come from the lot expiring in 2 days; its other 100 g expire before the start; the 500 g lot stays.
    expect(r.unexpired.get("chicken")).toBe(500);
    expect(r.lots.get("chicken")!.map((l) => [l.lotId, l.amount])).toEqual([["late", 500]]);
  });

  it("uses this period's orders after the lots, and adds the next period's orders whole", () => {
    const lots = new Map([["rice", [lot("a", 200, null)]]]);
    const r = supplyAtStart(lots, new Map([["rice", 500]]), new Map([["rice", 1000]]), new Map([["rice", 2000]]), now, start);
    expect(r.unexpired.get("rice")).toBe(700 + 2000);
    expect(r.lots.has("rice")).toBe(false); // the lot was used up
  });

  it("never goes below zero and ignores expired lots", () => {
    const lots = new Map([["milk", [lot("old", 1000, now - DAY)]]]);
    const r = supplyAtStart(lots, new Map([["milk", 2000]]), new Map(), new Map(), now, start);
    expect(r.unexpired.has("milk")).toBe(false);
  });

  it("feeds the next period's expiring alerts and note", () => {
    const lots = new Map([
      ["chicken", [lot("c1", 900, start + 2 * DAY)]],
      ["spinach", [lot("s1", 100, start + DAY), lot("s2", 50, start + DAY)]],
      ["rice", [lot("r1", 1000, null)]],
    ]);
    const at = supplyAtStart(lots, new Map(), new Map(), new Map(), now, start);
    const spare = expiringSpare(at.lots, new Map([["spinach", 100]]), start + 7 * DAY, start, TZ);
    expect([...spare.keys()].sort()).toEqual(["chicken", "spinach"]);
    expect(atStartSummary(spare)).toEqual({ lots: 2, items: [{ ingredientId: "chicken", amount: 900 }, { ingredientId: "spinach", amount: 50 }] });
    expect(atStartSummary(spare, 1).items).toHaveLength(1);
  });
});

describe("a draft per period (M26, R7.18)", () => {
  const ING: Record<string, GroceryIngredient> = {
    chicken: { id: "chicken", name: "chicken thighs", category: "meat", freeUse: false, allowedMeasures: ["weight"], canonicalUnit: "g", defaultPackAmount: 900, defaultPackMeasure: "weight" },
  };
  const RECIPES: Record<string, RecipeLines> = { stew: { servings: 4, ingredients: [{ ingredientId: "chicken", canonicalAmount: 600, optional: false }] } };
  const base: BuildContext = {
    recipes: (id) => RECIPES[id],
    ingredients: (id) => ING[id],
    supply: new Map(),
    incoming: new Map(),
    mappings: new Map(),
    rules: [],
    stores: [...DEFAULT_STORES],
    prices: { estimates: { chicken: { priceCents: 900, packAmount: 900, packMeasure: "weight" } } },
  };
  const item = (id: string): PlanItemInput => ({ id, status: "planned", servings: 4, recipes: [{ recipeId: "stew", servingsMultiplier: 1 }] });

  it("builds the next period's list from its own items and the Supply left after this period", () => {
    const now = 0;
    const start = 3 * DAY;
    const lots = new Map([["chicken", [lot("c", 1000, start + 10 * DAY)]]]);
    const current = [item("this")];
    const at = supplyAtStart(lots, needsFor(current, base), new Map(), new Map(), now, start);
    // 1000 g − this period's 600 g leaves 400 g: next period's 600 g needs 200 g more, one 900 g pack.
    const next = buildList([item("next")], { ...base, supply: at.unexpired, incoming: new Map() });
    expect(next.items.chicken).toMatchObject({ need: 200, packs: 1 });
    // This period's list is unaffected by the next period's items.
    expect(buildList(current, { ...base, supply: new Map([["chicken", 1000]]) }).items.chicken).toBeUndefined();
  });

  it("adopts the next draft at the rollover, keeping hand-added lines of the old one", () => {
    const line = (source: GroceryItem["source"], extra: Partial<GroceryItem> = {}): GroceryItem => ({ productName: "x", amount: 1, measure: "g", packs: 1, storeId: "pc-express", estPriceCents: 100, checked: false, source, ...extra }) as GroceryItem;
    const r = adoptDraft(
      { items: { chicken: line("plan"), manual_a: line("manual"), manual_gone: line("manual", { removed: true }), staple_milk: line("staple") }, dismissedStaples: { eggs: 10, milk: 50 } },
      { items: { rice: line("plan", { checked: true }), beans: line("plan", { removed: true }), manual_b: line("manual") }, dismissedStaples: { milk: 20, salt: 30 } },
    );
    expect(Object.keys(r.items).sort()).toEqual(["beans", "manual_a", "manual_b", "rice"]);
    expect(r.items.rice!.checked).toBe(true);
    expect(r.items.beans!.removed).toBe(true);
    expect(r.dismissedStaples).toEqual({ eggs: 10, milk: 50, salt: 30 });
    expect(NEXT_DRAFT_ID).toBe("draft-next");
  });

  it("splits ordered lists between the views by the upcoming ID", () => {
    const lists = [{ id: "a", data: { periodId: "2026-11-02" } }, { id: "b", data: { periodId: "2026-11-09" } }, { id: "c", data: { periodId: "2026-10-26" } }];
    expect(listsForView(lists, "2026-11-09", "current").map((l) => l.id)).toEqual(["a", "c"]);
    expect(listsForView(lists, "2026-11-09", "next").map((l) => l.id)).toEqual(["b"]);
    expect(listsForView(lists, null, "current")).toHaveLength(3);
    expect(listsForView(lists, null, "next")).toHaveLength(0);
  });
});
