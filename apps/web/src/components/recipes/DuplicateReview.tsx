// Duplicate review (TECHNICAL_SPECS §9 "Deduplication", PRD R4.20): drop imports that look like an existing recipe
// wait here. Side-by-side compare, then Keep existing (discard the import), Keep new (the import becomes the next
// version of the existing recipe, then is discarded), or Keep both.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { describeMatch, findDuplicates, formatProtein, taxonomyLabel, type RecipeDoc } from "@solving-food/core";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/chip";
import { EmptyState } from "@/components/AppShell";
import { useNotify } from "@/components/notifications-context";
import { keepBoth, keepExisting, keepNew, useRecipe, useRecipesWithStatus, type StoredRecipe } from "@/data/recipes";
import { lookupFromMap, useAllIngredients } from "@/data/ingredients";
import { useReadySession } from "@/session/useSession";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Side({ label, r }: { label: string; r: RecipeDoc | null | undefined }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-ui border-2 border-line bg-pg p-2.5">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.06rem] uppercase">{label}</span>
      {r ? (
        <>
          <span className="text-[0.9375rem] leading-tight font-extrabold">{r.title}</span>
          <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
            {r.prepMin + r.cookMin} min · serves {r.servings} · {taxonomyLabel(r.cuisine)} · {formatProtein(r.proteinPerServingG, r.proteinApproximate)} protein
          </span>
          <ul className="m-0 list-disc pl-4 text-xs leading-snug font-semibold">
            {r.ingredients.map((l) => (
              <li key={l.id}>{l.displayText}</li>
            ))}
          </ul>
          <span className="text-xs font-semibold text-sub">
            {r.steps.length} steps{r.sourceUrl ? ` · ${new URL(r.sourceUrl).hostname.replace(/^www\./, "")}` : ""}
          </span>
        </>
      ) : (
        <span className="text-xs font-semibold text-sub">{r === null ? "No longer exists" : "Loading…"}</span>
      )}
    </div>
  );
}

function PendingItem({ id, recipe }: { id: string; recipe: StoredRecipe }) {
  const s = useReadySession();
  const notify = useNotify();
  const live = useRecipe(recipe.possibleDuplicateOf ?? null);
  // No recorded match (or it's been deleted): show "gone" rather than loading forever.
  const existing = recipe.possibleDuplicateOf ? live : { ...live, data: null };
  const ing = useAllIngredients();
  const [busy, setBusy] = React.useState(false);
  const lookup = lookupFromMap(ing.byId);
  const match = existing.data
    ? findDuplicates(recipe, [{ ...existing.data, id: recipe.possibleDuplicateOf! }])[0]
    : undefined;
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      notify({ kind: "success", message: done });
    } catch (e) {
      notify({ kind: "error", message: `${what} failed: ${(e as Error).message}` });
      setBusy(false);
    }
  };
  const created = recipe.createdAt?.toMillis ? DATE.format(new Date(recipe.createdAt.toMillis())).toUpperCase() : "";
  return (
    <article className="flex flex-col gap-2.5 rounded-ui border-bw bg-base p-3.5 shadow-hard" aria-label={`Possible duplicate: ${recipe.title}`}>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-[1.0625rem] font-extrabold">{recipe.title}</h3>
        <span className="font-mono text-[0.625rem] font-semibold uppercase">Dropped {created}</span>
        <span className="text-[0.8125rem] font-bold">{match ? describeMatch(match) : existing.data ? `Flagged as similar to ${existing.data.title}.` : existing.data === null ? "The recipe it matched is gone." : "Checking…"}</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Side label="New (import)" r={recipe} />
        <Side label="Existing" r={existing.data} />
      </div>
      {existing.data ? (
        <Link to="/recipes/$id" params={{ id: recipe.possibleDuplicateOf! }} className="self-start text-xs font-extrabold text-ink underline">
          Open the existing recipe
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => run("Keep existing", () => keepExisting(id), "Import discarded")}>
          Keep existing
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !existing.data}
          onClick={() => run("Keep new", () => keepNew(recipe, id, recipe.possibleDuplicateOf!, s.user.uid, lookup), "Import saved as a new version of the existing recipe")}
        >
          Keep new
        </Button>
        <Button size="sm" disabled={busy} onClick={() => run("Keep both", () => keepBoth(id, s.user.uid, lookup), "Both kept")}>
          Keep both
        </Button>
      </div>
    </article>
  );
}

export function DuplicateReviewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pending = useRecipesWithStatus("pendingDuplicateReview", open);
  const list = pending.docs ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Needs review" description="Drop-folder imports that look like recipes already in the library">
        <SectionLabel hint={pending.docs ? String(list.length) : ""}>Waiting for a decision</SectionLabel>
        {pending.docs && list.length === 0 ? <EmptyState>Nothing to review.</EmptyState> : null}
        {list.map((d) => (
          <PendingItem key={d.id} id={d.id} recipe={d.data} />
        ))}
      </SheetContent>
    </Sheet>
  );
}
