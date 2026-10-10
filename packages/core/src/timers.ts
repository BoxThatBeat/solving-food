// Cooking timers (PRD R4.23; TECHNICAL_SPECS §12 "Cooking timers"). Wall-clock end times, so a timer stays right after
// the tab is suspended or the phone sleeps; pause stores what's left. Pure state transitions: the web app keeps the
// list (and persists it locally), the functions schedule the push for `endsAtMs`.

export type TimerState = "running" | "paused" | "done";

export interface CookTimer {
  id: string;
  label: string;
  durationMs: number;
  state: TimerState;
  /** Wall-clock end while running. */
  endsAtMs: number | null;
  /** What's left while paused (or the full duration before starting). */
  remainingMs: number;
  recipeId?: string;
  stepIndex?: number;
}

export function newTimer(id: string, label: string, durationMs: number, extra: Pick<CookTimer, "recipeId" | "stepIndex"> = {}): CookTimer {
  return { id, label, durationMs, state: "paused", endsAtMs: null, remainingMs: durationMs, ...extra };
}

export function startTimer(t: CookTimer, nowMs: number): CookTimer {
  if (t.state === "running") return t;
  const remaining = t.state === "done" ? t.durationMs : t.remainingMs;
  return { ...t, state: "running", endsAtMs: nowMs + remaining, remainingMs: remaining };
}

export function pauseTimer(t: CookTimer, nowMs: number): CookTimer {
  if (t.state !== "running" || t.endsAtMs === null) return t;
  return { ...t, state: "paused", remainingMs: Math.max(0, t.endsAtMs - nowMs), endsAtMs: null };
}

/** Adds (or with a negative value, takes off) time. Running timers move their end; never below zero. */
export function adjustTimer(t: CookTimer, deltaMs: number, nowMs: number): CookTimer {
  if (t.state === "running" && t.endsAtMs !== null) {
    const endsAtMs = Math.max(nowMs, t.endsAtMs + deltaMs);
    return { ...t, endsAtMs, remainingMs: endsAtMs - nowMs, durationMs: Math.max(0, t.durationMs + deltaMs) };
  }
  const remainingMs = Math.max(0, t.remainingMs + deltaMs);
  return { ...t, remainingMs, durationMs: Math.max(remainingMs, t.durationMs + deltaMs), state: t.state === "done" && remainingMs > 0 ? "paused" : t.state };
}

export function remainingMs(t: CookTimer, nowMs: number): number {
  if (t.state === "running" && t.endsAtMs !== null) return Math.max(0, t.endsAtMs - nowMs);
  if (t.state === "done") return 0;
  return t.remainingMs;
}

/** Marks running timers whose end has passed as done; returns the new list and the ones that just finished. */
export function tickTimers(list: readonly CookTimer[], nowMs: number): { timers: CookTimer[]; finished: CookTimer[] } {
  const finished: CookTimer[] = [];
  const timers = list.map((t) => {
    if (t.state === "running" && t.endsAtMs !== null && nowMs >= t.endsAtMs) {
      const done = { ...t, state: "done" as const, remainingMs: 0 };
      finished.push(done);
      return done;
    }
    return t;
  });
  return { timers, finished };
}

/** "9:58", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "10 min", "1 h 30 min", "45 s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** Cloud Tasks task name for a timer run: unique per (uid, timer, end time), since deleted names can't be reused soon. */
export function timerTaskId(uid: string, timerId: string, endsAtMs: number): string {
  return `t-${uid}-${timerId}-${endsAtMs}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 500);
}

/** The push payload a fired timer sends (data-only web push; the service worker shows it). */
export function timerPushData(t: { label: string; title?: string | undefined; link: string; timerId: string }): Record<string, string> {
  return {
    kind: "timer",
    title: t.title ? `${t.title}: ${t.label}` : t.label,
    body: "Timer done",
    link: t.link,
    timerId: t.timerId,
  };
}
