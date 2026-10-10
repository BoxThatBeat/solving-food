import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/app";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/not-invited")({
  validateSearch: (search: Record<string, unknown>): { email?: string } =>
    typeof search.email === "string" ? { email: search.email } : {},
  component: NotInvitedPage,
});

// R2.12: someone whose address isn't on the allowlist is told so, signed out, and nothing is created for them.
function NotInvitedPage() {
  const { email } = Route.useSearch();
  React.useEffect(() => {
    void signOut(auth);
  }, []);
  return (
    <AuthLayout>
      <Card className="gap-4 p-4">
        <span className="kicker">Invite only</span>
        <h1 className="m-0 font-display text-[2rem] leading-[0.95] font-normal">This address hasn&apos;t been invited</h1>
        <p className="m-0 text-[0.9375rem] leading-snug font-semibold">
          {email ? (
            <>
              <strong className="font-extrabold break-all">{email}</strong> isn&apos;t on the Solving Food invite list.
            </>
          ) : (
            "That address isn't on the Solving Food invite list."
          )}{" "}
          Ask someone in your household to invite you, then sign in again.
        </p>
        <p className="m-0 text-[0.8125rem] font-semibold text-sub">You&apos;ve been signed out. Nothing was saved.</p>
        <Button asChild className="self-start">
          <Link to="/sign-in">Back to sign in</Link>
        </Button>
      </Card>
    </AuthLayout>
  );
}
