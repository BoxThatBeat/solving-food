import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/app";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { useActiveHousehold, useMyInvites } from "@/data/households";
import { InviteList } from "@/components/households/Invites";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

const SECTIONS = [
  { to: "/settings/household", label: "Household", sub: "Period, budget, timezone, servings, meal types" },
  { to: "/settings/members", label: "Members", sub: "Invite by email or name, remove, leave" },
  { to: "/settings/brands", label: "Brands", sub: "Preferred products per ingredient" },
  { to: "/settings/stores", label: "Stores", sub: "PC Express store, Costco, sourcing rules" },
  { to: "/settings/sides", label: "Sides", sub: "Fries, rice, buns, chips… portion per person" },
  { to: "/settings/tools", label: "Kitchen tools", sub: "Equipment the household owns" },
  { to: "/settings/preferences", label: "Preferences", sub: "Likes, dislikes, dietary restrictions, protein goals" },
  { to: "/settings/weights", label: "Suggestion weights", sub: "What raises or lowers a suggestion" },
  { to: "/settings/theme", label: "Theme", sub: "Flavour and accent · just you" },
  { to: "/settings/data", label: "Data", sub: "Download or import household data" },
] as const;

function SettingsPage() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const navigate = useNavigate();
  const name = hh.data?.name ?? "";
  const invites = useMyInvites(s.user.uid, s.user.email, s.householdIds);
  return (
    <PageBody>
      <PageHeader title="Settings" kicker={`Household · ${name} · theme is per user`} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[repeat(auto-fill,minmax(23.75rem,1fr))]">
        <nav aria-label="Settings sections" className="flex flex-col gap-2.5">
          {SECTIONS.map((sec) => (
            <Link
              key={sec.to}
              to={sec.to}
              className="flex items-center justify-between gap-3 rounded-ui border-bw bg-base px-3.5 py-3 text-ink no-underline shadow-hard"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[1rem] font-extrabold">{sec.label}</span>
                <span className="text-xs font-semibold text-sub">{sec.sub}</span>
              </span>
              <span aria-hidden className="text-lg font-extrabold">
                →
              </span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>Invites</CardTitle>
          {invites?.length ? (
            <InviteList invites={invites} me={{ uid: s.user.uid, email: s.user.email, displayName: s.displayName }} />
          ) : (
            <p className="m-0 text-[0.8125rem] font-semibold text-sub">{invites ? "No open invites." : "Loading…"}</p>
          )}
        </Card>
        <Card>
          <CardTitle>Account</CardTitle>
          <span className="font-mono text-[0.6875rem] leading-snug font-semibold text-sub uppercase">
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
        </div>
      </div>
    </PageBody>
  );
}
