import { useSyncExternalStore } from "react";
import { session, type Session } from "./session";

export function useSession(): Session {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** For components inside the signed-in shell, where the guard guarantees a ready session. */
export function useReadySession(): Extract<Session, { status: "ready" }> {
  const s = useSession();
  if (s.status !== "ready") throw new Error(`Expected a ready session, got ${s.status}`);
  return s;
}
