import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { requireStatus } from "@/session/guards";
import { isPublicPath } from "@/session/publicPaths";


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
