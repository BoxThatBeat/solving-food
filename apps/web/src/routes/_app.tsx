import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { requireStatus } from "@/session/guards";

/** Recipe and saved-meal pages also render for signed-out visitors (share links, R4.21); everything else needs a ready session. */
export function isPublicPath(pathname: string): boolean {
  return /^\/recipes\/(?!new$|trash$)[^/]+\/?$/.test(pathname) || /^\/meals\/[^/]+\/?$/.test(pathname);
}

// Everything inside the shell needs: signed in, allowlisted, a profile, and a household (except public recipe pages).
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    if (isPublicPath(location.pathname)) {
      await context.session.settled();
      return;
    }
    await requireStatus(context.session, ["ready"]);
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
