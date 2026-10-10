// Household invites addressed to me (PRD R2.4, TECHNICAL_SPECS §10 "See invites" / "Accept"): a banner on every page
// of the shell, a card in Settings, and a list on the first-run household page (a newcomer invited by email sees the
// invite as soon as they've picked a display name).
import * as React from "react";
import { Mail } from "lucide-react";
import { acceptInvite, declineInvite, HouseholdActionError, useMyInvites, type MyInvite } from "@/data/households";
import { useNotify } from "@/components/notifications-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Me {
  uid: string;
  email: string;
  displayName: string;
}

function InviteRow({ invite, me, onJoined }: { invite: MyInvite; me: Me; onJoined?: (hid: string) => void }) {
  const notify = useNotify();
  const [busy, setBusy] = React.useState<"join" | "decline" | null>(null);
  const who = invite.invitedByName ?? "Someone";
  const run = async (kind: "join" | "decline") => {
    setBusy(kind);
    try {
      if (kind === "join") {
        await acceptInvite(invite, me);
        notify({ kind: "success", message: `You joined ${invite.householdName}.` });
        onJoined?.(invite.hid);
      } else {
        await declineInvite(invite, me);
        notify({ kind: "info", message: `Declined the invite to ${invite.householdName}.` });
      }
    } catch (e) {
      notify({ kind: "error", message: e instanceof HouseholdActionError ? e.message : `Couldn't ${kind === "join" ? "join" : "decline"}: ${(e as Error).message}` });
      setBusy(null);
    }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[0.9375rem] font-extrabold">{invite.householdName}</span>
        <span className="font-mono text-[0.65625rem] font-semibold uppercase">{who} invited you</span>
      </span>
      <span className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void run("decline")} aria-label={`Decline the invite to ${invite.householdName}`}>
          Decline
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => void run("join")} aria-label={`Join ${invite.householdName}`}>
          {busy === "join" ? "Joining…" : "Join"}
        </Button>
      </span>
    </li>
  );
}

export function InviteList({ invites, me, onJoined, className }: { invites: MyInvite[]; me: Me; onJoined?: (hid: string) => void; className?: string }) {
  return (
    <ul aria-label="Household invites" className={cn("m-0 flex list-none flex-col gap-3 p-0", className)}>
      {invites.map((i) => (
        <InviteRow key={`${i.hid}/${i.key}`} invite={i} me={me} onJoined={onJoined} />
      ))}
    </ul>
  );
}

/** The banner at the top of every page while someone has open invites. */
export function InviteBanner({ me, householdIds }: { me: Me; householdIds: string[] }) {
  const invites = useMyInvites(me.uid, me.email, householdIds);
  if (!invites?.length) return null;
  return (
    <section
      aria-label="Invites"
      className="mx-4 mt-2 flex flex-col gap-2.5 rounded-ui border-bw bg-yellow p-3 text-ink shadow-hard md:mx-7 md:mt-4"
    >
      <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] font-bold tracking-[0.06rem] uppercase">
        <Mail aria-hidden className="size-3.5" strokeWidth={3} />
        {invites.length === 1 ? "You're invited to a household" : `You're invited to ${invites.length} households`}
      </span>
      <InviteList invites={invites} me={me} />
    </section>
  );
}
