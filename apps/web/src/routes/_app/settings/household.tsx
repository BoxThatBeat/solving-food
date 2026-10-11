// Settings → Household (PRD R11.5, R11.6, R11.11, R11.12, R11.13, R3.1; spec §12): name, plan period length, budget,
// timezone, default servings, planned meal types. Zod-validated; writes households/{hid}. A new period length applies
// from the next period; a budget change also updates the current period's budget. "Restart period" (R3.1, M7) ends the
// current period now and starts a new one today or tomorrow (`restartPeriod`, the rollover's carry code).
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatCents, formatPeriodRange, householdSettingsInputSchema, planRestart, restartBounds, type RestartDay, PERIOD_DAYS_MAX, PLANNABLE_MEAL_TYPES, SERVINGS_MAX, type HouseholdDoc, type HouseholdSettingsInput, type PlannableMealType } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { useActiveHousehold } from "@/data/households";
import { millis, restartPeriod, saveHouseholdSettings, usePeriod, usePlanItems } from "@/data/plan";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useOnline } from "@/hooks/useOnline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/household")({
  component: HouseholdSettings,
});

const MEAL_LABELS: Record<PlannableMealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function zones(selected: string): string[] {
  let z: string[];
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
          <Stepper label="Default servings" decLabel="Fewer servings" incLabel="More servings" labelledBy="hs-servings" value={form.defaultServings} min={1} max={SERVINGS_MAX} onChange={(v) => setForm((f) => ({ ...f, defaultServings: v }))} />
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
        <RestartPeriod hid={hid} household={household} />
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

const DAY_LABEL: Record<RestartDay, string> = { today: "today", tomorrow: "tomorrow" };
/** Read in event handlers only (the restart is worked out at the moment of the tap). */
const clock = () => Date.now();

/**
 * "Restart period" (R3.1): Today / Tomorrow, each behind a confirmation that says what happens. A no-op (the current
 * period already starts that day) only says so. Needs a connection, like the rollover.
 */
function RestartPeriod({ hid, household }: { hid: string; household: HouseholdDoc }) {
  const notify = useNotify();
  const online = useOnline();
  const period = usePeriod(hid, household.currentPeriodId);
  const items = usePlanItems(hid, household.currentPeriodId);
  const [choice, setChoice] = React.useState<{ day: RestartDay; at: number } | null>(null);
  const day = choice?.day ?? null;
  const [busy, setBusy] = React.useState(false);
  const tz = household.timezone;
  const startMs = millis(period.data?.start);
  const endMs = millis(period.data?.end);
  const current = startMs !== null && endMs !== null ? { startMs, endMs } : null;
  const planned = (items.docs ?? []).filter((d) => d.data.status === "planned").length;
  // Wait for the current period so the no-op check is right.
  const loading = !!household.currentPeriodId && period.data === undefined;
  const next = choice ? restartBounds(choice.at, choice.day, household.periodDays, tz) : null;

  const choose = (d: RestartDay) => {
    const at = clock();
    if (planRestart(current, at, d, household.periodDays, tz).kind === "noop") {
      notify({ kind: "info", message: `The current period already starts ${DAY_LABEL[d]}. Nothing to restart.` });
      return;
    }
    setChoice({ day: d, at });
  };
  const confirm = async () => {
    if (!day) return;
    setBusy(true);
    try {
      const r = await restartPeriod(hid, day);
      if (r.kind === "offline") notify({ kind: "error", message: "You're offline. Restart the period when you're back online." });
      else if (r.kind === "changed") notify({ kind: "error", message: "Someone else just changed the period. Check the Plan page and try again." });
      else if (r.kind === "noop") notify({ kind: "info", message: `The current period already starts ${DAY_LABEL[day]}. Nothing to restart.` });
      else notify({ kind: "success", message: r.kind === "moved" ? `The period now starts ${DAY_LABEL[day]}` : `New period started ${DAY_LABEL[day]}${r.carried ? ` · ${r.carried} planned meal${r.carried === 1 ? "" : "s"} moved` : ""}`, link: { to: "/plan", label: "Plan" } });
      setChoice(null);
    } catch (e) {
      notify({ kind: "error", message: `Couldn't restart the period: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t-2 border-dashed border-line pt-3">
      <span className="flex flex-col gap-0.5">
        <span id="hs-restart" className="text-[0.9375rem] font-extrabold">
          Restart period
        </span>
        <span className="font-mono text-[0.625rem] font-bold text-sub uppercase">
          {current ? `Now ${formatPeriodRange(current.startMs, current.endMs, tz)} · ` : ""}start a new {household.periodDays}-day period
        </span>
      </span>
      <div role="group" aria-labelledby="hs-restart" className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={!online || busy || loading} onClick={() => choose("today")}>
          Today
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={!online || busy || loading} onClick={() => choose("tomorrow")}>
          Tomorrow
        </Button>
      </div>
      {!online ? <span className="text-[0.75rem] font-semibold text-sub">You're offline. Restarting the period needs a connection.</span> : null}
      <ConfirmDialog
        open={day !== null}
        onOpenChange={(o) => !o && !busy && setChoice(null)}
        title={`Restart the period ${day ? DAY_LABEL[day] : ""}?`}
        confirmLabel={busy ? "Restarting…" : "Restart period"}
        busy={busy}
        onConfirm={() => void confirm()}
      >
        <p className="m-0">
          Ends the current period now; {planned} planned meal{planned === 1 ? "" : "s"} move{planned === 1 ? "s" : ""} to the new one
          {next ? ` (${formatPeriodRange(next.startMs, next.endMs, tz)})` : ""}.
        </p>
        <p className="m-0 mt-2 text-sub">Cooked meals stay in the old period and in History. The new period's budget is {formatCents(household.budgetCents)}.</p>
      </ConfirmDialog>
    </div>
  );
}
