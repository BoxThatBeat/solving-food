// Add to supply (PRD R8.2, R8.3; prototype sheet "sup" add mode): type an ingredient ("chicken"), pick from the
// matches, enter an amount in any allowed measurement, choose where it's kept, optionally set the use-by date
// (R8.18) → `addSupply`.
import * as React from "react";
import {
  addDays,
  enterableMeasures,
  estimateExpiry,
  localDate,
  localMidnight,
  STORAGE_LOCATIONS,
  toCanonical,
  unitLabel,
  type Measure,
  type StorageLocation,
} from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/chip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useNotify } from "@/components/notifications-context";
import { useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { sendCommand } from "@/data/supply";
import { cn } from "@/lib/utils";
import { amountText, dateText, LOCATION_LABEL } from "./format";

const UNITS: Record<Measure, string[]> = { weight: ["g", "kg", "oz", "lb"], volume: ["ml", "l", "cup", "tbsp", "tsp"], count: ["count"] };

export function AddSupplySheet({ open, onOpenChange, hid, uid, tz, nowMs }: { open: boolean; onOpenChange: (o: boolean) => void; hid: string; uid: string; tz: string; nowMs: number }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? <AddSupplyBody hid={hid} uid={uid} tz={tz} nowMs={nowMs} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function AddSupplyBody({ hid, uid, tz, nowMs, close }: { hid: string; uid: string; tz: string; nowMs: number; close: () => void }) {
  const notify = useNotify();
  const ing = useAllIngredients();
  const [pick, setPick] = React.useState<IngredientEntry | undefined>();
  const [unit, setUnit] = React.useState("g");
  const [amount, setAmount] = React.useState("");
  const [location, setLocation] = React.useState<StorageLocation>("fridge");
  // Use-by picked by hand (yyyy-mm-dd), or null for the ingredient's typical shelf life where it's kept.
  const [dating, setDating] = React.useState<string | null>(null);
  const today = localDate(nowMs, tz);
  const typical = pick ? estimateExpiry(pick.shelfLifeDays, location, nowMs, tz) : null;
  const dateOk = dating === null || (!!dating && dating >= today);
  const units = pick ? enterableMeasures(pick).flatMap((m) => UNITS[m]) : [];
  const n = Number(amount.replace(",", "."));
  const canon = pick && amount.trim() && n > 0 ? toCanonical(n, unit, pick) : null;
  const ok = !!canon?.ok && dateOk;
  const choose = (i: IngredientEntry) => {
    setPick(i);
    const first = enterableMeasures(i)[0] ?? "weight";
    setUnit(UNITS[first][0]!);
    setLocation(i.defaultLocation);
    setDating(null);
  };
  const add = () => {
    if (!pick || !canon?.ok) return;
    // Typed in any allowed unit (oz, cups…), recorded and shown in metric (R8.13).
    const entered = amountText(canon.canonicalAmount, { canonicalUnit: pick.canonicalUnit, unitWeightG: pick.unitWeightG });
    // The lot counts until the midnight after its use-by day (R8.15), as Set date on a lot does.
    const until = dating && !pick.freeUse ? localMidnight(addDays(dating, 1), tz) : undefined;
    sendCommand(hid, uid, "addSupply", { ingredientId: pick.id, amount: canon.canonicalAmount, location, entered, ...(until ? { until } : {}) });
    notify({
      kind: "success",
      message: pick.freeUse ? `${pick.name}: noted as bought (staples aren't tracked by amount)` : `${entered} ${pick.name} added to supply${dating ? ` · use by ${dateText(localMidnight(dating, tz), tz)}` : ""}`,
    });
    close();
  };
  return (
    <SheetContent
      title="Add to supply"
      description="Pick an ingredient, enter an amount, choose where it's kept and when to use it by"
      footer={
        <Button className="w-full" size="lg" disabled={!ok} onClick={add}>
          {pick && ok ? `Add ${amountText(canon!.ok ? canon!.canonicalAmount : 0, { canonicalUnit: pick.canonicalUnit, unitWeightG: pick.unitWeightG })}` : "Add"}
        </Button>
      }
    >
      <IngredientPicker ingredients={ing.list ?? []} value={pick} onPick={choose} uid={uid} label="Ingredient" autoFocus />
      {pick ? (
        <>
          {pick.freeUse ? (
            <p className="m-0 rounded-ui border-2 border-line bg-yellow p-2.5 text-[0.8125rem] font-bold text-onc">
              {pick.name.charAt(0).toUpperCase() + pick.name.slice(1)} is a staple: it isn't tracked by amount. Adding it records that you bought it.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <SectionLabel id="add-amount">Amount</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Input aria-labelledby="add-amount" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0 flex-1 basis-32 font-mono text-[1.125rem] font-extrabold" />
              <div role="group" aria-label="Unit" className="flex flex-wrap gap-1">
                {units.map((u) => (
                  <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)} className={cn("min-h-11 cursor-pointer rounded-ui border-2 border-line px-3 font-mono text-[0.8125rem] font-extrabold", unit === u ? "bg-acc text-onc" : "bg-base text-ink")}>
                    {u === "count" ? "count" : unitLabel(u, 2)}
                  </button>
                ))}
              </div>
            </div>
            {canon && !canon.ok ? <span className="text-[0.75rem] font-bold text-ink">This ingredient can't be entered that way.</span> : null}
            {canon?.ok ? <span className="font-mono text-[0.6875rem] font-semibold text-sub">= {amountText(canon.canonicalAmount, { canonicalUnit: pick.canonicalUnit, unitWeightG: pick.unitWeightG })}</span> : null}
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0">
              <SectionLabel>Kept in</SectionLabel>
            </legend>
            <div className="grid grid-cols-4 overflow-hidden rounded-ui border-2 border-line bg-base">
              {STORAGE_LOCATIONS.map((l, i) => (
                <button key={l} type="button" aria-pressed={location === l} onClick={() => setLocation(l)} className={cn("min-h-11 cursor-pointer text-[0.8125rem] font-extrabold", i ? "border-l-2 border-line" : "", location === l ? "bg-acc text-onc" : "bg-base text-ink")}>
                  {LOCATION_LABEL[l]}
                </button>
              ))}
            </div>
          </fieldset>
          {pick.freeUse ? null : (
            <div className="flex flex-col gap-2">
              <SectionLabel id="add-useby">Use by</SectionLabel>
              {dating === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-mono text-[0.75rem] font-bold uppercase" data-testid="add-useby-typical">
                    {typical ? `${dateText(typical - 1, tz)} · typical in the ${LOCATION_LABEL[location].toLowerCase()}` : "No typical date"}
                  </span>
                  <Button
                    size="sm"
                    variant="chip"
                    type="button"
                    aria-label={`Set the use-by date of this ${pick.name}`}
                    onClick={() => setDating(typical && typical - 1 >= localMidnight(today, tz) ? localDate(typical - 1, tz) : addDays(today, 3))}
                  >
                    Set date
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-ui border-2 border-line bg-mantle p-2">
                  <Input
                    type="date"
                    value={dating}
                    min={today}
                    onChange={(ev) => setDating(ev.target.value)}
                    onClick={(ev) => {
                      try {
                        ev.currentTarget.showPicker();
                      } catch {
                        /* not every browser lets a page open the calendar */
                      }
                    }}
                    aria-labelledby="add-useby"
                    className="min-w-0 flex-1 basis-40 py-2"
                  />
                  <Button size="sm" variant="secondary" type="button" onClick={() => setDating(null)}>
                    Use typical
                  </Button>
                  {!dateOk ? <span className="basis-full text-[0.75rem] font-bold text-ink">Pick today or a later day.</span> : null}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="m-0 text-[0.8125rem] font-semibold text-sub">Supply starts empty. Add what you already have: type a name and pick the closest match.</p>
      )}
    </SheetContent>
  );
}
