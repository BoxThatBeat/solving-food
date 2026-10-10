import { FirebaseError } from "firebase/app";

/** The address the link was sent to, kept for the finish step (same browser). */
export const SIGN_IN_EMAIL_KEY = "sf.signInEmail";

export function storeSignInEmail(email: string): void {
  try {
    localStorage.setItem(SIGN_IN_EMAIL_KEY, email);
  } catch {
    /* ignore */
  }
}

export function takeStoredSignInEmail(): string | null {
  try {
    return localStorage.getItem(SIGN_IN_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function clearStoredSignInEmail(): void {
  try {
    localStorage.removeItem(SIGN_IN_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

export function signInFinishUrl(): string {
  return `${window.location.origin}/sign-in/finish`;
}

export function authErrorMessage(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : "";
  switch (code) {
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "This sign-in link has expired or was already used. Ask for a new one.";
    case "auth/invalid-email":
      return "That email address doesn't match the sign-in link.";
    case "auth/missing-email":
      return "Enter your email address.";
    case "auth/network-request-failed":
      return "No connection. Try again when you're online.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/quota-exceeded":
      return "Today's sign-in email quota is used up. Try again tomorrow.";
    default:
      return "Something went wrong. Try again.";
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function looksLikeEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}
