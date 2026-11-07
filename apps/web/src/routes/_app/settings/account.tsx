// Settings → Account (PRD R11.18, R2.1, R2.4; M20): who is signed in, Sign out, and the invites addressed to me (also
// a banner at the top of every other page, Settings included, while any is open). Was a card on the Settings page.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/app";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { useMyInvites } from "@/data/households";
import { InviteList } from "@/components/households/Invites";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/settings/account")({
  component: AccountPage,
});

function AccountPage() {
  const s = useReadySession();
  const navigate = useNavigate();
  const invites = useMyInvites(s.user.uid, s.user.email, s.householdIds);
  return (
    <SettingsPage title="Account">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Account</CardTitle>
          <span className="tabular-nums text-[0.6875rem] leading-snug font-semibold text-sub">
            Signed in as {s.displayName} · {s.user.email}
          </span>
          <Button
            variant="secondary"
            className="self-start"
            onClick={async () => {
              await signOut(auth);
              await navigate({ to: "/sign-in" });
            }}
          >
            Sign out
          </Button>
        </Card>
        <Card>
          <CardTitle>Invites</CardTitle>
          {invites?.length ? (
            <InviteList invites={invites} me={{ uid: s.user.uid, email: s.user.email, displayName: s.displayName }} />
          ) : (
            <p className="m-0 text-[0.8125rem] font-semibold text-sub">{invites ? "No open invites." : "Loading…"}</p>
          )}
        </Card>
      </div>
    </SettingsPage>
  );
}
