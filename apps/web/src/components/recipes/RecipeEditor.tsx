// The recipe editor (Planning/M1 §2, PRD R4.15, R4.19, R4.20, R4.25; spec §11 "Editors", "Offline recipe edits").
// react-hook-form + zod. Works on a copy of the recipe taken when it opens; saving checks the version first and offers
// reload / overwrite when someone else saved meanwhile. Needs a connection to save: offline, the draft is kept in
// IndexedDB and saved automatically once back online. New recipes are checked for duplicates first.
import * as React from "react";
import { useForm, useFieldArray, useWatch, Controller, type Control, type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { useNavigate, Link } from "@tanstack/react-router";
import { Trash2, ArrowUp, ArrowDown, Plus } from "lucide-react";
import {
  canonicalUrl,
  CUISINES,
  deriveRecipe,
  describeMatch,
  enterableMeasures,
  findDuplicates,
  MAIN_PROTEINS,
  MEAL_TYPES,
  nextLineId,
  placeholder,
  refsIn,
  renderStepText,
  taxonomyLabel,
  unitDef,
  unitLabel,
  UNITS,
  UNITS_BY_MEASURE,
  type DuplicateMatch,
  type RecipeContent,
} from "@solving-food/core";
import { useNotify } from "@/components/notifications-context";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel, Textarea, ToggleChip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { lookupFromMap, useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { createRecipe, EditedElsewhereError, OfflineError, saveRecipe, type StoredRecipe } from "@/data/recipes";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { useOnline } from "@/hooks/useOnline";
import { uploadRecipeImage } from "@/lib/images";
import { cn } from "@/lib/utils";
import { IngredientPicker } from "./IngredientPicker";
import { RecipeImage } from "./RecipeImage";

const lineSchema = z.object({
  id: z.string(),
  ingredientId: z.string().min(1, "Pick an ingredient"),
  displayText: z.string().trim().min(1, "Name it"),
  amount: z.string(),
  measure: z.string().min(1),
  optional: z.boolean(),
});

const formSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  servings: z.coerce.number<string | number>().int().min(1, "At least 1").max(100),
  prepMin: z.coerce.number<string | number>().int().min(0).max(10_000),
  cookMin: z.coerce.number<string | number>().int().min(0).max(10_000),
  cuisine: z.enum(CUISINES),
  mainProtein: z.enum(MAIN_PROTEINS),
  tags: z.array(z.string()),
  tools: z.array(z.string()),
  ingredients: z.array(lineSchema),
  steps: z.array(z.object({ text: z.string(), timerMinutes: z.string(), section: z.string() })),
  prepTasks: z.array(z.object({ text: z.string() })),
  defaultLeftoverPortions: z.coerce.number<string | number>().int().min(0).max(50),
  leftoverMealType: z.enum(["", ...MEAL_TYPES]),
  notes: z.string().max(5000),
  sourceUrl: z.union([z.literal(""), z.url("Enter a full URL (https://…)")]),
  imagePaths: z.array(z.string()),
});
type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;

function toForm(c: RecipeContent | null): FormInput {
  if (!c) {
    return {
      title: "",
      servings: 4,
      prepMin: 10,
      cookMin: 20,
      cuisine: "other",
      mainProtein: "none",
      tags: ["dinner"],
      tools: [],
      ingredients: [],
      steps: [{ text: "", timerMinutes: "", section: "" }],
      prepTasks: [],
      defaultLeftoverPortions: 0,
      leftoverMealType: "",
      notes: "",
      sourceUrl: "",
      imagePaths: [],
    };
  }
  return {
    title: c.title,
    servings: c.servings,
    prepMin: c.prepMin,
    cookMin: c.cookMin,
    cuisine: c.cuisine,
    mainProtein: c.mainProtein,
    tags: c.tags,
    tools: c.tools,
    ingredients: c.ingredients.map((l) => ({ id: l.id, ingredientId: l.ingredientId, displayText: l.displayText, amount: l.amount ? String(l.amount) : "", measure: l.measure, optional: l.optional })),
    steps: c.steps.map((s) => ({ text: s.text, timerMinutes: s.timerSeconds ? String(Math.round((s.timerSeconds / 60) * 100) / 100) : "", section: s.section ?? "" })),
    prepTasks: c.prepTasks.map((p) => ({ text: p.text })),
    defaultLeftoverPortions: c.defaultLeftoverPortions,
    leftoverMealType: c.leftoverMealType ?? "",
    notes: c.notes ?? "",
    sourceUrl: c.sourceUrl ?? "",
    imagePaths: c.imagePaths,
  };
}

function toContent(v: FormValues): RecipeContent {
  const c: RecipeContent = {
    title: v.title.trim(),
    servings: v.servings,
    prepMin: v.prepMin,
    cookMin: v.cookMin,
    cuisine: v.cuisine,
    mainProtein: v.mainProtein,
    tags: [...new Set(v.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    tools: [...new Set(v.tools.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    ingredients: v.ingredients.map((l) => {
      const amount = Number(l.amount);
      const vague = unitDef(l.measure).kind === "vague";
      return {
        id: l.id,
        ingredientId: l.ingredientId,
        displayText: l.displayText.trim(),
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        measure: l.measure,
        canonicalAmount: 0,
        optional: l.optional || vague || !(amount > 0),
      };
    }),
    steps: v.steps
      .filter((s) => s.text.trim())
      .map((s) => {
        const out: RecipeContent["steps"][number] = { text: s.text.trim(), ingredientRefs: refsIn(s.text) };
        const m = Number(s.timerMinutes);
        if (s.timerMinutes.trim() && m > 0) out.timerSeconds = Math.round(m * 60);
        if (s.section.trim()) out.section = s.section.trim();
        return out;
      }),
    prepTasks: v.prepTasks.filter((p) => p.text.trim()).map((p) => ({ text: p.text.trim(), ingredientRefs: refsIn(p.text) })),
    defaultLeftoverPortions: v.defaultLeftoverPortions,
    imagePaths: v.imagePaths,
  };
  if (v.leftoverMealType) c.leftoverMealType = v.leftoverMealType;
  if (v.notes.trim()) c.notes = v.notes.trim();
  if (v.sourceUrl.trim()) c.sourceUrl = v.sourceUrl.trim();
  return c;
}

interface Draft {
  values: FormInput;
  baseVersion: number | null;
  savedAt: number;
  pendingSave: boolean;
}

const draftKey = (id: string | null) => `recipe-draft:${id ?? "new"}`;

function makeDraft(values: FormInput, baseVersion: number | null, pendingSave: boolean): Draft {
  return { values, baseVersion, savedAt: Date.now(), pendingSave };
}

export function RecipeEditor({
  id,
  newId,
  recipe,
  uid,
}: {
  /** Existing recipe ID, or null for a new one. */
  id: string | null;
  /** The ID a new recipe will get (images upload under it before the first save). */
  newId: string;
  recipe: StoredRecipe | null;
  uid: string;
}) {
  const navigate = useNavigate();
  const notify = useNotify();
  const online = useOnline();
  const ing = useAllIngredients();
  const index = useRecipeIndex();
  const [baseVersion, setBaseVersion] = React.useState<number | null>(recipe?.version ?? null);
  const [conflict, setConflict] = React.useState<StoredRecipe | null>(null);
  const [dupes, setDupes] = React.useState<{ matches: DuplicateMatch[]; content: RecipeContent } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [restorable, setRestorable] = React.useState<Draft | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const focusedStep = React.useRef<{ index: number; el: HTMLTextAreaElement } | null>(null);

  const form = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(formSchema), defaultValues: toForm(recipe), mode: "onTouched" });
  const { register, control, handleSubmit, setValue, getValues, reset, formState } = form;
  const lines = useFieldArray({ control, name: "ingredients" });
  const steps = useFieldArray({ control, name: "steps" });
  const prep = useFieldArray({ control, name: "prepTasks" });
  const values = useWatch({ control }) as FormInput;
  const recipeId = id ?? newId;
  const lookup = lookupFromMap(ing.byId);

  // Offer a saved draft when there is one.
  React.useEffect(() => {
    let alive = true;
    idbGet<Draft>(draftKey(id))
      .then((d) => {
        if (alive && d && JSON.stringify(d.values) !== JSON.stringify(toForm(recipe))) setRestorable(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the draft on this device while editing (debounced).
  React.useEffect(() => {
    if (!formState.isDirty) return;
    const t = setTimeout(() => {
      void idbSet(draftKey(id), makeDraft(getValues(), baseVersion, !online)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [values, formState.isDirty, id, baseVersion, online, getValues]);

  const finish = async (savedId: string, message: string) => {
    await idbDel(draftKey(id)).catch(() => {});
    reset(getValues());
    notify({ kind: "success", message });
    void navigate({ to: "/recipes/$id", params: { id: savedId } });
  };

  const doSave = async (content: RecipeContent, opts: { overwriteVersion?: number; skipDupes?: boolean } = {}) => {
    setSaving(true);
    try {
      if (id === null) {
        if (!opts.skipDupes) {
          const d = deriveRecipe(content, lookup);
          const matches = findDuplicates(
            { title: content.title, ingredientIds: d.ingredientIds, sourceUrlCanonical: content.sourceUrl ? canonicalUrl(content.sourceUrl) : null, fingerprint: d.fingerprint },
            index ?? [],
          );
          if (matches.length) {
            setDupes({ matches, content });
            return;
          }
        }
        const created = await createRecipe(content, uid, lookup, newId);
        await finish(created, `Saved “${content.title}”`);
      } else {
        const expected = opts.overwriteVersion ?? baseVersion ?? undefined;
        const v = await saveRecipe(id, content, uid, lookup, expected);
        setBaseVersion(v);
        await finish(id, `Saved as v${v} for everyone`);
      }
    } catch (e) {
      if (e instanceof EditedElsewhereError) setConflict(e.current);
      else if (e instanceof OfflineError) {
        await idbSet(draftKey(id), makeDraft(getValues(), baseVersion, true)).catch(() => {});
        notify({ kind: "info", message: "You're offline. The draft is kept on this device and will save when you're back online." });
      } else notify({ kind: "error", message: `Couldn't save: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = handleSubmit((v) => doSave(toContent(v)), () => notify({ kind: "error", message: "Some fields need fixing before saving" }));

  // Back online with a save waiting: re-check the version and save.
  const wasOnline = React.useRef(online);
  React.useEffect(() => {
    if (online && !wasOnline.current) {
      void idbGet<Draft>(draftKey(id)).then((d) => {
        if (d?.pendingSave) void onSubmit();
      });
    }
    wasOnline.current = online;
  }, [online, id, onSubmit]);

  const insertIngredient = (lineId: string) => {
    const f = focusedStep.current;
    const target = f ?? { index: Math.max(0, steps.fields.length - 1), el: null as unknown as HTMLTextAreaElement };
    const name = `steps.${target.index}.text` as const;
    const cur = getValues(name) ?? "";
    const token = placeholder(lineId);
    const at = f?.el ? f.el.selectionStart : cur.length;
    const next = `${cur.slice(0, at)}${cur && at > 0 && !/\s$/.test(cur.slice(0, at)) ? " " : ""}${token}${cur.slice(at)}`;
    setValue(name, next, { shouldDirty: true });
    requestAnimationFrame(() => {
      if (f?.el) {
        f.el.focus();
        const pos = next.indexOf(token, at) + token.length;
        f.el.setSelectionRange(pos, pos);
      }
    });
  };

  const addLine = () => {
    lines.append({ id: nextLineId(getValues("ingredients")), ingredientId: "", displayText: "", amount: "", measure: "g", optional: false });
  };

  const onImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const base = await uploadRecipeImage(recipeId, file);
      setValue("imagePaths", [base, ...getValues("imagePaths")], { shouldDirty: true });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't add the photo: ${(e as Error).message}` });
    } finally {
      setUploading(false);
    }
  };

  const contentLines = (values.ingredients ?? []).map((l) => ({
    id: l.id,
    ingredientId: l.ingredientId,
    displayText: l.displayText,
    amount: Number(l.amount) > 0 ? Number(l.amount) : 0,
    measure: l.measure,
    canonicalAmount: 0,
    optional: l.optional,
  }));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label={id ? "Edit recipe" : "New recipe"}>
      {restorable ? (
        <div role="status" className="flex flex-wrap items-center gap-2.5 rounded-ui border-2 border-dashed border-line bg-base p-3">
          <span className="flex-1 text-sm font-bold">You have an unsaved draft from {new Date(restorable.savedAt).toLocaleString("en-CA")}.</span>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              reset(restorable.values, { keepDefaultValues: true });
              if (restorable.baseVersion !== null) setBaseVersion(restorable.baseVersion);
              setRestorable(null);
            }}
          >
            Restore draft
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void idbDel(draftKey(id));
              setRestorable(null);
            }}
          >
            Discard
          </Button>
        </div>
      ) : null}
      {!online ? (
        <div role="status" className="rounded-ui border-bw bg-peach p-3 text-sm font-extrabold text-onc">
          You&apos;re offline. Your draft is kept on this device and will save when you&apos;re back online.
        </div>
      ) : null}

      {/* ---------- basics */}
      <Card>
        <SectionLabel>Basics</SectionLabel>
        <Field label="Title" error={formState.errors.title?.message}>
          {(fid) => <Input id={fid} {...register("title")} placeholder="Recipe title" aria-invalid={!!formState.errors.title || undefined} />}
        </Field>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Servings" error={formState.errors.servings?.message}>
            {(fid) => <Input id={fid} type="number" inputMode="numeric" min={1} {...register("servings")} />}
          </Field>
          <Field label="Prep min" error={formState.errors.prepMin?.message}>
            {(fid) => <Input id={fid} type="number" inputMode="numeric" min={0} {...register("prepMin")} />}
          </Field>
          <Field label="Cook min" error={formState.errors.cookMin?.message}>
            {(fid) => <Input id={fid} type="number" inputMode="numeric" min={0} {...register("cookMin")} />}
          </Field>
        </div>
        <ChipChoice label="Cuisine" control={control} name="cuisine" options={CUISINES} />
        <ChipChoice label="Main protein" control={control} name="mainProtein" options={MAIN_PROTEINS} />
        <ChipList label="Tags" hint="Meal type and anything you'll filter by" values={values.tags} onChange={(t) => setValue("tags", t, { shouldDirty: true })} suggestions={[...MEAL_TYPES, "side", "dessert", "family recipe"]} />
        <ChipList label="Tools" hint="Free text for now; kitchen tools settings arrive in M2" values={values.tools} onChange={(t) => setValue("tools", t, { shouldDirty: true })} />
        <Field label="Source URL" error={formState.errors.sourceUrl?.message}>
          {(fid) => <Input id={fid} type="url" inputMode="url" placeholder="https://…" {...register("sourceUrl")} />}
        </Field>
      </Card>

      {/* ---------- images */}
      <Card>
        <SectionLabel hint="Resized to 480 / 960 / 1920 px">Photos</SectionLabel>
        <div className="flex flex-wrap gap-2.5">
          {values.imagePaths.map((p, k) => (
            <div key={p} className="relative h-28 w-28 overflow-hidden rounded-ui border-2 border-line">
              <RecipeImage base={p} cuisine={values.cuisine} alt={k === 0 ? "Main photo" : `Photo ${k + 1}`} sizes="7rem" />
              {k === 0 ? <span className="absolute bottom-1 left-1 rounded border border-line bg-base px-1 font-mono text-[0.5625rem] font-bold">MAIN</span> : null}
              <button
                type="button"
                aria-label={`Remove photo ${k + 1}`}
                onClick={() => setValue("imagePaths", values.imagePaths.filter((x) => x !== p), { shouldDirty: true })}
                className="absolute top-1 right-1 grid size-7 cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
            </div>
          ))}
          <label className={cn("grid h-28 w-28 cursor-pointer place-items-center rounded-ui border-2 border-dashed border-line bg-base p-2 text-center text-xs font-extrabold", uploading && "opacity-60")}>
            {uploading ? "Uploading…" : "+ Add photo"}
            <input type="file" accept="image/*" className="sr-only" disabled={uploading || !online} onChange={(e) => void onImage(e.target.files?.[0])} aria-label="Add photo" />
          </label>
        </div>
      </Card>

      {/* ---------- ingredients */}
      <Card>
        <SectionLabel hint={`${lines.fields.length} lines`}>Ingredients</SectionLabel>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.fields.map((f, k) => (
            <IngredientLine key={f.id} index={k} control={control} register={register} ingredients={ing.list ?? []} byId={ing.byId} uid={uid} onRemove={() => lines.remove(k)} setValue={setValue} error={formState.errors.ingredients?.[k]?.ingredientId?.message} />
          ))}
        </ol>
        <Button type="button" variant="secondary" size="sm" onClick={addLine} className="self-start">
          <Plus aria-hidden /> Add ingredient
        </Button>
        {ing.list === undefined ? <span className="text-xs font-semibold text-sub">Loading ingredients…</span> : null}
      </Card>

      {/* ---------- steps */}
      <Card>
        <SectionLabel hint="Tap an ingredient to insert it where the cursor is">Steps</SectionLabel>
        {contentLines.some((l) => l.ingredientId) ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert ingredient">
            {contentLines
              .filter((l) => l.ingredientId)
              .map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertIngredient(l.id)}
                  className="cursor-pointer rounded-ui border-2 border-line bg-mantle px-2 py-1 text-xs font-extrabold text-ink"
                  aria-label={`Insert ${l.displayText}`}
                >
                  + {l.displayText}
                </button>
              ))}
          </div>
        ) : null}
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {steps.fields.map((f, k) => {
            const text = values.steps[k]?.text ?? "";
            const preview = renderStepText(text, contentLines, lookup);
            return (
              <li key={f.id} className="flex flex-col gap-1.5 rounded-ui border-2 border-line bg-pg p-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 flex-none place-items-center rounded-ui border-2 border-line bg-acc font-mono text-xs font-extrabold text-onc">{k + 1}</span>
                  <Input {...register(`steps.${k}.section`)} placeholder="Section (optional)" aria-label={`Step ${k + 1} section`} className="py-1.5 text-xs shadow-none" />
                  <Input {...register(`steps.${k}.timerMinutes`)} inputMode="decimal" placeholder="Timer min" aria-label={`Step ${k + 1} timer minutes`} className="w-24 flex-none py-1.5 text-xs shadow-none" />
                  <IconBtn label={`Move step ${k + 1} up`} disabled={k === 0} onClick={() => steps.move(k, k - 1)}>
                    <ArrowUp aria-hidden className="size-3.5" />
                  </IconBtn>
                  <IconBtn label={`Move step ${k + 1} down`} disabled={k === steps.fields.length - 1} onClick={() => steps.move(k, k + 1)}>
                    <ArrowDown aria-hidden className="size-3.5" />
                  </IconBtn>
                  <IconBtn label={`Remove step ${k + 1}`} onClick={() => steps.remove(k)}>
                    <Trash2 aria-hidden className="size-3.5" />
                  </IconBtn>
                </div>
                <Textarea
                  {...register(`steps.${k}.text`)}
                  rows={3}
                  aria-label={`Step ${k + 1}`}
                  placeholder="What to do. Insert ingredients with the chips above."
                  onFocus={(e) => (focusedStep.current = { index: k, el: e.currentTarget })}
                  className="text-sm shadow-none"
                />
                {text.includes("{{ing:") ? <p className="m-0 text-xs leading-snug font-semibold text-sub">Reads: {preview}</p> : null}
              </li>
            );
          })}
        </ol>
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => steps.append({ text: "", timerMinutes: "", section: "" })}>
          <Plus aria-hidden /> Add step
        </Button>
      </Card>

      {/* ---------- prep, leftovers, notes */}
      <Card>
        <SectionLabel hint="Mise en place: chop, measure, preheat">Prep tasks</SectionLabel>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {prep.fields.map((f, k) => (
            <li key={f.id} className="flex items-center gap-2">
              <Input {...register(`prepTasks.${k}.text`)} aria-label={`Prep task ${k + 1}`} placeholder="e.g. Preheat oven to 200°C" className="py-2 shadow-none" />
              <IconBtn label={`Remove prep task ${k + 1}`} onClick={() => prep.remove(k)}>
                <Trash2 aria-hidden className="size-3.5" />
              </IconBtn>
            </li>
          ))}
        </ol>
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => prep.append({ text: "" })}>
          <Plus aria-hidden /> Add prep task
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Leftover portions" error={formState.errors.defaultLeftoverPortions?.message}>
            {(fid) => <Input id={fid} type="number" min={0} inputMode="numeric" {...register("defaultLeftoverPortions")} />}
          </Field>
          <Field label="Leftovers for">
            {(fid) => (
              <Select id={fid} {...register("leftoverMealType")}>
                <option value="">—</option>
                {MEAL_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {taxonomyLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Recipe notes" error={formState.errors.notes?.message}>
          {(fid) => <Textarea id={fid} rows={3} {...register("notes")} placeholder="Notes that belong to the recipe for everyone (household notes live on the recipe page)" />}
        </Field>
      </Card>

      {/* The pg-coloured shadow fills down to the phone tab bar (z-20 covers the overshoot), whatever its exact height. */}
      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 flex gap-2.5 border-t-bw bg-pg py-3 shadow-[0_1.5rem_0_var(--pg)] md:bottom-0 md:shadow-none">
        <Button type="button" variant="secondary" onClick={() => (id ? navigate({ to: "/recipes/$id", params: { id } }) : navigate({ to: "/recipes" }))}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={saving || !online || uploading}>
          {saving ? "Saving…" : !online ? "Will save when online" : id ? "Save recipe" : "Save recipe"}
        </Button>
      </div>
      <p className="m-0 text-xs font-semibold text-sub">The library is shared. Anyone can edit; every edit is versioned.</p>

      <ConfirmDialog
        open={!!conflict}
        onOpenChange={(o) => !o && setConflict(null)}
        title="Edited elsewhere"
        confirmLabel="Overwrite"
        destructive
        onConfirm={() => {
          const c = conflict!;
          setConflict(null);
          void handleSubmit((v) => doSave(toContent(v), { overwriteVersion: c.version }))();
        }}
        extra={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              const c = conflict!;
              setConflict(null);
              reset(toForm(c));
              setBaseVersion(c.version);
              void idbDel(draftKey(id));
            }}
          >
            Reload
          </Button>
        }
      >
        Someone saved v{conflict?.version} while you were editing. Reload their version (your changes are lost) or overwrite it with yours?
      </ConfirmDialog>

      <ConfirmDialog
        open={!!dupes}
        onOpenChange={(o) => !o && setDupes(null)}
        title="Possible duplicate"
        cancelLabel="Back to editing"
        confirmLabel="Keep both"
        onConfirm={() => {
          const d = dupes!;
          setDupes(null);
          void doSave(d.content, { skipDupes: true });
        }}
        extra={
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const m = dupes!.matches[0]!;
                setDupes(null);
                void idbDel(draftKey(id));
                void navigate({ to: "/recipes/$id", params: { id: m.id } });
              }}
            >
              Keep existing
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                const d = dupes!;
                const m = d.matches[0]!;
                setDupes(null);
                setSaving(true);
                try {
                  const v = await saveRecipe(m.id, d.content, uid, lookup);
                  await idbDel(draftKey(id)).catch(() => {});
                  reset(getValues());
                  notify({ kind: "success", message: `Saved as v${v} of “${m.title}”` });
                  void navigate({ to: "/recipes/$id", params: { id: m.id } });
                } catch (e) {
                  notify({ kind: "error", message: `Couldn't save: ${(e as Error).message}` });
                } finally {
                  setSaving(false);
                }
              }}
            >
              Keep new
            </Button>
          </>
        }
      >
        {dupes ? (
          <>
            {describeMatch(dupes.matches[0]!)}{" "}
            <Link to="/recipes/$id" params={{ id: dupes.matches[0]!.id }} target="_blank" className="underline">
              Open it
            </Link>
            <br />
            <span className="text-sm text-sub">Keep existing discards this one. Keep new saves yours as the next version of the existing recipe. Keep both saves a separate recipe.</span>
          </>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string | undefined; children: (id: string) => React.ReactNode }) {
  const fid = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={fid}>{label}</Label>
      {children(fid)}
      {error ? (
        <span role="alert" className="text-xs font-bold text-ink">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-8 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}

function ChipChoice<N extends "cuisine" | "mainProtein">({ label, control, name, options }: { label: string; control: Control<FormInput>; name: N; options: readonly string[] }) {
  const lid = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div role="radiogroup" aria-labelledby={lid} className="flex flex-col gap-2">
          <span id={lid} className="font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">
            {label}
          </span>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={field.value === o}
                onClick={() => field.onChange(o)}
                className={cn("min-h-[2.375rem] cursor-pointer rounded-ui border-2 border-line px-3 py-2 text-[0.8125rem] font-extrabold", field.value === o ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm")}
              >
                {taxonomyLabel(o)}
              </button>
            ))}
          </div>
        </div>
      )}
    />
  );
}

function ChipList({ label, hint, values, onChange, suggestions = [] }: { label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = React.useState("");
  const fid = React.useId();
  const add = (t: string) => {
    const v = t.trim().toLowerCase();
    if (v && !values.includes(v)) onChange([...values, v]);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel hint={hint}>
        <label htmlFor={fid}>{label}</label>
      </SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <button key={v} type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${label.toLowerCase()} ${v}`} className="flex cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line bg-acc px-2 py-1 text-xs font-extrabold text-onc">
            {v} <span aria-hidden>✕</span>
          </button>
        ))}
        {suggestions
          .filter((s) => !values.includes(s))
          .map((s) => (
            <ToggleChip key={s} pressed={false} onClick={() => add(s)} className="min-h-0 px-2 py-1 text-xs">
              + {s}
            </ToggleChip>
          ))}
      </div>
      <Input
        id={fid}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(text);
          }
        }}
        onBlur={() => text && add(text)}
        placeholder={`Add ${label.toLowerCase()} and press Enter`}
        className="py-2 shadow-hard-sm"
      />
    </div>
  );
}

function measureOptions(i: IngredientEntry | undefined, current: string): string[] {
  const kinds = i ? enterableMeasures(i) : (["weight", "volume", "count"] as const);
  const opts: string[] = [];
  for (const k of kinds) opts.push(...UNITS_BY_MEASURE[k]);
  for (const v of ["to taste", "pinch"]) opts.push(v);
  if (current && !opts.includes(current)) opts.unshift(current);
  return opts;
}

function IngredientLine({
  index,
  control,
  register,
  ingredients,
  byId,
  uid,
  onRemove,
  setValue,
  error,
}: {
  index: number;
  control: Control<FormInput>;
  register: UseFormRegister<FormInput>;
  ingredients: readonly IngredientEntry[];
  byId: Map<string, IngredientEntry>;
  uid: string;
  onRemove: () => void;
  setValue: UseFormSetValue<FormInput>;
  error?: string | undefined;
}) {
  const v = useWatch({ control, name: `ingredients.${index}` });
  const ing = byId.get(v?.ingredientId ?? "");
  const opts = measureOptions(ing, v?.measure ?? "");
  const allowedNow = ing ? measureOptions(ing, "") : opts;
  const mismatch = !!ing && !!v?.measure && !allowedNow.includes(v.measure);
  const set = (k: "ingredientId" | "displayText" | "measure", value: string) => setValue(`ingredients.${index}.${k}`, value, { shouldDirty: true, shouldValidate: k === "ingredientId" });
  return (
    <li className="flex flex-col gap-2 rounded-ui border-2 border-line bg-pg p-2.5">
      <div className="flex items-start gap-2">
        <span className="grid size-7 flex-none place-items-center pt-2 font-mono text-xs font-extrabold">{index + 1}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <IngredientPicker
            ingredients={ingredients}
            value={ing}
            uid={uid}
            label={`Ingredient ${index + 1}`}
            autoFocus={!v?.ingredientId}
            onPick={(i, typed) => {
              const allowed = measureOptions(i, "");
              set("ingredientId", i.id);
              if (!v?.displayText) set("displayText", typed.trim() || i.name);
              if (!v?.measure || !allowed.includes(v.measure)) set("measure", allowed[0] ?? "g");
            }}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <Input {...register(`ingredients.${index}.amount`)} inputMode="decimal" placeholder="Amount" aria-label={`Amount for ingredient ${index + 1}`} className="py-2 shadow-none" />
            <Select value={v?.measure ?? ""} onChange={(e) => set("measure", e.target.value)} aria-label={`Unit for ingredient ${index + 1}`} className="py-2 shadow-none">
              {opts.map((u) => (
                <option key={u} value={u}>
                  {u === "count" ? "pieces" : UNITS[u] ? unitLabel(u, 2) || u : u}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input {...register(`ingredients.${index}.displayText`)} aria-label={`Wording for ingredient ${index + 1}`} placeholder="Wording in the recipe (e.g. fresh basil)" className="min-w-0 flex-1 py-1.5 text-xs shadow-none" />
            <label className="flex items-center gap-1.5 text-xs font-bold">
              <input type="checkbox" {...register(`ingredients.${index}.optional`)} className="size-4 accent-[var(--ink)]" /> Optional
            </label>
          </div>
          {mismatch ? <span className="text-xs font-bold">This ingredient doesn&apos;t convert from “{v?.measure}” yet. Pick another unit or add the conversion to the ingredient.</span> : null}
          {ing?.needsReview ? (
            <span className="text-xs font-bold text-sub">
              {ing.name} needs review (missing conversions or protein).{" "}
              <Link to="/ingredients/$id" params={{ id: ing.id }} className="text-ink underline">
                Edit ingredient
              </Link>
            </span>
          ) : null}
          {error ? (
            <span role="alert" className="text-xs font-bold">
              {error}
            </span>
          ) : null}
        </div>
        <IconBtn label={`Remove ingredient ${index + 1}`} onClick={onRemove}>
          <Trash2 aria-hidden className="size-3.5" />
        </IconBtn>
      </div>
    </li>
  );
}
