import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  activeExpiry,
  applyCorrection,
  applyPurchase,
  consumeFEFO,
  discardLot,
  EPS,
  expiredLots,
  extendExpiry,
  fefoOrder,
  freezeLot,
  isExpired,
  isLowStock,
  nextExpiry,
  recomputeAmount,
  refund,
  thawLot,
  unexpiredAmount,
  type LedgerLot,
  type LedgerTx,
} from "./ledger";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 16);
const lot = (lotId: string, amount: number, expiresInDays: number | null, extra: Partial<LedgerLot> = {}): LedgerLot => ({
  lotId,
  amount,
  location: "fridge",
  acquiredAtMs: NOW - DAY,
  expiresFreshMs: expiresInDays === null ? null : NOW + expiresInDays * DAY,
  ...extra,
});
const sum = (txs: LedgerTx[]) => txs.reduce((s, t) => s + t.delta, 0);

describe("expiry of a lot", () => {
  it("uses Still good, then frozen, then fresh", () => {
    const l = lot("a", 100, 2);
    expect(activeExpiry(l)).toBe(NOW + 2 * DAY);
    expect(activeExpiry({ ...l, frozenAtMs: NOW, expiresFrozenMs: NOW + 90 * DAY })).toBe(NOW + 90 * DAY);
    expect(activeExpiry({ ...l, expiryExtendedToMs: NOW + 5 * DAY })).toBe(NOW + 5 * DAY);
    expect(activeExpiry(lot("n", 1, null))).toBeNull();
  });
  it("counts unexpired supply only (R8.15)", () => {
    const lots = [lot("old", 200, -1), lot("new", 300, 3), lot("rice", 1000, null)];
    expect(isExpired(lots[0]!, NOW)).toBe(true);
    expect(unexpiredAmount(lots, NOW)).toBe(1300);
    expect(recomputeAmount(lots)).toBe(1500);
    expect(expiredLots(lots, NOW).map((l) => l.lotId)).toEqual(["old"]);
    expect(nextExpiry(lots)).toBe(NOW - DAY);
  });
});

describe("consumeFEFO", () => {
  it("takes the earliest-expiring lot first, never-expiring last", () => {
    const lots = [lot("late", 300, 9), lot("never", 500, null), lot("soon", 200, 2)];
    const r = consumeFEFO(lots, 400, NOW);
    expect(r.takes).toEqual([
      { lotId: "soon", amount: 200 },
      { lotId: "late", amount: 200 },
    ]);
    expect(r.lots.map((l) => [l.lotId, l.amount])).toEqual([
      ["late", 100],
      ["never", 500],
    ]);
    expect(sum(r.txs)).toBe(-400);
    expect(r.short).toBe(0);
  });
  it("skips expired lots unless nothing else is left", () => {
    const lots = [lot("expired", 300, -2), lot("fresh", 100, 4)];
    const a = consumeFEFO(lots, 100, NOW);
    expect(a.takes).toEqual([{ lotId: "fresh", amount: 100 }]);
    const b = consumeFEFO(lots, 250, NOW);
    expect(b.takes).toEqual([
      { lotId: "fresh", amount: 100 },
      { lotId: "expired", amount: 150 },
    ]);
  });
  it("never goes below zero; reports the shortfall", () => {
    const r = consumeFEFO([lot("a", 100, 3)], 160, NOW);
    expect(r.lots).toEqual([]);
    expect(r.short).toBe(60);
    expect(r.txs[0]!.note).toContain("short by 60");
  });
});

describe("corrections, discards, freezing", () => {
  const mk = () => lot("new", 0, 5);
  it("corrects down from the earliest-expiring lot (expired first) and up into the latest fresh lot (R8.8)", () => {
    const lots = [lot("exp", 100, -1), lot("a", 200, 2), lot("b", 300, 6)];
    const down = applyCorrection(lots, 450, NOW, mk);
    expect(down.lots.map((l) => [l.lotId, l.amount])).toEqual([
      ["a", 150],
      ["b", 300],
    ]);
    expect(sum(down.txs)).toBe(-150);
    const up = applyCorrection(lots, 700, NOW, mk);
    expect(up.lots.find((l) => l.lotId === "b")!.amount).toBe(400);
    expect(up.txs).toEqual([{ delta: 100, kind: "correction", lotId: "b" }]);
  });
  it("starts a lot when correcting up with none to add to", () => {
    const r = applyCorrection([], 250, NOW, mk);
    expect(r.lots).toEqual([{ ...mk(), amount: 250 }]);
  });
  it("discards part or all of a lot (R8.9)", () => {
    const lots = [lot("a", 200, 2)];
    expect(discardLot(lots, "a", 50).lots[0]!.amount).toBe(150);
    const all = discardLot(lots, "a");
    expect(all.lots).toEqual([]);
    expect(all.txs).toEqual([{ delta: -200, kind: "discard", lotId: "a" }]);
  });
  it("freezing part of a lot splits it, keeping both expiries (R8.6)", () => {
    const r = freezeLot([lot("chicken", 3000, 2)], "chicken", 2000, NOW, NOW + 180 * DAY);
    expect(r.frozenLotId).toBe("chicken-f1");
    const fresh = r.lots.find((l) => l.lotId === "chicken")!;
    const frozen = r.lots.find((l) => l.lotId === "chicken-f1")!;
    expect([fresh.amount, frozen.amount]).toEqual([1000, 2000]);
    expect(frozen.location).toBe("freezer");
    expect(frozen.expiresFreshMs).toBe(NOW + 2 * DAY);
    expect(activeExpiry(frozen)).toBe(NOW + 180 * DAY);
    expect(sum(r.txs)).toBe(0);
  });
  it("thaws back to the fridge with a short fresh life", () => {
    const frozen = lot("f", 500, -10, { frozenAtMs: NOW - 20 * DAY, expiresFrozenMs: NOW + 100 * DAY, location: "freezer" });
    const r = thawLot([frozen], "f", undefined, NOW + 2 * DAY);
    expect(r.lots[0]).toMatchObject({ location: "fridge", frozenAtMs: null, expiresFreshMs: NOW + 2 * DAY, expiresFrozenMs: NOW + 100 * DAY });
    expect(isExpired(r.lots[0]!, NOW)).toBe(false);
  });
  it("Still good makes an expired lot count again (R8.15)", () => {
    const lots = [lot("a", 100, -1)];
    expect(unexpiredAmount(lots, NOW)).toBe(0);
    const r = extendExpiry(lots, "a", NOW + 3 * DAY);
    expect(unexpiredAmount(r.lots, NOW)).toBe(100);
    expect(r.txs).toEqual([{ delta: 0, kind: "extendExpiry", lotId: "a" }]);
  });
  it("refund puts amounts back where they came from, recreating used-up lots", () => {
    const start = [lot("a", 100, 2), lot("b", 500, 6)];
    const c = consumeFEFO(start, 300, NOW);
    const r = refund(c.lots, c.takes, 250, () => lot("new", 0, 5));
    expect(r.lots.find((l) => l.lotId === "b")!.amount).toBe(500);
    expect(r.lots.find((l) => l.lotId === "a")!.amount).toBe(50);
    expect(sum(r.txs)).toBe(250);
  });
  it("low stock: nothing left, below a quarter pack, or short for the plan", () => {
    expect(isLowStock(0, 400)).toBe(true);
    expect(isLowStock(90, 400)).toBe(true);
    expect(isLowStock(200, 400)).toBe(false);
    expect(isLowStock(200, null, -10)).toBe(true);
  });
});

// ---------- properties (TECHNICAL_SPECS §14): Σ transactions == amount; FEFO; never below zero per lot

type Op =
  | { k: "buy"; amount: number; days: number | null }
  | { k: "use"; amount: number }
  | { k: "fix"; target: number }
  | { k: "toss"; idx: number; amount: number }
  | { k: "freeze"; idx: number; amount: number }
  | { k: "thaw"; idx: number }
  | { k: "extend"; idx: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant("buy" as const), amount: fc.integer({ min: 1, max: 2000 }), days: fc.option(fc.integer({ min: -5, max: 30 }), { nil: null }) }),
  fc.record({ k: fc.constant("use" as const), amount: fc.integer({ min: 0, max: 3000 }) }),
  fc.record({ k: fc.constant("fix" as const), target: fc.integer({ min: 0, max: 4000 }) }),
  fc.record({ k: fc.constant("toss" as const), idx: fc.nat(10), amount: fc.integer({ min: 0, max: 1000 }) }),
  fc.record({ k: fc.constant("freeze" as const), idx: fc.nat(10), amount: fc.integer({ min: 1, max: 1000 }) }),
  fc.record({ k: fc.constant("thaw" as const), idx: fc.nat(10) }),
  fc.record({ k: fc.constant("extend" as const), idx: fc.nat(10) }),
);

describe("ledger properties", () => {
  it("Σ transactions == Σ lots after any sequence; no lot ever negative", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let lots: LedgerLot[] = [];
        let total = 0;
        let n = 0;
        for (const op of ops) {
          const pick = (i: number) => lots[i % Math.max(1, lots.length)]?.lotId ?? "none";
          let r: { lots: LedgerLot[]; txs: LedgerTx[] };
          switch (op.k) {
            case "buy":
              r = applyPurchase(lots, lot(`l${n++}`, op.amount, op.days));
              break;
            case "use":
              r = consumeFEFO(lots, op.amount, NOW);
              break;
            case "fix":
              r = applyCorrection(lots, op.target, NOW, () => lot(`c${n++}`, 0, 5));
              break;
            case "toss":
              r = discardLot(lots, pick(op.idx), op.amount);
              break;
            case "freeze":
              r = freezeLot(lots, pick(op.idx), op.amount, NOW, NOW + 90 * DAY);
              break;
            case "thaw":
              r = thawLot(lots, pick(op.idx), undefined, NOW + 2 * DAY);
              break;
            case "extend":
              r = extendExpiry(lots, pick(op.idx), NOW + 3 * DAY);
              break;
          }
          total += sum(r.txs);
          lots = r.lots;
          for (const l of lots) expect(l.amount).toBeGreaterThanOrEqual(0);
          expect(Math.abs(total - recomputeAmount(lots))).toBeLessThan(1e-3);
          expect(new Set(lots.map((l) => l.lotId)).size).toBe(lots.length);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("FEFO: a lot is only taken from once every lot ahead of it in FEFO order is used up", () => {
    const lotsArb = fc.array(
      fc.record({ amount: fc.integer({ min: 1, max: 1000 }), days: fc.option(fc.integer({ min: -5, max: 30 }), { nil: null }) }),
      { minLength: 1, maxLength: 8 },
    );
    fc.assert(
      fc.property(lotsArb, fc.integer({ min: 0, max: 6000 }), (spec, want) => {
        const lots = spec.map((s, i) => lot(`l${i}`, s.amount, s.days));
        const order = fefoOrder(lots, NOW).map((l) => l.lotId);
        const r = consumeFEFO(lots, want, NOW);
        const taken = new Map(r.takes.map((t) => [t.lotId, t.amount]));
        // Every lot before the last one touched is drained.
        const lastIdx = Math.max(-1, ...r.takes.map((t) => order.indexOf(t.lotId)));
        for (let i = 0; i < lastIdx; i++) {
          const id = order[i]!;
          const orig = lots.find((l) => l.lotId === id)!.amount;
          expect(Math.abs((taken.get(id) ?? 0) - orig)).toBeLessThan(EPS * 10);
        }
        // Expired lots are touched only when every unexpired lot is used up.
        const unexpired = unexpiredAmount(lots, NOW);
        const fromExpired = r.takes.filter((t) => isExpired(lots.find((l) => l.lotId === t.lotId)!, NOW)).reduce((s, t) => s + t.amount, 0);
        if (fromExpired > 0) expect(want).toBeGreaterThan(unexpired - EPS);
        expect(Math.abs(r.takes.reduce((s, t) => s + t.amount, 0) + r.short - want)).toBeLessThan(1e-3);
      }),
      { numRuns: 300 },
    );
  });
});
