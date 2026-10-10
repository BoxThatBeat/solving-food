// Route guards (Planning/M0 §4): `beforeLoad` helpers for signed-in, allowlisted, has-profile, and has-household.

import { redirect } from "@tanstack/react-router";
import type { Session, SessionStatus, SessionStore } from "./session";

/** Where each session state belongs when it lands somewhere it can't be. */
function homeFor(s: Session): string {
  switch (s.status) {
    case "signedOut":
      return "/sign-in";
    case "notInvited":
      return "/not-invited";
    case "needsProfile":
      return "/welcome";
    case "needsHousehold":
      return "/welcome/household";
    default:
      return "/";
  }
}

/** Waits for the session, then redirects unless its status is one of `allowed`. */
export async function requireStatus<S extends SessionStatus>(
  store: SessionStore,
  allowed: readonly S[],
): Promise<Extract<Session, { status: S }>> {
  const s = await store.settled();
  if (!(allowed as readonly SessionStatus[]).includes(s.status)) {
    if (s.status === "notInvited") throw redirect({ to: "/not-invited", search: { email: s.email } });
    throw redirect({ to: homeFor(s) });
  }
  return s as Extract<Session, { status: S }>;
}
