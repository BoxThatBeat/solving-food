// Ingredient editor (Planning/M1 §1, PRD R8.3, R8.14; spec §5): allowed measurements and the conversions they need,
// protein, shelf lives, pack size, cadence, and the free-use / staple flags. Saving recomputes `needsReview`; recipes
// that use the ingredient pick up new conversions through the ingredientRecipes function.
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  INGREDIENT_CATEGORIES,
  MEASURES,
  reviewReasons,
  STORAGE_LOCATIONS,
  taxonomyLabel,
  type IngredientDoc,
  type Measure,
  type StorageLocation,
} from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel, ToggleChip } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { saveIngredient, useIngredientsById } from "@/data/ingredients";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/ingredients/$id")({
  component: IngredientPage,
});

function IngredientPage() {
  const { id } = Route.useParams();
  const map = useIngredientsById([id]);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 2500);
    return () => clearTimeout(t);
  }, []);
  const ing = map.get(id);
  return (
    <PageBody className="max-w-[48rem]">
      <Link to="/ingredients" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Ingredients
      </Link>
      <PageHeader title={ing ? ing.name.charAt(0).toUpperCase() + ing.name.slice(1) : "Ingredient"} kicker="Ingredient · shared by everyone" />
      {ing ? <IngredientForm id={id} initial={ing} /> : loaded ? <EmptyState>No such ingredient.</EmptyState> : <p className="m-0 text-sm font-semibold">Loading…</p>}
    </PageBody>
  );
}

const numStr = (n: number | null | undefined) => (n === undefined || n === null ? "" : String(n));
const toNum = (s: string) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

function IngredientForm({ id, initial }: { id: string; initial: IngredientDoc }) {
  const s = useReadySession();
  const notify = useNotify();
  const [name, setName] = React.useState(initial.name);
  const [aliases, setAliases] = React.useState(initial.aliases.join(", "));
  const [category, setCategory] = React.useState(initial.category);
  const [location, setLocation] = React.useState<StorageLocation>(initial.defaultLocation);
  const [measures, setMeasures] = React.useState<Measure[]>(initial.allowedMeasures);
  const [density, setDensity] = React.useState(numStr(initial.densityGPerMl));
  const [unitWeight, setUnitWeight] = React.useState(numStr(initial.unitWeightG));
  const [protein, setProtein] = React.useState(numStr(initial.proteinPer100g));
  const [shelf, setShelf] = React.useState<Record<StorageLocation, string>>({
    pantry: numStr(initial.shelfLifeDays.pantry),
    cupboard: numStr(initial.shelfLifeDays.cupboard),
    fridge: numStr(initial.shelfLifeDays.fridge),
    freezer: numStr(initial.shelfLifeDays.freezer),
  });
  const [packAmount, setPackAmount] = React.useState(numStr(initial.defaultPackAmount));
  const [packMeasure, setPackMeasure] = React.useState<Measure | "">(initial.defaultPackMeasure ?? "");
  const [cadence, setCadence] = React.useState(numStr(initial.defaultCadenceDays));
  const [freezable, setFreezable] = React.useState(initial.freezable);
  const [isStaple, setIsStaple] = React.useState(initial.isStaple);
  const [freeUse, setFreeUse] = React.useState(initial.freeUse);
  const [sidePortion, setSidePortion] = React.useState(numStr(initial.side?.portion));
  const [busy, setBusy] = React.useState(false);

  const draft = {
    allowedMeasures: measures,
    canonicalUnit: (measures.includes("weight") || toNum(unitWeight) ? "g" : "count") as "g" | "count",
    densityGPerMl: toNum(density),
    unitWeightG: toNum(unitWeight),
    proteinPer100g: toNum(protein),
  };
  const reasons = reviewReasons(draft);

  const save = async () => {
    setBusy(true);
    const shelfLifeDays = Object.fromEntries(STORAGE_LOCATIONS.filter((l) => shelf[l].trim() !== "" || initial.shelfLifeDays[l] === null).map((l) => [l, toNum(shelf[l]) ?? null]));
    try {
      await saveIngredient(
        id,
        {
          name: name.trim().toLowerCase(),
          aliases: aliases.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean),
          category,
          defaultLocation: location,
          ...draft,
          shelfLifeDays,
          defaultPackAmount: packMeasure ? toNum(packAmount) : undefined,
          defaultPackMeasure: packMeasure && toNum(packAmount) ? packMeasure : undefined,
          defaultCadenceDays: isStaple ? toNum(cadence) : undefined,
          freezable,
          isStaple: isStaple || freeUse,
          freeUse,
          // A side (R5.9) for every household; free-use ingredients aren't tracked, so they can't be sides.
          side: !freeUse && toNum(sidePortion) ? { portion: toNum(sidePortion)! } : undefined,
        },
        s.user.uid,
        false,
      );
      notify({ kind: "success", message: `Saved ${name.trim()}${reasons.length ? " (still needs review)" : ""}` });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't save: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {reasons.length ? (
        <div role="status" className="rounded-ui border-bw bg-yellow p-3 text-sm font-extrabold text-onc">
          Needs review: {reasons.map((r) => ({ missingDensity: "a density (volume is allowed)", missingUnitWeight: "a weight per piece (count is allowed)", missingProtein: "protein per 100 g" })[r]).join(", ")}.
        </div>
      ) : null}
      <Card>
        <SectionLabel>Names</SectionLabel>
        <F label="Name" value={name} onChange={setName} />
        <F label="Aliases (comma separated)" value={aliases} onChange={setAliases} />
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ing-cat">Category</Label>
            <Select id="ing-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {INGREDIENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {taxonomyLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ing-loc">Kept in</Label>
            <Select id="ing-loc" value={location} onChange={(e) => setLocation(e.target.value as StorageLocation)}>
              {STORAGE_LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {taxonomyLabel(l)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>
      <Card>
        <SectionLabel hint="R8.3">Measurements and conversions</SectionLabel>
        <div role="group" aria-label="Allowed measurements" className="flex flex-wrap gap-2">
          {MEASURES.map((m) => (
            <ToggleChip key={m} pressed={measures.includes(m)} onClick={() => setMeasures((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]))}>
              {taxonomyLabel(m)}
            </ToggleChip>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <F label="Density g/ml" value={density} onChange={setDensity} numeric disabled={!measures.includes("volume")} />
          <F label="Grams per piece" value={unitWeight} onChange={setUnitWeight} numeric disabled={!measures.includes("count")} />
          <F label="Protein g/100 g" value={protein} onChange={setProtein} numeric />
        </div>
      </Card>
      <Card>
        <SectionLabel hint="Days; blank = not kept there">Shelf life</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {STORAGE_LOCATIONS.map((l) => (
            <F key={l} label={taxonomyLabel(l)} value={shelf[l]} onChange={(v) => setShelf((x) => ({ ...x, [l]: v }))} numeric />
          ))}
        </div>
      </Card>
      <Card>
        <SectionLabel>Shopping</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <F label="Default pack" value={packAmount} onChange={setPackAmount} numeric />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ing-pack">Pack unit</Label>
            <Select id="ing-pack" value={packMeasure} onChange={(e) => setPackMeasure(e.target.value as Measure | "")}>
              <option value="">—</option>
              <option value="weight">grams</option>
              <option value="volume">millilitres</option>
              <option value="count">pieces</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToggleChip pressed={freezable} onClick={() => setFreezable((v) => !v)}>
            Freezable
          </ToggleChip>
          <ToggleChip pressed={isStaple || freeUse} onClick={() => setIsStaple((v) => !v)} disabled={freeUse}>
            Staple
          </ToggleChip>
          <ToggleChip pressed={freeUse} onClick={() => setFreeUse((v) => !v)}>
            Free use (not tracked by amount)
          </ToggleChip>
        </div>
        {isStaple || freeUse ? <F label="Bought every … days" value={cadence} onChange={setCadence} numeric /> : null}
      </Card>
      <Card>
        <SectionLabel hint="R5.9 · blank = not a side">Side</SectionLabel>
        <F
          label={`Portion per person (${draft.canonicalUnit === "count" ? "pieces" : "g"})`}
          value={freeUse ? "" : sidePortion}
          onChange={setSidePortion}
          numeric
          disabled={freeUse}
        />
        <span className="text-[0.75rem] font-semibold text-sub">
          {freeUse ? "Free-use ingredients aren't tracked, so they can't be sides." : "Eaten as is with a meal (fries, rice, buns). Households can change the portion in Settings → Sides."}
        </span>
      </Card>
      <Button onClick={save} disabled={busy || !name.trim() || measures.length === 0}>
        {busy ? "Saving…" : "Save ingredient"}
      </Button>
    </div>
  );
}

function F({ label, value, onChange, numeric, disabled }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; disabled?: boolean }) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={numeric ? "decimal" : undefined} disabled={disabled} className="disabled:opacity-50" />
    </div>
  );
}
