import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { Minus, Plus } from "lucide-react";
import {
  CURRENCY,
  DEFAULT_BUDGET_CENTS,
  DEFAULT_PERIOD_DAYS,
  MAX_HOUSEHOLDS_CREATED,
  PLANNABLE_MEAL_TYPES,
  SERVINGS_MAX,
  canCreateHousehold,
  defaultHouseholdInput,
  newHouseholdInputSchema,
  type NewHouseholdInput,
  type PlannableMealType,
} from "@solving-food/core";
import { auth } from "@/firebase/app";
import { createHousehold, HouseholdActionError, useMyInvites } from "@/data/households";
import { InviteList } from "@/components/households/Invites";
import { AuthLayout, FieldError } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireStatus } from "@/session/guards";
import { cn } from "@/lib/utils";

// First run (no household yet: join by invite or create one) and, from the household sheet, another household (R2.2).
export const Route = createFileRoute("/welcome/household")({
  beforeLoad: ({ context }) => requireStatus(context.session, ["needsHousehold", "ready"]),
  component: CreateHouseholdPage,
});

const MEAL_LABELS: Record<PlannableMealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function timezoneOptions(selected: string): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return zones.includes(selected) ? zones : [selected, ...zones];
}

// One batch writes households/{hid}, members/{uid}, the first period, the default stores, and bumps
// users/{uid}.householdsCreated; the rules check the counter (R2.3) and the creator's member doc (data/households.ts).
function CreateHouseholdPage() {
  const ctx = Route.useRouteContext();
  const { user, displayName, profile } = ctx;
  const ready = ctx.status === "ready";
  const memberOf = React.useMemo(() => (ctx.status === "ready" ? ctx.householdIds : []), [ctx]);
  const invites = useMyInvites(user.uid, user.email, memberOf);
  const navigate = useNavigate();
  const atLimit = !canCreateHousehold(profile.householdsCreated);
  const [form, setForm] = React.useState<NewHouseholdInput>(() => defaultHouseholdInput(detectTimezone()));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const zones = React.useMemo(() => timezoneOptions(form.timezone), [form.timezone]);

  const toggleMeal = (t: PlannableMealType) =>
    setForm((f) => ({
      ...f,
      plannedMealTypes: f.plannedMealTypes.includes(t) ? f.plannedMealTypes.filter((x) => x !== t) : [...f.plannedMealTypes, t],
    }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = newHouseholdInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createHousehold(parsed.data, { uid: user.uid, displayName });
      // First run: the membership listener flips the session to ready and the router lands on Recipes. Another
      // household: it's now the active one; start from its (empty) landing page.
      if (ready) await navigate({ to: "/" });
    } catch (err) {
      console.error(err);
      setError(err instanceof HouseholdActionError ? err.message : "Couldn't create the household. Check your connection and try again.");
      setBusy(false);
    }
  }

  const hasInvites = !!invites?.length;
  return (
    <AuthLayout>
      {hasInvites ? (
        <Card className="gap-4 p-4">
          <div className="flex flex-col gap-1">
            <span className="kicker">{ready ? "Invites" : `Welcome, ${displayName}`}</span>
            <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">{ready ? "You're invited" : "Join a household"}</h1>
          </div>
          <InviteList invites={invites!} me={{ uid: user.uid, email: user.email, displayName }} onJoined={() => (ready ? void navigate({ to: "/" }) : undefined)} />
        </Card>
      ) : null}
      <Card className="gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="kicker">
            {ready
              ? `New household · ${profile.householdsCreated} of ${MAX_HOUSEHOLDS_CREATED} created`
              : hasInvites
                ? "Or start your own"
                : `Welcome, ${displayName} · step 2 of 2`}
          </span>
          {ready || hasInvites ? (
            <h2 className="m-0 font-display text-[1.75rem] leading-[0.95] font-normal">{ready ? "Create a household" : "Create your household"}</h2>
          ) : (
            <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">Create your household</h1>
          )}
        </div>
        {atLimit ? (
          <p role="note" className="m-0 rounded-ui border-2 border-line bg-peach-soft p-3 text-[0.8125rem] font-semibold">
            You&apos;ve created {profile.householdsCreated} of {MAX_HOUSEHOLDS_CREATED} households, the most anyone can. One you
            created stops counting when it&apos;s deleted (its last member leaves).
          </p>
        ) : null}
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hh-name">Household name</Label>
            <Input id="hh-name" maxLength={60} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hh-tz">Timezone</Label>
            <Select id="hh-tz" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label id="servings-label">Default servings</Label>
            <div className="flex items-center gap-3">
              <div role="group" aria-labelledby="servings-label" className="flex overflow-hidden rounded-ui border-2 border-line bg-base">
                <button
                  type="button"
                  aria-label="Fewer servings"
                  disabled={form.defaultServings <= 1}
                  onClick={() => setForm((f) => ({ ...f, defaultServings: Math.max(1, f.defaultServings - 1) }))}
                  className="grid size-11 cursor-pointer place-items-center bg-pg text-ink disabled:opacity-40"
                >
                  <Minus aria-hidden className="size-4" strokeWidth={3} />
                </button>
                <output
                  aria-live="polite"
                  className="grid min-w-14 place-items-center border-x-2 border-line font-mono text-[1rem] font-extrabold"
                >
                  {form.defaultServings}
                </output>
                <button
                  type="button"
                  aria-label="More servings"
                  disabled={form.defaultServings >= SERVINGS_MAX}
                  onClick={() => setForm((f) => ({ ...f, defaultServings: Math.min(SERVINGS_MAX, f.defaultServings + 1) }))}
                  className="grid size-11 cursor-pointer place-items-center bg-pg text-ink disabled:opacity-40"
                >
                  <Plus aria-hidden className="size-4" strokeWidth={3} />
                </button>
              </div>
              <span className="text-[0.8125rem] font-semibold text-sub">Recipes are planned for this many.</span>
            </div>
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">Planned meal types</legend>
            <div className="grid grid-cols-3 gap-2">
              {PLANNABLE_MEAL_TYPES.map((t) => {
                const on = form.plannedMealTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleMeal(t)}
                    className={cn(
                      "cursor-pointer rounded-ui border-2 border-line px-2 py-3 text-sm font-extrabold",
                      on ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm",
                    )}
                  >
                    {MEAL_LABELS[t]}
                  </button>
                );
              })}
            </div>
            <span className="text-[0.8125rem] font-semibold text-sub">Snacks are always available.</span>
          </fieldset>
          <p className="m-0 font-mono text-[0.6875rem] leading-relaxed font-semibold text-sub">
            {CURRENCY} · {DEFAULT_PERIOD_DAYS}-DAY PLAN PERIOD · ${DEFAULT_BUDGET_CENTS / 100} BUDGET · CHANGE THESE LATER IN
            SETTINGS
          </p>
          <FieldError id="hh-error">{error}</FieldError>
          <Button type="submit" size="lg" disabled={busy || atLimit}>
            {busy ? "Creating…" : "Create household"}
          </Button>
        </form>
        {ready ? (
          <Link to="/" className="self-center text-sm font-extrabold text-ink">
            Cancel
          </Link>
        ) : (
          <p className="m-0 font-mono text-[0.6875rem] font-semibold text-sub">
            SIGNED IN AS {user.email.toUpperCase()} ·{" "}
            <button type="button" className="cursor-pointer bg-transparent p-0 font-mono font-bold text-ink underline" onClick={() => void signOut(auth)}>
              SIGN OUT
            </button>
          </p>
        )}
      </Card>
    </AuthLayout>
  );
}
