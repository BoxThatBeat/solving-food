// First-run profile (Planning/M0 §4): the display name creates users/{uid} and directory/{uid}.

import { DEFAULT_THEME, normalizeTheme, type Theme } from "./theme";
import { displayNameSchema, type DirectoryDoc, type UserDoc } from "./types";

/** Firebase lower-cases emails, but invites and the allowlist key on the lower-cased, trimmed address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildProfile(
  input: { email: string; displayName: string; theme?: Theme },
): { user: Omit<UserDoc, "createdAt">; directory: DirectoryDoc } {
  const displayName = displayNameSchema.parse(input.displayName);
  return {
    user: {
      email: normalizeEmail(input.email),
      activeHouseholdId: null,
      householdsCreated: 0,
      theme: normalizeTheme(input.theme ?? DEFAULT_THEME),
    },
    directory: { displayName, displayNameLower: displayName.toLowerCase() },
  };
}
