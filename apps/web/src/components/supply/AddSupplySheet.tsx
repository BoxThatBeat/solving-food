// Add to supply (PRD R8.2, R8.3; prototype sheet "sup" add mode): type an ingredient ("chicken"), pick from the
// matches, enter an amount in any allowed measurement, choose where it's kept → `addSupply`.
import * as React from "react";
import { enterableMeasures, STORAGE_LOCATIONS, toCanonical, unitLabel, type Measure, type StorageLocation } from "@solving-food/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/chip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useNotify } from "@/components/notifications-context";
import { useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { sendCommand } from "@/data/supply";
import { cn } from "@/lib/utils";
import { amountText, LOCATION_LABEL } from "./format";

const UNITS: Record<Measure, string[]> = { weight: ["g", "kg", "oz", "lb"], volume: ["ml", "l", "cup", "tbsp", "tsp"], count: ["count"] };

export function AddSupplySheet({ open, onOpenChange, hid, uid }: { open: boolean; onOpenChange: (o: boolean) => void; hid: string; uid: string }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? <AddSupplyBody hid={hid} uid={uid} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function AddSupplyBody({ hid, uid, close }: { hid: string; uid: string; close: () => void }) {
  const notify = useNotify();
  const ing = useAllIngredients();
  const [pick, setPick] = React.useState<IngredientEntry | undefined>();
  const [unit, setUnit] = React.useState("g");
  const [amount, setAmount] = React.useState("");
  const [location, setLocation] = React.useState<StorageLocation>("fridge");
  const units = pick ? enterableMeasures(pick).flatMap((m) => UNITS[m]) : [];
  const n = Number(amount.replace(",", "."));
  const canon = pick && amount.trim() && n > 0 ? toCanonical(n, unit, pick) : null;
  const ok = !!canon?.ok;
  const choose = (i: IngredientEntry) => {
    setPick(i);
    const first = enterableMeasures(i)[0] ?? "weight";
    setUnit(UNITS[first][0]!);
    setLocation(i.defaultLocation);
  };
  const add = () => {
    if (!pick || !canon?.ok) return;
    // Typed in any allowed unit (oz, cups…), recorded and shown in metric (R8.13).
    const entered = amountText(canon.canonicalAmount, { canonicalUnit: pick.canonicalUnit, unitWeightG: pick.unitWeightG });
    sendCommand(hid, uid, "addSupply", { ingredientId: pick.id, amount: canon.canonicalAmount, location, entered });
    notify({ kind: "success", message: pick.freeUse ? `${pick.name}: noted as bought (staples aren't tracked by amount)` : `${entered} ${pick.name} added to supply` });
    close();
  };
  return (
    <SheetContent
      title="Add to supply"
      description="Pick an ingredient, enter an amount, choose where it's kept"
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
        </>
      ) : (
        <p className="m-0 text-[0.8125rem] font-semibold text-sub">Supply starts empty. Add what you already have: type a name and pick the closest match.</p>
      )}
    </SheetContent>
  );
}
