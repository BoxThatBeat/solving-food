// Nutrition facts per 100 g on an ingredient (M10, R4.30): the optional fields of the ingredient editor and the
// new-ingredient form.
import { NUTRITION_KEYS, NUTRITION_LABELS } from "@solving-food/core";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NutrientStrings } from "./nutrients";

export function NutrientInputs({ value, onChange, idPrefix }: { value: NutrientStrings; onChange: (v: NutrientStrings) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" role="group" aria-label="Nutrition facts per 100 g">
      {NUTRITION_KEYS.map((k) => (
        <div key={k} className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-${k}`}>{NUTRITION_LABELS[k]}</Label>
          <Input id={`${idPrefix}-${k}`} inputMode="decimal" value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

