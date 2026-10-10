import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { normalizeEmail } from "@solving-food/core";
import { auth } from "@/firebase/app";
import { AuthLayout, FieldError } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authErrorMessage, clearStoredSignInEmail, looksLikeEmail, takeStoredSignInEmail } from "@/session/emailLink";

export const Route = createFileRoute("/sign-in/finish")({
  component: FinishPage,
});

type Phase = { kind: "working" } | { kind: "askEmail" } | { kind: "error"; message: string } | { kind: "notALink" };

function FinishPage() {
  const navigate = useNavigate();
  const [href] = React.useState(() => window.location.href);
  const isLink = React.useMemo(() => isSignInWithEmailLink(auth, href), [href]);
  const stored = React.useMemo(() => takeStoredSignInEmail(), []);
  const [phase, setPhase] = React.useState<Phase>(() =>
    !isLink ? { kind: "notALink" } : stored ? { kind: "working" } : { kind: "askEmail" },
  );
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const attempted = React.useRef(false);

  const complete = React.useCallback(
    async (addr: string) => {
      setPhase({ kind: "working" });
      try {
        await signInWithEmailLink(auth, normalizeEmail(addr), href);
        clearStoredSignInEmail();
        await navigate({ to: "/", replace: true });
      } catch (err) {
        setPhase({ kind: "error", message: authErrorMessage(err) });
      }
    },
    [href, navigate],
  );

  React.useEffect(() => {
    // Once only (StrictMode runs effects twice; a sign-in code works once).
    if (attempted.current || !isLink || !stored) return;
    attempted.current = true;
    void complete(stored);
  }, [complete, isLink, stored]);

  return (
    <AuthLayout>
      <Card className="gap-4 p-4">
        <h1 className="m-0 font-display text-[2rem] leading-[0.95] font-normal">
          {phase.kind === "askEmail" ? "Confirm your email" : phase.kind === "working" ? "Signing you in…" : "Sign-in link problem"}
        </h1>
        {phase.kind === "askEmail" ? (
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!looksLikeEmail(email)) {
                setEmailError("Enter the email address the link was sent to.");
                return;
              }
              void complete(email);
            }}
          >
            <p className="m-0 text-[0.9375rem] leading-snug font-semibold">
              This link was opened on a different device or browser. Which address did you request it for?
            </p>
            <Label htmlFor="confirm-email">Email</Label>
            <Input
              id="confirm-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "confirm-email-error" : undefined}
            />
            <FieldError id="confirm-email-error">{emailError}</FieldError>
            <Button type="submit" size="lg">
              Sign in
            </Button>
          </form>
        ) : null}
        {phase.kind === "working" ? (
          <p className="m-0 font-mono text-xs font-bold" role="status">
            CHECKING YOUR LINK…
          </p>
        ) : null}
        {phase.kind === "error" || phase.kind === "notALink" ? (
          <>
            <p className="m-0 text-[0.9375rem] leading-snug font-semibold" role="alert">
              {phase.kind === "error" ? phase.message : "This page needs a sign-in link from your email."}
            </p>
            <Button asChild variant="primary" className="self-start">
              <Link to="/sign-in">Back to sign in</Link>
            </Button>
          </>
        ) : null}
      </Card>
    </AuthLayout>
  );
}
