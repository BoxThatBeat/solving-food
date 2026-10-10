// <NotificationBanners> (TECHNICAL_SPECS §12, R12.1): one stack at the bottom of every page (above the phone tab bar),
// fed by local client-only messages and by the live listener on users/{uid}/notifications (<NotificationFeed>).
// Success and info disappear after ~6 s (and the Firestore ones are marked dismissed, so they stay dismissed on every
// device); errors stay until dismissed. Each can link to the related page.

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { collection, doc, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { X } from "lucide-react";
import type { NotificationDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveQuery } from "@/data/live";
import { cn } from "@/lib/utils";
import { NotificationsContext, useNotifications, type Banner, type NotificationKind } from "./notifications-context";

export const AUTO_DISMISS_MS = 6000;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [banners, setBanners] = React.useState<Banner[]>([]);
  const all = React.useRef(new Map<string, Banner>());
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = React.useCallback((id: string, runHook: boolean) => {
    const b = all.current.get(id);
    if (!b) return;
    all.current.delete(id);
    setBanners((bs) => bs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    if (runHook) b.onDismiss?.();
  }, []);

  const dismiss = React.useCallback((id: string) => remove(id, true), [remove]);
  const retract = React.useCallback((id: string) => remove(id, false), [remove]);

  const notify = React.useCallback(
    (input: Omit<Banner, "id"> & { id?: string }) => {
      const id = input.id ?? crypto.randomUUID();
      if (all.current.has(id)) return id;
      const b: Banner = { ...input, id };
      all.current.set(id, b);
      setBanners((bs) => [...bs, b]);
      // Success and info disappear on their own; errors stay until dismissed (R12.1).
      if (b.kind !== "error") timers.current.set(id, setTimeout(() => remove(id, true), AUTO_DISMISS_MS));
      return id;
    },
    [remove],
  );

  React.useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  const value = React.useMemo(() => ({ notify, dismiss, retract, banners }), [notify, dismiss, retract, banners]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

function linkLabel(to: string): string {
  if (/^\/recipes\/[^/?]+$/.test(to)) return "Open recipe";
  if (to.startsWith("/recipes?review")) return "Review";
  if (to === "/drop") return "Drop folder";
  return "Open";
}

/** Mirrors the user's undismissed Firestore notifications into the banner stack. */
export function NotificationFeed({ uid }: { uid: string }) {
  const { notify, retract } = useNotifications();
  const q = useLiveQuery<NotificationDoc>(
    query(collection(db, "users", uid, "notifications"), where("dismissedAt", "==", null)),
    `users/${uid}/notifications?open`,
  );
  const shown = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!q.docs) return;
    const live = new Set<string>();
    const sorted = [...q.docs].sort((a, b) => millis(a.data.createdAt) - millis(b.data.createdAt));
    for (const d of sorted) {
      const id = `fs:${d.id}`;
      live.add(id);
      if (shown.current.has(id)) continue;
      shown.current.add(id);
      const ref = doc(db, "users", uid, "notifications", d.id);
      notify({
        id,
        kind: d.data.kind,
        message: d.data.message,
        ...(d.data.link ? { link: { to: d.data.link, label: linkLabel(d.data.link) } } : {}),
        onDismiss: () => void updateDoc(ref, { dismissedAt: serverTimestamp() }).catch(() => {}),
      });
    }
    // Dismissed on another device: take it down here too.
    for (const id of shown.current) {
      if (!live.has(id)) {
        shown.current.delete(id);
        retract(id);
      }
    }
  }, [q.docs, notify, retract, uid]);
  return null;
}

function millis(v: unknown): number {
  const t = v as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : Date.now();
}

const KIND_STYLE: Record<NotificationKind, string> = {
  info: "bg-ink text-base shadow-toast",
  success: "bg-ink text-base shadow-toast",
  error: "bg-red text-onc shadow-hard",
};

/** Bottom-of-page stack; sits above the phone tab bar (`className` sets the offset). */
export function NotificationBanners({ className }: { className?: string }) {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) return null;
  // Always mounted (empty when there's nothing to show): an open sheet hides everything outside it from assistive tech
  // except live regions that already exist (aria-hidden's hideOthers), and banners must stay readable over sheets.
  // z-[60] puts them above sheet and dialog overlays (z-40/50) too.
  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4", className)}
      aria-live="polite"
      data-testid="notifications"
    >
      {ctx.banners.map((b) => (
        <div
          key={b.id}
          role={b.kind === "error" ? "alert" : "status"}
          data-kind={b.kind}
          className={cn(
            "pointer-events-auto flex w-full max-w-[min(92vw,40rem)] items-center gap-3 rounded-ui border-2 border-line px-3.5 py-2.5 text-[0.8125rem] leading-snug font-extrabold",
            KIND_STYLE[b.kind],
          )}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{b.message}</span>
          {b.link ? (
            <Link
              to={b.link.to.split("?")[0]}
              search={Object.fromEntries(new URLSearchParams(b.link.to.split("?")[1] ?? "")) as never}
              className="flex-none text-inherit underline"
              onClick={() => ctx.dismiss(b.id)}
            >
              {b.link.label}
            </Link>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => ctx.dismiss(b.id)}
            className="grid size-8 flex-none cursor-pointer place-items-center bg-transparent text-inherit"
          >
            <X aria-hidden className="size-4" strokeWidth={3} />
          </button>
        </div>
      ))}
    </div>
  );
}
