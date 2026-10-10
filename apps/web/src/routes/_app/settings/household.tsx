// Settings → Household (PRD R11.5, R11.6, R11.11, R11.12, R11.13; spec §12): name, plan period length, budget,
// timezone, default servings, planned meal types. Zod-validated; writes households/{hid}. A new period length applies
// from the next period; a budget change also updates the current period's budget.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatCents, householdSettingsInputSchema, PERIOD_DAYS_MAX, PLANNABLE_MEAL_TYPES, SERVINGS_MAX, type HouseholdDoc, type HouseholdSettingsInput, type PlannableMealType } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { useActiveHousehold } from "@/data/households";
import { saveHouseholdSettings } from "@/data/plan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/household")({
  component: HouseholdSettings,
});

const MEAL_LABELS: Record<PlannableMealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function zones(selected: string): string[] {
  let z: string[] = [];
  try {
    z = Intl.supportedValuesOf("timeZone");
  } catch {
    z = [];
  }
  return z.includes(selected) ? z : [selected, ...z];
}

function fromDoc(h: HouseholdDoc): HouseholdSettingsInput {
  return { name: h.name, timezone: h.timezone, defaultServings: h.defaultServings, plannedMealTypes: h.plannedMealTypes, periodDays: h.periodDays, budgetCents: h.budgetCents };
}

function HouseholdSettings() {
  const hh = useActiveHousehold();
  return (
    <SettingsPage title="Household" kicker={`Settings · ${hh.data?.name ?? ""}`}>
      {hh.data ? <HouseholdForm key={hh.id} hid={hh.id} household={hh.data} /> : <p className="m-0 font-bold">Loading…</p>}
    </SettingsPage>
  );
}

function HouseholdForm({ hid, household }: { hid: string; household: HouseholdDoc }) {
  const notify = useNotify();
  const [form, setForm] = React.useState<HouseholdSettingsInput>(() => fromDoc(household));
  const [budgetText, setBudgetText] = React.useState(String(household.budgetCents / 100));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tz = React.useMemo(() => zones(form.timezone), [form.timezone]);
  const dirty = JSON.stringify(form) !== JSON.stringify(fromDoc(household));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = householdSettingsInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const v = parsed.data;
      await saveHouseholdSettings(
        hid,
        { ...v, plannedMealTypes: PLANNABLE_MEAL_TYPES.filter((t) => v.plannedMealTypes.includes(t)) },
        v.budgetCents !== household.budgetCents ? household.currentPeriodId : null,
      );
      notify({ kind: "success", message: "Household settings saved" });
    } catch (err) {
      setError(`Couldn't save: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
      <Card className="gap-4">
        <CardTitle>Household</CardTitle>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hs-name">Name</Label>
          <Input id="hs-name" maxLength={60} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hs-tz">Timezone</Label>
          <Select id="hs-tz" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
            {tz.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
          <span className="text-[0.75rem] font-semibold text-sub">Period boundaries and expiry days are worked out in this timezone.</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span id="hs-servings" className="text-[0.9375rem] font-extrabold">
              Default servings
            </span>
            <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">Recipes are planned for this many</span>
          </span>
          <Stepper label="Default servings" labelledBy="hs-servings" value={form.defaultServings} min={1} max={SERVINGS_MAX} onChange={(v) => setForm((f) => ({ ...f, defaultServings: v }))} />
        </div>
      </Card>

      <Card className="gap-4">
        <CardTitle>Plan &amp; budget</CardTitle>
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span id="hs-period" className="text-[0.9375rem] font-extrabold">
              Plan period
            </span>
            <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">Meals roll over when it ends · applies from the next period</span>
          </span>
          <Stepper label="Plan period" labelledBy="hs-period" value={form.periodDays} min={1} max={PERIOD_DAYS_MAX} format={(v) => `${v} day${v === 1 ? "" : "s"}`} onChange={(v) => setForm((f) => ({ ...f, periodDays: v }))} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <label htmlFor="hs-budget" className="text-[0.9375rem] font-extrabold">
              Budget per period
            </label>
            <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">Planned meals only · CAD · {formatCents(form.budgetCents)}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-extrabold">$</span>
            <Input
              id="hs-budget"
              inputMode="decimal"
              value={budgetText}
              onChange={(e) => {
                setBudgetText(e.target.value);
                const n = Number(e.target.value.replace(/[$,\s]/g, ""));
                setForm((f) => ({ ...f, budgetCents: Number.isFinite(n) ? Math.round(n * 100) : -1 }));
              }}
              className="w-[7rem] text-right font-mono"
            />
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
                  onClick={() => setForm((f) => ({ ...f, plannedMealTypes: on ? f.plannedMealTypes.filter((x) => x !== t) : [...f.plannedMealTypes, t] }))}
                  className={cn("cursor-pointer rounded-ui border-2 border-line px-2 py-3 text-sm font-extrabold", on ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm")}
                >
                  {MEAL_LABELS[t]}
                </button>
              );
            })}
          </div>
          <span className="text-[0.75rem] font-semibold text-sub">Each one gets a row in the coverage strip. Snacks are always available.</span>
        </fieldset>
      </Card>

      <div className="flex flex-col gap-2 md:col-span-2">
        {error ? (
          <p role="alert" className="m-0 rounded-ui border-2 border-line bg-red px-3 py-2 text-sm font-extrabold text-onc">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy || !dirty} className="self-start">
          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
        </Button>
      </div>
    </form>
  );
}
