// Hidden hands-free diagnostics (M13): a ring buffer of the last events (microphone, audio context, segments,
// transcriptions, commands, speech), kept only when the owner opened a cook page with `?voicedebug=1` (remembered in
// localStorage until `?voicedebug=0`). Imported by the lazy voice chunks only, never by the main bundle; without the
// flag `diag()` returns at once and nothing is kept. Events never contain audio; transcripts stay on the device.

export const DIAG_KEY = "sf.voiceDebug";
/**
 * Overrides the iOS rule (M13), set from the diagnostics sheet: "1" = keep listening while the app speaks (talk over
 * the voice) even on iOS, "0" = pause while speaking everywhere. Unset: pause on iOS only. Read at each start.
 */
export const TALK_OVER_KEY = "sf.handsFree.talkOver";
const MAX = 50;

export interface DiagEvent {
  /** `Date.now()` */
  at: number;
  event: string;
  detail: string;
}

/** Reads `?voicedebug=1|0` (and remembers it), then the stored flag. */
export function readDiagFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("voicedebug");
    if (q === "1") localStorage.setItem(DIAG_KEY, "1");
    if (q === "0") localStorage.removeItem(DIAG_KEY);
    if (q === "1" || q === "0") return q === "1";
    return localStorage.getItem(DIAG_KEY) === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("voicedebug") === "1";
  }
}

let enabled = readDiagFlag();
let events: DiagEvent[] = [];
const listeners = new Set<() => void>();

export function diagEnabled(): boolean {
  return enabled;
}

/** Re-reads the flag (a client-side navigation to a URL with `?voicedebug=1`). */
export function refreshDiagFlag(): boolean {
  enabled = readDiagFlag();
  return enabled;
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 4 : 0);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Records an event when diagnostics are on. `detail` is a short text or flat key/value pairs. */
export function diag(event: string, detail?: string | Record<string, unknown>): void {
  if (!enabled) return;
  const d = typeof detail === "string" ? detail : detail ? Object.entries(detail).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${fmt(v)}`).join(" ") : "";
  events = [...events, { at: Date.now(), event, detail: d }].slice(-MAX);
  for (const fn of listeners) fn();
}

export function diagEvents(): DiagEvent[] {
  return events;
}

export function subscribeDiag(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearDiag(): void {
  events = [];
  for (const fn of listeners) fn();
}

/** The log as text for the owner to paste: one event per line, wall-clock time with milliseconds. */
export function diagText(list: readonly DiagEvent[] = events): string {
  const head = typeof navigator !== "undefined" ? `hands-free diagnostics, ${new Date().toISOString()}\n${navigator.userAgent}\n` : "";
  return head + list.map((e) => `${new Date(e.at).toISOString().slice(11, 23)} ${e.event}${e.detail ? ` ${e.detail}` : ""}`).join("\n");
}

/** Test hook: switch on without the URL. */
export function setDiagEnabled(on: boolean): void {
  enabled = on;
}
