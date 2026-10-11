// Plan periods (PRD §3 "The plan period", R6.6, R11.5, R11.11; TECHNICAL_SPECS §7 "Periods & rollover").
//
// A period runs from local midnight on its start date for `periodDays` days, in the household's timezone. Its ID is
// the start date ("2026-10-10"), so two members rolling over at the same moment compute the same document and the
// transaction stays idempotent. No date library: offsets come from Intl, which handles DST.

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" */
export type LocalDate = string;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

function parts(ms: number, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour! % 24, min: out.minute!, s: out.second! };
}

/** Milliseconds the zone is ahead of UTC at `ms` (Toronto in winter: −5 h). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant of local midnight at the start of `date` in `tz`. */
export function localMidnight(date: LocalDate, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const o1 = tzOffsetMs(guess, tz);
  let t = guess - o1;
  const o2 = tzOffsetMs(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

/** The local calendar date of an instant. */
export function localDate(ms: number, tz: string): LocalDate {
  const p = parts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const t = (s: LocalDate) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / DAY_MS);
}

export interface PeriodBounds {
  /** Document ID and first day. */
  id: string;
  startDate: LocalDate;
  /** Exclusive: the first day of the next period. */
  endDate: LocalDate;
  startMs: number;
  endMs: number;
}

/** `periodBounds(start, periodDays, timezone)`: local midnight to local midnight, DST-safe (a period can be 167 h). */
export function periodBounds(startDate: LocalDate, periodDays: number, tz: string): PeriodBounds {
  const endDate = addDays(startDate, Math.max(1, Math.round(periodDays)));
  return { id: startDate, startDate, endDate, startMs: localMidnight(startDate, tz), endMs: localMidnight(endDate, tz) };
}

/** The first period of a household: starts today. */
export function firstPeriod(nowMs: number, periodDays: number, tz: string): PeriodBounds {
  return periodBounds(localDate(nowMs, tz), periodDays, tz);
}

/**
 * The period after one that ended at `prevEndMs`: starts on the previous end date and, when the app wasn't opened for
 * a while, keeps stepping by `periodDays` until it contains `nowMs`. A changed period length applies from here (R11.5).
 */
export function nextPeriod(prevEndMs: number, periodDays: number, tz: string, nowMs: number): PeriodBounds {
  let b = periodBounds(localDate(prevEndMs, tz), periodDays, tz);
  for (let i = 0; b.endMs <= nowMs && i < 10_000; i++) b = periodBounds(b.endDate, periodDays, tz);
  return b;
}

export type RestartDay = "today" | "tomorrow";

/**
 * What "Restart period" (R3.1, Settings → Household) does. The new period starts at local midnight of today or
 * tomorrow and runs `periodDays` days.
 * - `noop`: the current period already starts on that day.
 * - `move`: the current period hasn't started yet (an earlier restart chose tomorrow): its own start and end move,
 *   nothing is carried and no period is created.
 * - `new`: a new period is created; the current one ends where the new one starts (`oldEndMs`, at most its own
 *   end), so periods never overlap and anything cooked or bought before then stays in the old one.
 */
export type RestartPlan =
  | { kind: "noop"; bounds: PeriodBounds }
  | { kind: "move"; bounds: PeriodBounds }
  | { kind: "new"; bounds: PeriodBounds; oldEndMs: number };

export function restartBounds(nowMs: number, day: RestartDay, periodDays: number, tz: string): PeriodBounds {
  return periodBounds(addDays(localDate(nowMs, tz), day === "tomorrow" ? 1 : 0), periodDays, tz);
}

export function planRestart(current: { startMs: number; endMs: number } | null, nowMs: number, day: RestartDay, periodDays: number, tz: string): RestartPlan {
  const bounds = restartBounds(nowMs, day, periodDays, tz);
  if (!current) return { kind: "new", bounds, oldEndMs: bounds.startMs };
  if (localDate(current.startMs, tz) === bounds.startDate) return { kind: "noop", bounds };
  if (current.startMs > bounds.startMs) return { kind: "move", bounds };
  return { kind: "new", bounds, oldEndMs: Math.min(current.endMs, bounds.startMs) };
}

/** The ID for a period starting on `date`: the date, or "date-2", "date-3"… when an earlier restart already used it. */
export function periodIdFor(date: LocalDate, taken: (id: string) => boolean): string {
  if (!taken(date)) return date;
  for (let n = 2; ; n++) if (!taken(`${date}-${n}`)) return `${date}-${n}`;
}

export function isEnded(period: { endMs: number }, nowMs: number): boolean {
  return nowMs >= period.endMs;
}

export interface DayCell {
  date: LocalDate;
  /** "MON" */
  weekday: string;
  /** "10" */
  day: string;
  /** "Mon 10 Oct", for screen readers and titles. */
  label: string;
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cellOf(date: LocalDate): DayCell {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const w = WEEKDAYS[wd]!;
  return { date, weekday: w, day: String(d), label: `${w.charAt(0)}${w.slice(1).toLowerCase()} ${d} ${MONTHS[m - 1]}` };
}

/** One cell per day of the period, for the coverage strip (R6.2). */
export function periodCells(startMs: number, endMs: number, tz: string): DayCell[] {
  const start = localDate(startMs, tz);
  const n = Math.max(1, daysBetween(start, localDate(endMs, tz)));
  return Array.from({ length: n }, (_, i) => cellOf(addDays(start, i)));
}

/** 1-based day of the period that `nowMs` falls on (clamped to the period). */
export function dayOfPeriod(nowMs: number, startMs: number, endMs: number, tz: string): number {
  const total = periodCells(startMs, endMs, tz).length;
  const d = daysBetween(localDate(startMs, tz), localDate(nowMs, tz)) + 1;
  return Math.min(total, Math.max(1, d));
}

/** "5–11 OCT", or "28 SEP–4 OCT" across months (the prototype's kicker). End is exclusive. */
export function formatPeriodRange(startMs: number, endMs: number, tz: string): string {
  const s = localDate(startMs, tz);
  const e = addDays(localDate(endMs, tz), -1);
  const [, sm, sd] = s.split("-").map(Number) as [number, number, number];
  const [, em, ed] = e.split("-").map(Number) as [number, number, number];
  const mon = (m: number) => MONTHS[m - 1]!.toUpperCase();
  if (s === e) return `${sd} ${mon(sm)}`;
  return sm === em ? `${sd}–${ed} ${mon(em)}` : `${sd} ${mon(sm)}–${ed} ${mon(em)}`;
}
