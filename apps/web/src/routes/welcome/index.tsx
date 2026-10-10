import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { buildProfile, displayNameSchema } from "@solving-food/core";
import { auth, db } from "@/firebase/app";
import { AuthLayout, FieldError } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireStatus } from "@/session/guards";
import { cachedTheme } from "@/theme/apply";

export const Route = createFileRoute("/welcome/")({
  beforeLoad: ({ context }) => requireStatus(context.session, ["needsProfile"]),
  component: WelcomePage,
});

// First run: the display name creates users/{uid} and directory/{uid} in one batch (TECHNICAL_SPECS §10).
function WelcomePage() {
  const { user } = Route.useRouteContext();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a name");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { user: userDoc, directory } = buildProfile({ email: user.email, displayName: parsed.data, theme: cachedTheme() });
      const batch = writeBatch(db);
      batch.set(doc(db, "users", user.uid), { ...userDoc, createdAt: serverTimestamp() });
      batch.set(doc(db, "directory", user.uid), directory);
      await batch.commit();
      // The session sees the new docs and the router moves on to household setup.
    } catch (err) {
      console.error(err);
      setError("Couldn't save your name. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="kicker">Welcome · step 1 of 2</span>
          <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">What should we call you?</h1>
        </div>
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            autoComplete="nickname"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "display-name-error" : "display-name-hint"}
          />
          <p id="display-name-hint" className="m-0 text-[0.8125rem] font-semibold text-sub">
            People in your households see this name, and others can find you by it to invite you.
          </p>
          <FieldError id="display-name-error">{error}</FieldError>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </Button>
        </form>
        <p className="m-0 font-mono text-[0.6875rem] font-semibold text-sub">
          SIGNED IN AS {user.email.toUpperCase()} ·{" "}
          <button type="button" className="cursor-pointer bg-transparent p-0 font-mono font-bold text-ink underline" onClick={() => void signOut(auth)}>
            SIGN OUT
          </button>
        </p>
      </Card>
    </AuthLayout>
  );
}
