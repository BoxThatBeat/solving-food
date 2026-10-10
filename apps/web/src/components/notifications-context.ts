import * as React from "react";

export type NotificationKind = "info" | "success" | "error";

export interface Banner {
  id: string;
  kind: NotificationKind;
  message: string;
  link?: { to: string; label: string };
  /** An in-banner action, e.g. Undo. Running it dismisses the banner. */
  action?: { label: string; run: () => void };
  /** Called when the banner is dismissed (by the user or the auto-dismiss timer), e.g. to write `dismissedAt`. */
  onDismiss?: () => void;
}

export interface NotificationsCtx {
  /** Shows a banner. Passing an `id` that's already shown does nothing (Firestore feed de-duplication). */
  notify: (b: Omit<Banner, "id"> & { id?: string }) => string;
  /** Dismisses a banner and runs its onDismiss. */
  dismiss: (id: string) => void;
  /** Removes a banner without running onDismiss (it was dismissed elsewhere, e.g. on another device). */
  retract: (id: string) => void;
  banners: Banner[];
}

export const NotificationsContext = React.createContext<NotificationsCtx | null>(null);

export function useNotifications(): NotificationsCtx {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications outside NotificationsProvider");
  return ctx;
}

export function useNotify(): NotificationsCtx["notify"] {
  return useNotifications().notify;
}
