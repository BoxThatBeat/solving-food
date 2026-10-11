// Recipe detail (PRD R4.8, R4.11, R4.13, R4.14, R4.21, R4.26, R6.15; spec §12). Renders for signed-out
// visitors too (share links): then only the global recipe shows, without notes, favourites, supply badges, stats, or
// edit controls.
import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { doc } from "firebase/firestore";
import { ArrowLeft, X } from "lucide-react";
import {
  unexpiredByIngredient,
  formatProtein,
  lineText,
  renderStep,
  scaleFactor,
  taxonomyLabel,
  type DirectoryDoc,
  type HouseholdDoc,
  type RecipeVersionDoc,
  fahrenheitOnly,
  missingTools,
  toolLabel,
} from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc } from "@/data/live";
import { restoreRecipe, restoreVersion, trashRecipe, useVersions, type StoredRecipe } from "@/data/recipes";
import { lookupFromMap, useIngredientsById, type IngredientEntry } from "@/data/ingredients";
import { saveNote, setFavourite, useHouseholdFacts, useNote } from "@/data/householdRecipes";
import { useNotify } from "@/components/notifications-context";
import { Badge, SectionLabel, Textarea } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { RecipeImage } from "./RecipeImage";
import { useCreateMeal } from "@/components/plan/plan-sheet-context";
import { useSupply } from "@/data/supply";
import { SupplyBadge } from "./SupplyBadge";

const DAY = 86_400_000;
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }); // "21 Sep", as the prototype
const DATE_TIME = new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export interface DetailContext {
  uid: string;
  hid: string;
  household: HouseholdDoc | null | undefined;
}

function useDisplayName(uid: string | undefined, enabled: boolean): string | null {
  const d = useLiveDoc<DirectoryDoc>(uid && enabled ? doc(db, "directory", uid) : null, uid && enabled ? `directory/${uid}` : null);
  return d.data?.displayName ?? null;
}

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === "function" ? t.toMillis() : null;
}

export function RecipeDetail({
  id,
  recipe,
  ctx,
  onClose,
  closeLabel,
  pane,
}: {
  id: string;
  recipe: StoredRecipe;
  /** Signed in with a household; null for a signed-out visitor. */
  ctx: DetailContext | null;
  /** Absent for signed-out visitors (there's no list to go back to). */
  onClose?: () => void;
  closeLabel?: "Back" | "Close";
  /** Rendered as the right-hand pane next to the list. */
  pane?: boolean;
}) {
  const notify = useNotify();
  const navigate = useNavigate();
  const ingredients = useIngredientsById(recipe.ingredientIds);
  const lookup = lookupFromMap(ingredients);
  const [servings, setServings] = React.useState(recipe.servings);
  const [seen, setSeen] = React.useState(`${id}:${recipe.servings}`);
  if (seen !== `${id}:${recipe.servings}`) {
    setSeen(`${id}:${recipe.servings}`);
    setServings(recipe.servings);
  }
  const [now] = React.useState(() => Date.now());
  const factor = scaleFactor(recipe, servings);
  const factsOf = useHouseholdFacts(ctx?.hid ?? null);
  const facts = factsOf(id);
  const editor = useDisplayName(recipe.updatedBy, !!ctx);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const openCreateMeal = useCreateMeal();
  // Unexpired supply per ingredient for the badges (R4.9; expired lots don't count, R8.15). Signed in only.
  const supply = useSupply(ctx?.hid ?? null, ctx?.household?.timezone ?? "America/Toronto");
  const have = React.useMemo(() => (ctx ? unexpiredByIngredient(supply.items.values(), supply.now) : null), [ctx, supply.items, supply.now]);

  const copyLink = async () => {
    const url = `${location.origin}/recipes/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify({ kind: "success", message: "Link copied · opens without an account" });
    } catch {
      notify({ kind: "info", message: `Copy this link: ${url}` });
    }
  };

  const toggleFav = () => {
    if (!ctx) return;
    setFavourite(ctx.hid, id, !facts.favourite).catch(() => notify({ kind: "error", message: "Couldn't update the favourite" }));
  };

  const doTrash = async () => {
    if (!ctx) return;
    setBusy(true);
    try {
      await trashRecipe(id, ctx.uid, lookup);
      setConfirmDelete(false);
      notify({ kind: "success", message: `"${recipe.title}" moved to Trash for 30 days`, link: { to: "/recipes/trash", label: "Trash" } });
      void navigate({ to: "/recipes" });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't delete: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!ctx) return;
    try {
      await restoreRecipe(id, ctx.uid, lookup);
      notify({ kind: "success", message: `"${recipe.title}" restored` });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't restore: ${(e as Error).message}` });
    }
  };

  const tools = ctx?.household?.settings?.tools ?? [];
  const toolsConfigured = tools.length > 0;
  // Compared by toolKey (M7): owning "skillet" covers "frying pan". Names show lower-case.
  const missing = toolsConfigured ? missingTools(recipe.tools, tools) : [];
  const meals = recipe.tags.filter((t) => ["breakfast", "lunch", "dinner", "snack"].includes(t));
  const otherTags = recipe.tags.filter((t) => !meals.includes(t));
  const trashedAt = millis(recipe.trashedAt);
  const daysLeft = trashedAt ? Math.max(0, 30 - Math.floor((now - trashedAt) / DAY)) : null;
  const updated = millis(recipe.updatedAt);
  const total = recipe.prepMin + recipe.cookMin;
  const sectionHeaders = recipe.steps.map((s, i) => (s.section && s.section !== recipe.steps[i - 1]?.section ? s.section : null));

  return (
    <article className={cn("flex flex-col bg-pg", pane && "min-h-full")} aria-labelledby="recipe-title">
      <div className={cn("flex items-center justify-between gap-2 px-4 pb-3", pane ? "pt-4" : "pt-1.5 md:pt-4")}>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex cursor-pointer items-center gap-1 rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold text-ink shadow-[3px_3px_0_var(--line)]"
          >
            {closeLabel === "Close" ? <X aria-hidden className="size-4" strokeWidth={3} /> : <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />}
            {closeLabel ?? "Back"}
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap justify-end gap-1.5">
          {ctx ? (
            <button
              type="button"
              aria-pressed={facts.favourite}
              onClick={toggleFav}
              className={cn(
                "cursor-pointer rounded-ui border-2 border-line px-2.5 py-2 text-[0.8125rem] font-extrabold shadow-[3px_3px_0_var(--line)]",
                facts.favourite ? "bg-yellow text-onc" : "bg-base text-ink",
              )}
            >
              {facts.favourite ? "★ Saved" : "☆ Save"}
            </button>
          ) : null}
          <button type="button" onClick={copyLink} className="cursor-pointer rounded-ui border-2 border-line bg-base px-2.5 py-2 text-[0.8125rem] font-extrabold text-ink shadow-[3px_3px_0_var(--line)]">
            Copy link
          </button>
          {ctx && openCreateMeal && recipe.status === "active" ? (
            <button
              type="button"
              onClick={() => openCreateMeal({ recipeIds: [id], ...(recipe.tags.includes("breakfast") ? { mealType: "breakfast" as const } : recipe.tags.includes("lunch") && !recipe.tags.includes("dinner") ? { mealType: "lunch" as const } : {}) })}
              className="cursor-pointer rounded-ui border-2 border-line bg-acc px-2.5 py-2 text-[0.8125rem] font-extrabold text-onc shadow-[3px_3px_0_var(--line)]"
            >
              + Plan
            </button>
          ) : null}
          {ctx && recipe.status !== "pendingDuplicateReview" ? (
            <Link
              to="/recipes/$id/cook"
              params={{ id }}
              search={{ servings } as never}
              className="rounded-ui border-2 border-line bg-base px-2.5 py-2 text-[0.8125rem] font-extrabold text-ink no-underline shadow-[3px_3px_0_var(--line)]"
            >
              Cook →
            </Link>
          ) : null}
        </div>
      </div>

      {recipe.status === "trashed" ? (
        <div role="status" className="mx-4 mb-3 flex flex-wrap items-center gap-2.5 rounded-ui border-bw bg-red p-3 text-onc">
          <span className="flex-1 text-sm font-extrabold">
            Recipe in Trash · deleted for everyone{daysLeft !== null ? ` · purged in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : ""}
          </span>
          {ctx ? (
            <Button size="sm" variant="secondary" onClick={doRestore}>
              Restore
            </Button>
          ) : null}
        </div>
      ) : null}
      {recipe.status === "pendingDuplicateReview" ? (
        <div role="status" className="mx-4 mb-3 rounded-ui border-2 border-dashed border-line bg-base p-3 text-sm font-bold">
          This import looks like a duplicate and is waiting for review.{" "}
          {ctx ? (
            <Link to="/recipes" search={{ review: 1 } as never} className="underline">
              Review it
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="relative mx-4 h-[12.5rem] flex-none overflow-visible rounded-ui border-bw shadow-hard md:h-[15rem] xl:h-[18rem]">
        <div className="size-full overflow-hidden rounded-[calc(var(--r)-var(--bw))]">
          <RecipeImage base={recipe.imagePaths[0]} cuisine={recipe.cuisine} alt={recipe.title} sizes={pane ? "36rem" : "(min-width: 1024px) 60rem, 100vw"} eager />
        </div>
        <span className="absolute -top-2.5 right-3.5 rotate-3 rounded-ui border-2 border-line bg-acc px-2 py-1 font-display text-[0.8125rem] text-onc uppercase">
          {taxonomyLabel(recipe.cuisine)}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        <h1 id="recipe-title" className="m-0 font-display text-[1.875rem] leading-none font-normal text-pretty">
          {recipe.title}
        </h1>
        <div className="-mt-1.5 flex flex-wrap gap-[0.3125rem]" aria-label="Tags">
          {/* The prototype's blue with dark text is 3.6:1; lightened toward white it passes AA in every flavour (dark text on it). */}
          <Badge className="rounded-[3px] border-[1.5px] bg-[color-mix(in_srgb,var(--blue)_55%,white)] text-[#4c4f69] uppercase">{taxonomyLabel(recipe.mainProtein)}</Badge>
          {meals.map((t) => (
            <Badge key={t} className="rounded-[3px] border-[1.5px] bg-s0 text-ink uppercase">
              {t}
            </Badge>
          ))}
          {otherTags.map((t) => (
            <Badge key={t} className="rounded-[3px] border-[1.5px] bg-base text-ink uppercase">
              {t}
            </Badge>
          ))}
        </div>

        <dl className="m-0 grid grid-cols-4 gap-2">
          {[
            ["Total", `${total}′`],
            ["Active", `${recipe.prepMin}′`],
            ["Cook", `${recipe.cookMin}′`],
            ["Protein", formatProtein(recipe.proteinPerServingG, recipe.proteinApproximate)],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col-reverse gap-[0.1875rem] rounded-ui border-2 border-line bg-base px-1 pt-[0.5625rem] pb-[0.4375rem] text-center">
              <dt className="font-mono text-[0.5625rem] font-bold tracking-[0.03rem] text-sub uppercase">{k === "Protein" ? "Protein / serv" : k}</dt>
              <dd className="m-0 font-mono text-[1rem] font-extrabold" data-testid={`meta-${k!.toLowerCase()}`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {recipe.proteinApproximate ? (
          <p className="-mt-2 m-0 font-mono text-[0.625rem] font-semibold text-sub">~ Some ingredients have no protein data yet, so this is approximate.</p>
        ) : null}

        <div className="flex items-center gap-2.5 rounded-ui border-2 border-line bg-base px-2.5 py-2">
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]" id="servings-label">
              SERVINGS
            </span>
            <span className="text-[0.6875rem] font-semibold text-sub" aria-live="polite">
              {factor === 1 ? "As written" : `Scaled ×${Math.round(factor * 100) / 100} · amounts update`}
            </span>
          </span>
          <div role="group" aria-labelledby="servings-label" className="flex overflow-hidden rounded-ui border-2 border-line">
            <button
              type="button"
              aria-label="Fewer servings"
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              className="h-10 w-11 cursor-pointer border-0 bg-pg text-lg font-extrabold text-ink"
            >
              −
            </button>
            <output className="flex min-w-11 items-center justify-center border-x-2 border-line font-mono text-[1rem] font-extrabold" aria-label="Servings">
              {servings}
            </output>
            <button type="button" aria-label="More servings" onClick={() => setServings((s) => Math.min(100, s + 1))} className="h-10 w-11 cursor-pointer border-0 bg-pg text-lg font-extrabold text-ink">
              +
            </button>
          </div>
        </div>

        {ctx ? (
          <div className="flex items-center gap-3 rounded-ui border-2 border-dashed border-line bg-base px-3 py-2.5">
            <span className="font-display text-[1.875rem] leading-none text-acc [-webkit-text-stroke:1px_var(--line)]">{facts.timesCooked}×</span>
            <span className="flex flex-col gap-[0.1875rem]">
              <span className="text-sm leading-snug font-bold">
                {facts.timesCooked
                  ? `You've made this ${facts.timesCooked} time${facts.timesCooked === 1 ? "" : "s"}${facts.lastCookedAtMs ? ` · last ${DATE.format(new Date(facts.lastCookedAtMs))}` : ""}`
                  : "Never cooked in this household"}
              </span>
              <span className="font-mono text-[0.65625rem] font-semibold text-sub">{facts.rating ? `HOUSEHOLD ${facts.rating.toFixed(1)}` : "NO RATINGS YET"}</span>
            </span>
          </div>
        ) : null}

        {recipe.tools.length ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">TOOLS</span>
              {recipe.tools.map((t) => {
                const lacks = missing.includes(t);
                return (
                  <span key={t} className={cn("rounded-ui border-2 border-line px-2 py-1 text-xs font-extrabold", lacks ? "bg-red text-onc" : "bg-base text-ink")}>
                    {toolsConfigured ? (lacks ? "✕ " : "✓ ") : ""}
                    {toolLabel(t)}
                  </span>
                );
              })}
            </div>
            {missing.length ? (
              <div role="alert" className="rounded-ui border-bw bg-red px-3.5 py-3 text-sm leading-snug font-extrabold text-onc">
                Needs {missing.map(toolLabel).join(" and ")}. {missing.length === 1 ? "It's" : "They're"} not in your kitchen tools.
              </div>
            ) : ctx ? (
              <p className="m-0 font-mono text-[0.625rem] font-semibold text-sub">
                {toolsConfigured ? "Your kitchen has everything this needs." : "No kitchen tools configured for this household yet, so missing tools can't be flagged."}
              </p>
            ) : null}
          </div>
        ) : null}

        <IngredientsTable recipe={recipe} ingredients={ingredients} factor={factor} servings={servings} signedIn={!!ctx} have={have} />

        {recipe.prepTasks.length ? (
          <section aria-labelledby="prep-h" className="flex flex-col gap-2">
            <h2 id="prep-h" className="m-0 mt-1.5 font-display text-[1.3125rem] font-normal">
              Before you start
            </h2>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {recipe.prepTasks.map((p, i) => (
                <li key={i} className="flex gap-2 text-[0.9375rem] leading-snug font-semibold">
                  <span aria-hidden className="mt-0.5 size-4 flex-none rounded-[3px] border-2 border-line bg-base" />
                  <span>{renderStep(p.text, recipe.ingredients, lookup, factor).map((s) => (s.kind === "text" ? s.text : s.name)).join("")}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="steps-h" className="flex flex-col gap-3">
          <h2 id="steps-h" className="m-0 mt-1.5 font-display text-[1.3125rem] font-normal">
            Steps
          </h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {recipe.steps.map((s, i) => {
              const header = sectionHeaders[i];
              return (
                <li key={i} className="flex flex-col gap-2">
                  {header ? <h3 className="m-0 mt-1 font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">{header}</h3> : null}
                  <div className="flex gap-3">
                    <span aria-hidden className="box-border grid size-[1.875rem] flex-none place-items-center rounded-ui border-2 border-line bg-acc font-mono text-sm font-extrabold text-onc">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-col gap-[0.3125rem] pt-1">
                      <p className="m-0 text-[0.9375rem] leading-[1.55] font-semibold text-pretty">
                        <span className="sr-only">Step {i + 1}: </span>
                        {renderStep(s.text, recipe.ingredients, lookup, factor).map((seg, k) =>
                          seg.kind === "text" ? (
                            <React.Fragment key={k}>{seg.text}</React.Fragment>
                          ) : (
                            <React.Fragment key={k}>
                              {seg.name}
                              {seg.amount ? (
                                <span className="mx-px ml-1 inline-block rounded border-[1.5px] border-line bg-mantle px-1 font-mono text-[0.8em] leading-[1.4] font-extrabold whitespace-nowrap text-ink">
                                  {seg.amount}
                                </span>
                              ) : null}
                            </React.Fragment>
                          ),
                        )}
                      </p>
                      {s.timerSeconds ? (
                        <span className="self-start rounded-[3px] border-[1.5px] border-line px-[0.3125rem] py-px font-mono text-[0.625rem] font-bold">
                          ⏱ {timerLabel(s.timerSeconds)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {recipe.notes ? (
          <div className="flex flex-col gap-1.5 rounded-ui border-2 border-line bg-base p-3">
            <SectionLabel>Recipe notes</SectionLabel>
            <p className="m-0 text-sm leading-[1.45] font-semibold whitespace-pre-line">{fahrenheitOnly(recipe.notes)}</p>
          </div>
        ) : null}

        {ctx ? <HouseholdNotes hid={ctx.hid} uid={ctx.uid} recipeId={id} /> : null}

        <div className="flex flex-col gap-1.5 font-mono text-[0.65625rem] leading-normal font-semibold text-sub">
          {recipe.sourceUrl ? (
            <span>
              SOURCE ·{" "}
              <a href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-ink">
                {recipe.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} ↗
              </a>
            </span>
          ) : null}
          <span className="uppercase">
            SHARED LIBRARY · V{recipe.version}
            {editor ? ` · EDITED BY ${editor}` : ""}
            {updated ? ` · ${DATE.format(new Date(updated))}` : ""}
          </span>
          {ctx ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="button" onClick={() => setHistoryOpen(true)} className={FOOTER_ACTION}>
                Version history
              </button>
              {recipe.status !== "trashed" ? (
                <>
                  <Link to="/recipes/$id/edit" params={{ id }} className={FOOTER_ACTION}>
                    Edit
                  </Link>
                  <button type="button" onClick={() => setConfirmDelete(true)} className={FOOTER_ACTION}>
                    Delete
                  </button>
                </>
              ) : null}
            </span>
          ) : null}
          {!ctx ? (
            <span className="normal-case">
              Shared from Solving Food. <Link to="/sign-in" className="font-extrabold text-ink">Sign in</Link> to save it, add notes, or plan it.
            </span>
          ) : null}
        </div>
      </div>

      {ctx ? (
        <>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete for everyone?"
            confirmLabel="Move to Trash"
            destructive
            busy={busy}
            onConfirm={doTrash}
          >
            This removes the recipe for everyone, in every household. It stays in Trash for 30 days.
          </ConfirmDialog>
          <VersionHistory open={historyOpen} onOpenChange={setHistoryOpen} id={id} current={recipe} uid={ctx.uid} lookup={lookup} />
        </>
      ) : null}
    </article>
  );
}

/** The text actions under the recipe (Version history · Edit · Delete): underlined links, 24 px tall hit targets. */
const FOOTER_ACTION = "inline-flex min-h-6 cursor-pointer items-center bg-transparent p-0 font-sans text-[0.8125rem] font-extrabold text-ink normal-case underline";

function timerLabel(s: number): string {
  if (s < 60) return `${s} SEC`;
  if (s % 3600 === 0) return `${s / 3600} HR`;
  if (s > 3600) return `${Math.floor(s / 3600)} HR ${Math.round((s % 3600) / 60)} MIN`;
  return `${Math.round(s / 60)} MIN`;
}

function IngredientsTable({
  recipe,
  ingredients,
  factor,
  servings,
  signedIn,
  have,
}: {
  recipe: StoredRecipe;
  ingredients: Map<string, IngredientEntry>;
  factor: number;
  servings: number;
  signedIn: boolean;
  /** Unexpired supply per ingredient; null while signed out. */
  have: ReadonlyMap<string, number> | null;
}) {
  const lookup = lookupFromMap(ingredients);
  return (
    <section aria-labelledby="ing-h" className="flex flex-col gap-2.5">
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <h2 id="ing-h" className="m-0 font-display text-[1.3125rem] font-normal">
          Ingredients
        </h2>
        <span className="font-mono text-[0.65625rem] font-bold">
          {recipe.ingredients.length} INGREDIENTS · {servings} SERVINGS
        </span>
      </div>
      <div className="overflow-hidden rounded-ui border-bw bg-base shadow-hard">
        <div className="flex justify-between bg-ink px-3 py-[0.4375rem] font-mono text-[0.625rem] font-bold tracking-[0.06rem] text-base" aria-hidden>
          <span>INGREDIENT</span>
          <span>{signedIn ? "NEED · IN SUPPLY" : "AMOUNT"}</span>
        </div>
        <ul className="m-0 list-none p-0">
          {recipe.ingredients.map((l, k) => {
            const ing = ingredients.get(l.ingredientId);
            const t = lineText(l, lookup, factor);
            const hint = [l.optional ? "OPTIONAL" : "", ing?.freeUse ? "STAPLE" : "", ing ? ing.defaultLocation.toUpperCase() : "", signedIn && ing?.needsReview ? "NEEDS REVIEW" : ""].filter(Boolean).join(" · ");
            return (
              <li key={l.id} className={cn("flex items-center gap-2.5 px-3 py-2.5", k && "border-t-2 border-line")}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[0.9375rem] font-bold first-letter:uppercase">{t.name}</span>
                  {hint ? (
                    <span className="font-mono text-[0.65625rem] font-semibold text-sub">
                      {signedIn && ing?.needsReview ? (
                        <Link to="/ingredients/$id" params={{ id: l.ingredientId }} className="text-sub">
                          {hint}
                        </Link>
                      ) : (
                        hint
                      )}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-[55%] flex-none text-right font-mono text-[0.8125rem] font-extrabold" data-testid="ingredient-amount">
                  {t.amount || "—"}
                </span>
                {signedIn && have ? <SupplyBadge need={l.optional ? 0 : l.canonicalAmount * factor} have={have.get(l.ingredientId) ?? 0} ingredient={ing} name={t.name} /> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function HouseholdNotes({ hid, uid, recipeId }: { hid: string; uid: string; recipeId: string }) {
  const note = useNote(hid, recipeId);
  const notify = useNotify();
  const [text, setText] = React.useState<string | null>(null);
  const current = note.data?.text ?? "";
  const value = text ?? current;
  const dirty = text !== null && text !== current;
  const save = async () => {
    try {
      await saveNote(hid, recipeId, value, uid);
      setText(null);
      notify({ kind: "success", message: "Household note saved" });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't save the note: ${(e as Error).message}` });
    }
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-ui border-2 border-line bg-base p-3">
      <label htmlFor="household-note" className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">
        HOUSEHOLD NOTES
      </label>
      <Textarea
        id="household-note"
        rows={3}
        value={value}
        onChange={(e) => setText(e.target.value)}
        placeholder="Only your household sees these. e.g. Double the glaze."
        className="text-sm shadow-none"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" disabled={!dirty} onClick={save}>
          Save note
        </Button>
      </div>
    </div>
  );
}

function VersionHistory({
  open,
  onOpenChange,
  id,
  current,
  uid,
  lookup,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  id: string;
  current: StoredRecipe;
  uid: string;
  lookup: ReturnType<typeof lookupFromMap>;
}) {
  const versions = useVersions(id, open);
  const notify = useNotify();
  const list = [...(versions.docs ?? [])].sort((a, b) => Number(b.id) - Number(a.id));
  const restore = async (v: RecipeVersionDoc, n: string) => {
    try {
      const next = await restoreVersion(id, v, uid, lookup);
      notify({ kind: "success", message: `Restored v${n} as v${next} for everyone` });
      onOpenChange(false);
    } catch (e) {
      notify({ kind: "error", message: `Couldn't restore: ${(e as Error).message}` });
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Version history" description="Every save is a version; restoring saves the old one as a new version">
        {versions.docs === undefined ? <p className="m-0 text-sm font-semibold">Loading…</p> : null}
        {versions.docs !== undefined && !versions.confirmed ? (
          <p className="m-0 text-sm font-semibold text-sub" role="status">
            Checking for older versions…
          </p>
        ) : null}
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {list.map((v) => {
            const at = millis(v.data.editedAt);
            const isCurrent = Number(v.id) === current.version;
            return (
              <li key={v.id} className="flex items-center gap-2.5 rounded-ui border-2 border-line bg-base p-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[0.9375rem] font-extrabold">
                    v{v.id} · {v.data.title}
                  </span>
                  <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                    {at ? DATE_TIME.format(new Date(at)) : ""} · {v.data.status === "trashed" ? "moved to trash" : `${v.data.ingredients?.length ?? 0} ingredients · ${v.data.steps?.length ?? 0} steps`}
                  </span>
                </span>
                {isCurrent ? (
                  <Badge className="bg-acc text-onc">CURRENT</Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => restore(v.data, v.id)} aria-label={`Restore version ${v.id}`}>
                    Restore
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
