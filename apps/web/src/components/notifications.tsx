// <NotificationBanners> (TECHNICAL_SPECS §12, R12.1). M0: local, client-only messages. M1 adds the live listener on
// users/{uid}/notifications and merges it into the same stack.

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationsContext, type Banner, type NotificationKind } from "./notifications-context";

const AUTO_DISMISS_MS = 6000;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [banners, setBanners] = React.useState<Banner[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setBanners((bs) => bs.filter((b) => b.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const notify = React.useCallback(
    (b: Omit<Banner, "id">) => {
      const id = crypto.randomUUID();
      setBanners((bs) => [...bs, { ...b, id }]);
      // Success and info disappear on their own; errors stay until dismissed (R12.1).
      if (b.kind !== "error") timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
      return id;
    },
    [dismiss],
  );

  React.useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  const value = React.useMemo(() => ({ notify, dismiss, banners }), [notify, dismiss, banners]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

const KIND_STYLE: Record<NotificationKind, string> = {
  info: "bg-ink text-base shadow-toast",
  success: "bg-ink text-base shadow-toast",
  error: "bg-red text-onc shadow-hard",
};

/** Bottom-of-page stack; sits above the phone tab bar (`bottomOffset`). */
export function NotificationBanners({ className }: { className?: string }) {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx || ctx.banners.length === 0) return null;
  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 z-30 flex flex-col items-center gap-2 px-4", className)}
      aria-live="polite"
    >
      {ctx.banners.map((b) => (
        <div
          key={b.id}
          role={b.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex max-w-[min(92vw,40rem)] items-center gap-3 rounded-ui border-2 border-line px-3.5 py-2.5 text-[0.8125rem] font-extrabold",
            KIND_STYLE[b.kind],
          )}
        >
          <span className="min-w-0 flex-1">{b.message}</span>
          {b.link ? (
            <Link to={b.link.to} className="flex-none text-inherit underline" onClick={() => ctx.dismiss(b.id)}>
              {b.link.label}
            </Link>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => ctx.dismiss(b.id)}
            className="grid size-6 flex-none cursor-pointer place-items-center bg-transparent text-inherit"
          >
            <X aria-hidden className="size-4" strokeWidth={3} />
          </button>
        </div>
      ))}
    </div>
  );
}
