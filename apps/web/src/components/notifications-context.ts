import * as React from "react";

export type NotificationKind = "info" | "success" | "error";

export interface Banner {
  id: string;
  kind: NotificationKind;
  message: string;
  link?: { to: string; label: string };
}

export interface NotificationsCtx {
  notify: (b: Omit<Banner, "id">) => string;
  dismiss: (id: string) => void;
  banners: Banner[];
}

export const NotificationsContext = React.createContext<NotificationsCtx | null>(null);

export function useNotify(): NotificationsCtx["notify"] {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotify outside NotificationsProvider");
  return ctx.notify;
}
