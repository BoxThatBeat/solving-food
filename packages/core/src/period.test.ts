import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addDays,
  dayOfPeriod,
  firstPeriod,
  formatPeriodRange,
  isEnded,
  localDate,
  localMidnight,
  nextPeriod,
  periodBounds,
  periodCells,
} from "./period";

const TZ = "America/Toronto";
const H = 3_600_000;

describe("periods in America/Toronto", () => {
  it("starts and ends at local midnight", () => {
    const b = periodBounds("2026-10-05", 7, TZ);
    expect(b.id).toBe("2026-10-05");
    expect(new Date(b.startMs).toISOString()).toBe("2026-10-05T04:00:00.000Z"); // EDT
    expect(new Date(b.endMs).toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(b.endDate).toBe("2026-10-12");
  });

  it("spans the autumn DST change (a 7-day period is 169 hours)", () => {
    const b = periodBounds("2026-10-30", 7, TZ); // DST ends 1 Nov 2026
    expect(new Date(b.startMs).toISOString()).toBe("2026-10-30T04:00:00.000Z");
    expect(new Date(b.endMs).toISOString()).toBe("2026-11-06T05:00:00.000Z"); // EST
    expect((b.endMs - b.startMs) / H).toBe(169);
    expect(periodCells(b.startMs, b.endMs, TZ)).toHaveLength(7);
  });

  it("spans the spring DST change (167 hours)", () => {
    const b = periodBounds("2027-03-12", 7, TZ); // DST starts 14 Mar 2027
    expect((b.endMs - b.startMs) / H).toBe(167);
    expect(periodCells(b.startMs, b.endMs, TZ).map((c) => c.weekday)).toEqual(["FRI", "SAT", "SUN", "MON", "TUE", "WED", "THU"]);
  });

  it("the first period starts today, local time", () => {
    // 23:30 on 9 Oct in Toronto is already 10 Oct in UTC.
    const now = Date.parse("2026-10-10T03:30:00Z");
    expect(firstPeriod(now, 7, TZ).startDate).toBe("2026-10-09");
  });

  it("the next period starts where the last ended, skipping periods nobody opened", () => {
    const p = periodBounds("2026-10-05", 7, TZ);
    expect(isEnded(p, p.endMs - 1)).toBe(false);
    expect(isEnded(p, p.endMs)).toBe(true);
    expect(nextPeriod(p.endMs, 7, TZ, p.endMs + H).startDate).toBe("2026-10-12");
    // Three weeks later: lands on the period containing now, aligned to the original boundary.
    const later = Date.parse("2026-11-03T15:00:00Z");
    const n = nextPeriod(p.endMs, 7, TZ, later);
    expect(n.startDate).toBe("2026-11-02");
    expect(n.startMs <= later && later < n.endMs).toBe(true);
    // A changed length applies to the next period.
    expect(nextPeriod(p.endMs, 3, TZ, p.endMs).endDate).toBe("2026-10-15");
  });

  it("labels cells and the range", () => {
    const b = periodBounds("2026-10-05", 7, TZ);
    const cells = periodCells(b.startMs, b.endMs, TZ);
    expect(cells[0]).toEqual({ date: "2026-10-05", weekday: "MON", day: "5", label: "Mon 5 Oct" });
    expect(formatPeriodRange(b.startMs, b.endMs, TZ)).toBe("5–11 OCT");
    const c = periodBounds("2026-09-28", 7, TZ);
    expect(formatPeriodRange(c.startMs, c.endMs, TZ)).toBe("28 SEP–4 OCT");
    expect(dayOfPeriod(Date.parse("2026-10-09T16:00:00Z"), b.startMs, b.endMs, TZ)).toBe(5);
  });

  it("property: periods tile time without gaps, in any zone", () => {
    const zones = ["America/Toronto", "Europe/London", "Australia/Sydney", "Asia/Kolkata", "UTC"];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 1, max: 28 }), fc.constantFrom(...zones), (offset, days, tz) => {
        const start = addDays("2025-01-01", offset);
        const a = periodBounds(start, days, tz);
        const b = nextPeriod(a.endMs, days, tz, a.endMs);
        expect(b.startMs).toBe(a.endMs);
        expect(localDate(a.startMs, tz)).toBe(start);
        expect(localMidnight(a.endDate, tz)).toBe(a.endMs);
        expect(periodCells(a.startMs, a.endMs, tz)).toHaveLength(days);
      }),
      { numRuns: 300 },
    );
  });
});
