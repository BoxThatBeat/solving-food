import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { requireStatus } from "@/session/guards";

// Everything inside the shell needs: signed in, allowlisted, a profile, and a household.
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context }) => requireStatus(context.session, ["ready"]),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
