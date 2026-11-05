// Listener failures in one place (M23): every live read reports its errors here instead of treating them as "missing".
// Dev builds log them; <ListenerErrorBanner> (components/notifications.tsx) turns the ones a person should know about
// (permission-denied, unavailable) into a non-blocking banner (R12.1).

export interface ListenerError {
  /** What was being listened to: a path or a query key, e.g. `households/abc/planItems?period=…`. */
  label: string;
  code: string;
  message: string;
}

type Sink = (e: ListenerError) => void;
const sinks = new Set<Sink>();

export function codeOf(error: unknown): string {
  const c = (error as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "unknown";
}

export function reportListenerError(label: string, error: unknown): void {
  const e: ListenerError = { label, code: codeOf(error), message: error instanceof Error ? error.message : String(error) };
  if (import.meta.env.DEV) console.error(`listener failed: ${label} (${e.code})`, error);
  for (const s of sinks) s(e);
}

export function onListenerError(fn: Sink): () => void {
  sinks.add(fn);
  return () => sinks.delete(fn);
}

/** The household a listener label belongs to, if any (`households/<hid>/…`). */
export function householdOf(label: string): string | null {
  return /^households\/([^/?#]+)/.exec(label)?.[1] ?? null;
}

/** Codes worth telling the person about; anything else is logged only. */
export function bannerFor(code: string): { kind: "error" | "info"; message: string } | null {
  if (code === "permission-denied") return { kind: "error", message: "Some of this page couldn't load: you may not have access to it any more. Reload to try again." };
  if (code === "unavailable") return { kind: "info", message: "Can't reach the server. Showing what's saved on this device." };
  return null;
}
