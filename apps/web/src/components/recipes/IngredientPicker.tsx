// <IngredientPicker> (TECHNICAL_SPECS §5 "Ingredient picker", PRD R8.3): a typeahead over ingredient names and aliases
// ("chicken" → chicken breast, chicken thigh, whole chicken…), with a "create new" path that asks for a category, the
// allowed measurements, and the conversions they need. Anything incomplete is saved flagged needsReview.
import { NutrientInputs } from "@/components/ingredients/NutrientInputs";
import { nutrientsFrom, useNutrientStrings } from "@/components/ingredients/nutrients";
import * as React from "react";
import {
  categoryDefaults,
  guessCategory,
  ingredientSlug,
  INGREDIENT_CATEGORIES,
  MEASURES,
  normalizeName,
  reviewReasons,
  taxonomyLabel,
  type Measure,
} from "@solving-food/core";
import { saveIngredient, searchIngredients, type IngredientEntry } from "@/data/ingredients";
import { useNotify } from "@/components/notifications-context";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleChip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";



export function IngredientPicker({
  ingredients,
  value,
  onPick,
  uid,
  label,
  autoFocus,
  allowCreate = true,
  exclude,
  placeholder = "Ingredient (e.g. chicken)",
}: {
  ingredients: readonly IngredientEntry[];
  /** The selected ingredient, if any (shown as the input's text). */
  value?: IngredientEntry | undefined;
  onPick: (i: IngredientEntry, typed: string) => void;
  uid: string;
  label: string;
  autoFocus?: boolean;
  /** Offer "Create …" when nothing matches (off for "Merge into…", which only picks existing ingredients). */
  allowCreate?: boolean;
  /** IDs never offered (the ingredient being merged). */
  exclude?: readonly string[];
  placeholder?: string;
}) {
  const [text, setText] = React.useState(value?.name ?? "");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [creating, setCreating] = React.useState<string | null>(null);
  const listId = React.useId();
  // Blur closes the list after a beat (so a tap on an option lands first); focus coming back cancels that, or a
  // blur-then-refocus (browser autofocus, a re-render, a tap on the input itself) would close the list just opened.
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  React.useEffect(() => cancelClose, []);
  const results = React.useMemo(() => searchIngredients(exclude?.length ? ingredients.filter((i) => !exclude.includes(i.id)) : ingredients, text), [ingredients, text, exclude]);
  const exact = results.some((r) => normalizeName(r.name) === normalizeName(text) || r.aliases.some((a) => normalizeName(a) === normalizeName(text)));
  const options: Array<{ kind: "pick"; i: IngredientEntry } | { kind: "create" }> = [
    ...results.map((i) => ({ kind: "pick" as const, i })),
    ...(allowCreate && text.trim() && !exact ? [{ kind: "create" as const }] : []),
  ];

  const valueName = value?.name ?? "";
  const [seenValue, setSeenValue] = React.useState(valueName);
  if (valueName !== seenValue) {
    setSeenValue(valueName);
    setText(valueName);
  }

  const choose = (k: number) => {
    const o = options[k];
    if (!o) return;
    if (o.kind === "pick") {
      onPick(o.i, text);
      setText(o.i.name);
      setOpen(false);
    } else {
      setCreating(text.trim());
      setOpen(false);
    }
  };

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <Label className="sr-only" htmlFor={`${listId}-input`}>
        {label}
      </Label>
      <Input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-label={label}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          cancelClose();
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={() => {
          cancelClose();
          closeTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open && options.length) {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="py-2.5 shadow-hard-sm"
      />
      {open && options.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute top-full z-30 m-0 mt-1 w-full list-none overflow-hidden rounded-ui border-bw bg-base p-0 shadow-hard">
          {options.map((o, k) => (
            <li
              key={o.kind === "pick" ? o.i.id : "create"}
              id={`${listId}-${k}`}
              role="option"
              aria-selected={k === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(k);
              }}
              onMouseEnter={() => setActive(k)}
              className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-bold", k && "border-t-2 border-line", k === active ? "bg-acc text-onc" : "text-ink")}
            >
              {o.kind === "pick" ? (
                <>
                  <span className="first-letter:uppercase">{o.i.name}</span>
                  <span className="font-mono text-[0.625rem] font-semibold uppercase">
                    {o.i.category} · {o.i.allowedMeasures.join("/")}
                    {o.i.needsReview ? " · review" : ""}
                  </span>
                </>
              ) : (
                <span>
                  Create “{text.trim()}”…
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {creating !== null ? (
        <NewIngredientForm
          initialName={creating}
          existing={ingredients}
          uid={uid}
          onCancel={() => setCreating(null)}
          onCreated={(i) => {
            setCreating(null);
            setText(i.name);
            onPick(i, i.name);
          }}
        />
      ) : null}
    </div>
  );
}

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The "create new" path: category, allowed measurements, and the conversions they need (§5). */
export function NewIngredientForm({
  initialName,
  existing,
  uid,
  onCreated,
  onCancel,
}: {
  initialName: string;
  existing: readonly IngredientEntry[];
  uid: string;
  onCreated: (i: IngredientEntry) => void;
  onCancel: () => void;
}) {
  const notify = useNotify();
  const [name, setName] = React.useState(initialName.toLowerCase());
  const [category, setCategory] = React.useState<string>(guessCategory(initialName));
  const [measures, setMeasures] = React.useState<Measure[]>(categoryDefaults(guessCategory(initialName)).allowedMeasures);
  const [density, setDensity] = React.useState("");
  const [unitWeight, setUnitWeight] = React.useState("");
  const [protein, setProtein] = React.useState("");
  const [fibre, setFibre] = React.useState("");
  const [nutrients, setNutrients] = useNutrientStrings(undefined);
  const [busy, setBusy] = React.useState(false);
  const id = ingredientSlug(name);
  const taken = existing.some((i) => i.id === id);

  const save = async () => {
    if (!name.trim() || taken || measures.length === 0) return;
    setBusy(true);
    const d = categoryDefaults(category);
    const doc = {
      name: name.trim(),
      aliases: [],
      category,
      defaultLocation: d.defaultLocation,
      allowedMeasures: measures,
      canonicalUnit: measures.includes("weight") || num(unitWeight) ? ("g" as const) : ("count" as const),
      densityGPerMl: measures.includes("volume") ? num(density) : undefined,
      unitWeightG: measures.includes("count") ? num(unitWeight) : undefined,
      proteinPer100g: protein.trim() === "" ? undefined : Math.max(0, Number(protein)),
      fibrePer100g: fibre.trim() === "" || !Number.isFinite(Number(fibre)) ? undefined : Math.max(0, Number(fibre)),
      nutrients: nutrientsFrom(nutrients),
      nutrientSource: nutrientsFrom(nutrients) ? "Entered in the app" : undefined,
      shelfLifeDays: d.shelfLifeDays,
      freezable: d.freezable,
      isStaple: false,
      freeUse: false,
    };
    try {
      await saveIngredient(id, doc, uid, true);
      const reasons = reviewReasons(doc);
      notify({ kind: reasons.length ? "info" : "success", message: reasons.length ? `Added “${doc.name}”; it's flagged for review (missing ${reasons.map((r) => r.replace("missing", "").toLowerCase()).join(", ")})` : `Added “${doc.name}”` });
      onCreated({ id, ...doc, needsReview: reasons.length > 0 });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't add the ingredient: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-3 rounded-ui border-2 border-dashed border-line bg-base p-3" role="group" aria-label="New ingredient">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">NEW INGREDIENT</span>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-ing-name">Name</Label>
        <Input id="new-ing-name" value={name} onChange={(e) => setName(e.target.value)} className="py-2.5 shadow-hard-sm" aria-invalid={taken || undefined} />
        {taken ? <span className="text-xs font-bold text-ink">That ingredient already exists; pick it from the list.</span> : null}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-ing-cat">Category</Label>
        <Select id="new-ing-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="py-2.5 shadow-hard-sm">
          {INGREDIENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {taxonomyLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      <div role="group" aria-label="Allowed measurements" className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">Allowed measurements</span>
        <div className="flex flex-wrap gap-2">
          {MEASURES.map((m) => (
            <ToggleChip key={m} pressed={measures.includes(m)} onClick={() => setMeasures((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]))}>
              {taxonomyLabel(m)}
            </ToggleChip>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {measures.includes("volume") ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-ing-density">Density g/ml</Label>
            <Input id="new-ing-density" inputMode="decimal" value={density} onChange={(e) => setDensity(e.target.value)} placeholder="e.g. 0.53" className="py-2.5 shadow-hard-sm" />
          </div>
        ) : null}
        {measures.includes("count") ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-ing-unit">Grams per piece</Label>
            <Input id="new-ing-unit" inputMode="decimal" value={unitWeight} onChange={(e) => setUnitWeight(e.target.value)} placeholder="e.g. 50" className="py-2.5 shadow-hard-sm" />
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-ing-protein">Protein g/100 g</Label>
          <Input id="new-ing-protein" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="e.g. 10" className="py-2.5 shadow-hard-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-ing-fibre">Fibre g/100 g</Label>
          <Input id="new-ing-fibre" inputMode="decimal" value={fibre} onChange={(e) => setFibre(e.target.value)} placeholder="e.g. 2.5" className="py-2.5 shadow-hard-sm" />
        </div>
      </div>
      <details className="rounded-ui border-2 border-line bg-base px-2.5 py-1.5">
        <summary className="cursor-pointer text-[0.8125rem] font-extrabold">Nutrition facts per 100 g (optional)</summary>
        <div className="pt-2">
          <NutrientInputs value={nutrients} onChange={setNutrients} idPrefix="new-ing-nf" />
        </div>
      </details>
      <p className="m-0 text-xs font-semibold text-sub">Leave a conversion blank if you don't know it; the ingredient is flagged for review and amounts in it won't convert yet.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !name.trim() || taken || measures.length === 0} onClick={save}>
          Add ingredient
        </Button>
      </div>
    </div>
  );
}
