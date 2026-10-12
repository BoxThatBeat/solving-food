import { describe, expect, it } from "vitest";
import { adjustTimer, formatClock, formatDuration, formatMinutes, newTimer, pauseTimer, remainingMs, startTimer, tickTimers, timerPushData, timerTaskId } from "./timers";

const T0 = 1_000_000;

describe("timers (R4.23)", () => {
  it("runs on wall-clock end times, pauses and resumes", () => {
    let t = startTimer(newTimer("t", "Roast", 600_000), T0);
    expect(t.endsAtMs).toBe(T0 + 600_000);
    expect(remainingMs(t, T0 + 100_000)).toBe(500_000);
    t = pauseTimer(t, T0 + 100_000);
    expect(t.state).toBe("paused");
    expect(remainingMs(t, T0 + 999_999)).toBe(500_000);
    t = startTimer(t, T0 + 200_000);
    expect(t.endsAtMs).toBe(T0 + 700_000);
  });
  it("adjusts running and paused timers, never below zero", () => {
    const run = adjustTimer(startTimer(newTimer("t", "x", 60_000), T0), 60_000, T0);
    expect(run.endsAtMs).toBe(T0 + 120_000);
    expect(adjustTimer(run, -999_000, T0 + 1).endsAtMs).toBe(T0 + 1);
    expect(adjustTimer(newTimer("t", "x", 60_000), -90_000, T0).remainingMs).toBe(0);
  });
  it("ticks finished timers to done once", () => {
    const list = [startTimer(newTimer("a", "a", 1000), T0), startTimer(newTimer("b", "b", 5000), T0)];
    const r = tickTimers(list, T0 + 2000);
    expect(r.finished.map((t) => t.id)).toEqual(["a"]);
    expect(tickTimers(r.timers, T0 + 2500).finished).toEqual([]);
    expect(startTimer(r.timers[0]!, T0 + 3000).endsAtMs).toBe(T0 + 4000); // restart from the full duration
  });
  it("formats clocks and durations", () => {
    expect(formatClock(600_000)).toBe("10:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatDuration(5_400_000)).toBe("1 h 30 min");
  });
  it("formats recipe durations with m and h", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(80)).toBe("1h 20m");
    expect(formatMinutes(120)).toBe("2h");
  });
  it("task IDs are unique per run and URL-safe; push data names the timer", () => {
    expect(timerTaskId("u/1", "t", 5)).toBe("t-u-1-t-5");
    expect(timerPushData({ label: "Roast done", title: "Salmon", link: "/recipes/r/cook?step=2", timerId: "t" })).toEqual({ kind: "timer", title: "Salmon: Roast done", body: "Timer done", link: "/recipes/r/cook?step=2", timerId: "t" });
  });
});
