// Settings → Members (PRD R11.8, R2.4, R2.5, R2.13; prototype Settings "Household" card): who's in the household, invite
// by name (directory) or by email (allowlist + invite), pending invites, remove anyone (no roles), and leave with the
// last-member warning.
import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Search } from "lucide-react";
import { inviteEmailSchema, MAX_HOUSEHOLDS_CREATED, searchDirectory } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/dialog";
import { LeaveHouseholdDialog } from "@/components/households/LeaveHouseholdDialog";
import { useNotify } from "@/components/notifications-context";
import {
  cancelInvite,
  HouseholdActionError,
  inviteByEmail,
  inviteByUid,
  leaveHousehold,
  removeMember,
  useActiveHousehold,
  useDirectory,
  useHouseholdInvites,
  useMembers,
  useMyHouseholds,
  type MemberRow,
} from "@/data/households";
import { markSelfLeft } from "@/components/households/removal";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/members")({
  component: MembersPage,
});

const AVATAR = ["bg-acc", "bg-blue-soft", "bg-peach-soft", "bg-yellow"];

function joined(ms: number | null): string {
  if (!ms) return "Joining…";
  return `Joined ${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(ms)}`;
}

function MembersPage() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const { householdIds } = useMyHouseholds();
  const { members } = useMembers(hh.id);
  const invites = useHouseholdInvites(hh.id);
  const directory = useDirectory(true);
  const notify = useNotify();
  const navigate = useNavigate();
  const name = hh.data?.name ?? "";
  const ctx = { householdName: name, uid: s.user.uid, displayName: s.displayName };
  const creator = members?.find((m) => m.uid === hh.data?.createdBy)?.displayName ?? directory?.find((d) => d.uid === hh.data?.createdBy)?.displayName;

  const [removing, setRemoving] = React.useState<MemberRow | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const memberIds = new Set((members ?? []).map((m) => m.uid));
  const invitedUids = new Set((invites ?? []).flatMap((i) => (i.inviteeUid ? [i.inviteeUid] : [])));
  const nameOf = (uid: string) => directory?.find((d) => d.uid === uid)?.displayName ?? "Someone";

  const doRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await removeMember(hh.id, removing.uid);
      notify({ kind: "success", message: `${removing.displayName} was removed from ${name}.` });
      setRemoving(null);
    } catch (e) {
      notify({ kind: "error", message: `Couldn't remove ${removing.displayName}: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const doLeave = async () => {
    setBusy(true);
    const last = (members?.length ?? 1) <= 1;
    try {
      markSelfLeft(hh.id);
      await leaveHousehold(hh.id, s.user, householdIds);
      notify({ kind: "success", message: last ? `You left ${name}. It's being deleted.` : `You left ${name}.` });
      setLeaving(false);
      await navigate({ to: "/" });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't leave: ${(e as Error).message}` });
      setBusy(false);
    }
  };

  return (
    <SettingsPage title="Members">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="gap-3">
          <CardTitle>{name || "Household"}</CardTitle>
          <span className="font-mono text-[0.6875rem] leading-snug font-semibold text-sub uppercase">
            {name}
            {creator ? ` · created by ${creator}` : ""} · you&apos;ve created {s.profile.householdsCreated} of {MAX_HOUSEHOLDS_CREATED} · no roles, everyone
            can do everything
          </span>
          <ul aria-label="Members" className="m-0 flex list-none flex-col gap-2 p-0">
            {(members ?? []).map((m, i) => {
              const me = m.uid === s.user.uid;
              return (
                <li key={m.uid} className="flex items-center gap-2.5 rounded-ui border-2 border-line bg-pg px-2.5 py-2">
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-7 flex-none place-items-center rounded-full border-2 border-line text-[0.8125rem] font-extrabold text-ink",
                      AVATAR[i % AVATAR.length],
                    )}
                  >
                    {m.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[0.875rem] font-extrabold">
                      {m.displayName}
                      {me ? " (you)" : ""}
                    </span>
                    <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">{joined(m.joinedAtMs)}</span>
                  </span>
                  {me ? null : (
                    <Button variant="secondary" size="sm" className="border-2 px-2 py-1.5 text-[0.6875rem] shadow-none" onClick={() => setRemoving(m)} aria-label={`Remove ${m.displayName}`}>
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="sm" className="self-start px-0" onClick={() => setLeaving(true)}>
            Leave this household
          </Button>
        </Card>

        <div className="flex flex-col gap-4">
          <InviteByName
            ready={!!hh.data}
            directory={directory}
            exclude={new Set([...memberIds, ...invitedUids])}
            invited={invitedUids}
            onInvite={async (uid, display) => {
              try {
                await inviteByUid(hh.id, uid, ctx);
                notify({ kind: "success", message: `Invite sent to ${display}.` });
              } catch (e) {
                notify({ kind: "error", message: `Couldn't invite ${display}: ${(e as Error).message}` });
              }
            }}
          />
          <InviteByEmail
            ready={!!hh.data}
            onInvite={async (email) => {
              await inviteByEmail(hh.id, email, ctx);
              notify({ kind: "success", message: `Invited ${email}. They can sign in with that address now and will see the invite.` });
            }}
          />
          <Card className="gap-2.5">
            <CardTitle>Pending invites</CardTitle>
            {invites && invites.length === 0 ? <p className="m-0 text-[0.8125rem] font-semibold text-sub">Nobody is waiting to join.</p> : null}
            <ul aria-label="Pending invites" className="m-0 flex list-none flex-col gap-2 p-0">
              {(invites ?? []).map((i) => {
                const label = i.inviteeUid ? nameOf(i.inviteeUid) : (i.inviteeEmailLower ?? i.key);
                return (
                  <li key={i.key} className="flex items-center gap-2.5">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[0.875rem] font-extrabold">{label}</span>
                      <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                        {i.inviteeUid ? "invited by name" : "invited by email · waiting for sign-up"}
                        {i.invitedByName ? ` · from ${i.invitedByName}` : ""}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shadow-none"
                      aria-label={`Cancel the invite for ${label}`}
                      onClick={() =>
                        void cancelInvite(hh.id, i.key).catch((e) => notify({ kind: "error", message: `Couldn't cancel: ${(e as Error).message}` }))
                      }
                    >
                      Cancel
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.displayName ?? ""}?`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={() => void doRemove()}
      >
        They lose access to {name}&apos;s plan, supply, and history right away. You can invite them back later.
      </ConfirmDialog>
      <LeaveHouseholdDialog
        open={leaving}
        onOpenChange={setLeaving}
        householdName={name}
        memberCount={members?.length ?? 1}
        busy={busy}
        onConfirm={() => void doLeave()}
      />
    </SettingsPage>
  );
}

function InviteByName({
  ready,
  directory,
  exclude,
  invited,
  onInvite,
}: {
  ready: boolean;
  directory: Array<{ uid: string; displayName: string }> | undefined;
  exclude: Set<string>;
  invited: Set<string>;
  onInvite: (uid: string, displayName: string) => Promise<void>;
}) {
  const [q, setQ] = React.useState("");
  const [sent, setSent] = React.useState<Set<string>>(new Set());
  const excludeMembers = new Set([...exclude].filter((u) => !invited.has(u) && !sent.has(u)));
  const matches = searchDirectory(directory ?? [], q, excludeMembers, 6);
  return (
    <Card className="gap-2.5">
      <CardTitle>Invite by name</CardTitle>
      <p className="m-0 text-[0.8125rem] font-semibold">For people who already use Solving Food.</p>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" strokeWidth={2.5} />
        <Input
          aria-label="Search people by name"
          placeholder="Invite: search people by name…"
          className="bg-pg pl-9 shadow-none"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {q.trim() && matches.length === 0 ? <p className="m-0 text-[0.8125rem] font-semibold text-sub">Nobody by that name. Invite them by email instead.</p> : null}
      <ul aria-label="People" className="m-0 flex list-none flex-col gap-2 p-0">
        {matches.map((m) => {
          const done = invited.has(m.uid) || sent.has(m.uid);
          return (
            <li key={m.uid} className="flex items-center gap-2 text-[0.8125rem] font-bold">
              <span className="flex-1">{m.displayName}</span>
              <Button
                size="sm"
                variant={done ? "chip" : "primary"}
                className={cn("shadow-none", done && "bg-s0")}
                disabled={done || !ready}
                aria-label={done ? `${m.displayName} invited` : `Invite ${m.displayName}`}
                onClick={async () => {
                  setSent((s) => new Set(s).add(m.uid));
                  await onInvite(m.uid, m.displayName);
                }}
              >
                {done ? (
                  <>
                    Invited <Check aria-hidden strokeWidth={3} />
                  </>
                ) : (
                  "Invite"
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function InviteByEmail({ ready, onInvite }: { ready: boolean; onInvite: (email: string) => Promise<void> }) {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = inviteEmailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the address");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onInvite(parsed.data);
      setEmail("");
    } catch (err) {
      setError(err instanceof HouseholdActionError ? err.message : `Couldn't send the invite: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="gap-2.5">
      <CardTitle>Invite by email</CardTitle>
      <p className="m-0 text-[0.8125rem] font-semibold">
        For someone new: their address is added to the sign-up list, and they see the invite when they first sign in.
      </p>
      <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)} noValidate>
        <Label htmlFor="invite-email">Email address</Label>
        <div className="flex gap-2">
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            inputMode="email"
            className="bg-pg shadow-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "invite-email-error" : undefined}
          />
          <Button type="submit" disabled={busy || !ready}>
            {busy ? "Sending…" : "Invite"}
          </Button>
        </div>
        {error ? (
          <p id="invite-email-error" role="alert" className="m-0 text-[0.8125rem] font-bold">
            {error}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
