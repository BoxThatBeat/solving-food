import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { collection, doc, increment, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { Minus, Plus } from "lucide-react";
import {
  CURRENCY,
  DEFAULT_BUDGET_CENTS,
  DEFAULT_PERIOD_DAYS,
  PLANNABLE_MEAL_TYPES,
  SERVINGS_MAX,
  buildNewHousehold,
  defaultHouseholdInput,
  DEFAULT_STORES,
  firstPeriod,
  newHouseholdInputSchema,
  type NewHouseholdInput,
  type PlannableMealType,
} from "@solving-food/core";
import { db } from "@/firebase/app";
import { AuthLayout, FieldError } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireStatus } from "@/session/guards";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/welcome/household")({
  beforeLoad: ({ context }) => requireStatus(context.session, ["needsHousehold"]),
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

// First household (Planning/M0 §5, M2 §1/§5): one batch writes households/{hid}, members/{uid}, the first period, the
// default stores, and bumps users/{uid}.householdsCreated; the rules check the counter (R2.3) and the creator's member doc.
function CreateHouseholdPage() {
  const { user, displayName } = Route.useRouteContext();
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
      const { household, member } = buildNewHousehold(parsed.data, { uid: user.uid, displayName });
      const hRef = doc(collection(db, "households"));
      const batch = writeBatch(db);
      // The first plan period starts today (Planning/M2 §1) and the default stores exist from the start (§5).
      const p = firstPeriod(Date.now(), household.periodDays, household.timezone);
      batch.set(hRef, { ...household, currentPeriodId: p.id, createdAt: serverTimestamp() });
      batch.set(doc(hRef, "members", user.uid), { ...member, joinedAt: serverTimestamp() });
      batch.update(doc(db, "users", user.uid), { householdsCreated: increment(1), activeHouseholdId: hRef.id });
      batch.set(doc(hRef, "periods", p.id), { start: Timestamp.fromMillis(p.startMs), end: Timestamp.fromMillis(p.endMs), budgetCents: household.budgetCents });
      for (const st of DEFAULT_STORES) batch.set(doc(hRef, "stores", st.id), { name: st.name, kind: st.kind, bulk: st.bulk });
      await batch.commit();
      // The membership listener flips the session to ready; the router lands on Recipes.
    } catch (err) {
      console.error(err);
      setError("Couldn't create the household. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="kicker">Welcome, {displayName} · step 2 of 2</span>
          <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">Create your household</h1>
        </div>
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
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Creating…" : "Create household"}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
