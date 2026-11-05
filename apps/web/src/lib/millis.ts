/** Milliseconds of a Firestore Timestamp (or a Date); null when absent or not a time. One copy for the app (M23). */
export function millis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}
