// Cooking timers in the page (PRD R4.23; TECHNICAL_SPECS §12 "Cooking timers"): wall-clock end times (core timers.ts)
// kept in sessionStorage so a reload or a suspended tab keeps them right; an alarm (Web Audio beeps) and vibration when
// one ends; and the locked-phone push scheduled and cancelled through the timer callables.
import * as React from "react";
import { adjustTimer, newTimer, pauseTimer, startTimer, tickTimers, type CookTimer } from "@solving-food/core";
import { cancelPush, pushSupport, schedulePush } from "@/pwa/push";

const KEY = (k: string) => `sf.timers.${k}`;

function load(key: string): CookTimer[] {
  try {
    const raw = sessionStorage.getItem(KEY(key));
    return raw ? (JSON.parse(raw) as CookTimer[]) : [];
  } catch {
    return [];
  }
}

let audio: AudioContext | null = null;
/** A short, loud three-beep alarm, synthesised (no audio file to fetch offline). */
export function playAlarm(): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 880;
      const t = ctx.currentTime + i * 0.45;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    }
  } catch {
    /* no audio: vibration and the banner still fire */
  }
  try {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  } catch {
    /* ignore */
  }
}

export interface TimerContext {
  uid: string;
  /** "Salmon" in "Salmon: roast done". */
  title: string;
  /** Where the push opens: the recipe at that step. */
  linkFor: (t: CookTimer) => string;
  onFinished?: (t: CookTimer) => void;
  /** First timer on iOS Safari outside the installed app: ask to install first. */
  onNeedsInstall?: () => void;
  onOfflineStart?: () => void;
}

export function useCookTimers(sessionKey: string, ctx: TimerContext) {
  const [timers, setTimers] = React.useState<CookTimer[]>(() => load(sessionKey));
  const [now, setNow] = React.useState(() => Date.now());
  const ctxRef = React.useRef(ctx);
  React.useEffect(() => {
    ctxRef.current = ctx;
  });
  const askedInstall = React.useRef(false);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(KEY(sessionKey), JSON.stringify(timers));
    } catch {
      /* ignore */
    }
  }, [timers, sessionKey]);

  const running = timers.some((t) => t.state === "running");
  React.useEffect(() => {
    if (!running) return;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      setTimers((list) => {
        const r = tickTimers(list, n);
        if (!r.finished.length) return list;
        for (const f of r.finished) {
          playAlarm();
          ctxRef.current.onFinished?.(f);
        }
        return r.timers;
      });
    };
    const id = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running]);

  const push = (t: CookTimer) => {
    if (t.state !== "running" || t.endsAtMs === null) return;
    const c = ctxRef.current;
    void schedulePush(c.uid, { timerId: t.id, endsAt: t.endsAtMs, label: t.label, title: c.title, link: c.linkFor(t) });
  };

  const start = (t: CookTimer) => {
    const support = pushSupport();
    if (support === "needs-install" && !askedInstall.current) {
      askedInstall.current = true;
      ctxRef.current.onNeedsInstall?.();
    }
    if (!navigator.onLine) ctxRef.current.onOfflineStart?.();
    const n = Date.now();
    const s = startTimer(t, n);
    setNow(n);
    setTimers((list) => (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? s : x)) : [...list, s]));
    push(s);
  };

  return {
    timers,
    now,
    get: (id: string) => timers.find((t) => t.id === id),
    /** Starts (or resumes) a timer, creating it from `template` the first time. */
    start: (id: string, template: () => CookTimer) => start(timers.find((t) => t.id === id) ?? template()),
    pause: (id: string) => {
      setTimers((list) => list.map((t) => (t.id === id ? pauseTimer(t, Date.now()) : t)));
      void cancelPush(id);
    },
    cancel: (id: string) => {
      setTimers((list) => list.filter((t) => t.id !== id));
      void cancelPush(id);
    },
    adjust: (id: string, deltaMs: number) => {
      const t = timers.find((x) => x.id === id);
      if (!t) return;
      const a = adjustTimer(t, deltaMs, Date.now());
      setTimers((list) => list.map((x) => (x.id === id ? a : x)));
      push(a); // reschedules the push under a new task (§12)
    },
    dismiss: (id: string) => setTimers((list) => list.filter((t) => t.id !== id)),
    /** Done cooking: no more alerts for this meal. */
    cancelAll: () => {
      for (const t of timers) if (t.state === "running") void cancelPush(t.id);
      setTimers([]);
    },
  };
}

export { newTimer };
