import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink } from "firebase/auth";
import { normalizeEmail } from "@solving-food/core";
import { auth } from "@/firebase/app";
import { AuthLayout, FieldError } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireStatus } from "@/session/guards";
import {
  authErrorMessage,
  clearStoredSignInEmail,
  looksLikeEmail,
  signInFinishUrl,
  storeSignInEmail,
  takeStoredSignInEmail,
} from "@/session/emailLink";

export const Route = createFileRoute("/sign-in/")({
  beforeLoad: ({ context }) => requireStatus(context.session, ["signedOut"]),
  component: SignInPage,
});

// R2.1 passwordless email link, plus the "Paste sign-in link" fallback for the iOS home-screen app, whose storage
// is separate from Safari's (TECHNICAL_SPECS §10).
function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState(() => takeStoredSignInEmail() ?? "");
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [link, setLink] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [linkBusy, setLinkBusy] = React.useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!looksLikeEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    const addr = normalizeEmail(email);
    setBusy(true);
    try {
      await sendSignInLinkToEmail(auth, addr, { url: signInFinishUrl(), handleCodeInApp: true });
      storeSignInEmail(addr);
      setSentTo(addr);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function usePastedLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkError(null);
    const pasted = link.trim();
    if (!isSignInWithEmailLink(auth, pasted)) {
      setLinkError("That isn't a Solving Food sign-in link. Copy the whole link from the email.");
      return;
    }
    if (!looksLikeEmail(email)) {
      setLinkError("Enter the email address the link was sent to, above.");
      return;
    }
    setLinkBusy(true);
    try {
      await signInWithEmailLink(auth, normalizeEmail(email), pasted);
      clearStoredSignInEmail();
      await navigate({ to: "/", replace: true });
    } catch (err) {
      setLinkError(authErrorMessage(err));
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="kicker">Invite only · no password</span>
          <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">Sign in</h1>
        </div>
        {sentTo ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="m-0 text-[0.9375rem] leading-snug font-semibold">
              Check your email. We sent a sign-in link to <strong className="font-extrabold">{sentTo}</strong>. Open it
              on this device.
            </p>
            <p className="m-0 text-[0.8125rem] leading-snug font-semibold text-sub">
              Not there? Check spam and mark it &ldquo;not spam&rdquo; so the next one arrives.
            </p>
            <Button variant="ghost" className="self-start px-0" onClick={() => setSentTo(null)}>
              Use a different address
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={send} noValidate>
            <p className="m-0 text-[0.9375rem] leading-snug font-semibold">
              We&apos;ll email you a link. Tap it and you&apos;re in.
            </p>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "email-error" : undefined}
            />
            <FieldError id="email-error">{error}</FieldError>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Sending…" : "Send sign-in link"}
            </Button>
          </form>
        )}
      </Card>

      <Card className="gap-3 p-4">
        <h2 className="m-0 font-display text-[1.1875rem] font-normal">Paste sign-in link</h2>
        <p className="m-0 text-[0.8125rem] leading-snug font-semibold text-sub">
          Using the app from your home screen? The email opens in the browser instead. Long-press the link in the
          email, copy it, and paste it here. Use the same email address as above.
        </p>
        <form className="flex flex-col gap-3" onSubmit={usePastedLink} noValidate>
          <Label htmlFor="pasted-link">Sign-in link</Label>
          <Input
            id="pasted-link"
            type="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? "link-error" : undefined}
          />
          <FieldError id="link-error">{linkError}</FieldError>
          <Button type="submit" variant="secondary" disabled={linkBusy}>
            {linkBusy ? "Signing in…" : "Sign in with link"}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
