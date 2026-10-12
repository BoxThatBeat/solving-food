// "Merge into…" (PRD R4.27, R8.16; Planning/M8 item 2): pick the ingredient a duplicate means (the matcher's
// suggestions first, or any ingredient through the picker), see what will move (a dry run of the mergeIngredient
// function), confirm. The function moves recipes, Supply, plan and grocery lines and teaches the target the duplicate's
// names; Supply is never written here.
import * as React from "react";
import type { IngredientIndex, MergeReport } from "@solving-food/core";
import { describeMerge, useSuggestions } from "./merge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SectionLabel, ToggleChip } from "@/components/ui/chip";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useNotify } from "@/components/notifications-context";
import { mergeIngredient, type IngredientEntry } from "@/data/ingredients";
import { useOnline } from "@/hooks/useOnline";
import { useReadySession } from "@/session/useSession";

export function MergeSheet({
  open,
  onOpenChange,
  from,
  all,
  byId,
  index,
  initialTarget,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: IngredientEntry;
  /** Pickable ingredients (merged ones already left out). */
  all: readonly IngredientEntry[];
  byId: ReadonlyMap<string, IngredientEntry>;
  index: IngredientIndex;
  initialTarget?: string | undefined;
  onMerged?: (r: MergeReport) => void;
}) {
  const s = useReadySession();
  const notify = useNotify();
  const online = useOnline();
  const suggestions = useSuggestions(from, index);
  const [target, setTarget] = React.useState<string | undefined>(initialTarget);
  const [preview, setPreview] = React.useState<{ id: string; report?: MergeReport; error?: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Opening with a suggestion pre-picks it; reopening starts over.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTarget(initialTarget);
      setPreview(null);
    }
  }

  // What would move: a dry run of the function, once per picked target.
  React.useEffect(() => {
    if (!open || !target || !online) return;
    let live = true;
    mergeIngredient(from.id, target, true).then(
      (report) => live && setPreview({ id: target, report }),
      (e: Error) => live && setPreview({ id: target, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [open, target, from.id, online]);

  const into = target ? byId.get(target) : undefined;
  const shown = preview && preview.id === target ? preview : null;

  const run = async () => {
    if (!into) return;
    setBusy(true);
    try {
      const r = await mergeIngredient(from.id, into.id);
      notify({ kind: "success", message: `Merged “${from.name}” into “${into.name}”: ${describeMerge(r)} moved.`, link: { to: `/ingredients/${into.id}`, label: "Open" } });
      onOpenChange(false);
      onMerged?.(r);
    } catch (e) {
      notify({ kind: "error", message: `Couldn’t merge: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={`Merge “${from.name}”`}
        description="Pick the ingredient this one means; its recipes, Supply and grocery lines move there"
        footer={
          <Button className="w-full" disabled={!into || !shown?.report || busy || !online} onClick={run}>
            {busy ? "Merging…" : into ? `Merge into ${into.name}` : "Pick an ingredient"}
          </Button>
        }
      >
        <p className="m-0 text-sm leading-normal font-semibold">
          Everything that uses <strong>{from.name}</strong> moves to the ingredient you pick, in every household: recipe lines, Supply, planned sides and
          grocery lines. <strong>{from.name}</strong> becomes one of its names, so the next import with that wording matches it.
        </p>
        {suggestions.length ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Looks like</SectionLabel>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested ingredients">
              {suggestions.map((sug) => {
                const i = byId.get(sug.id);
                if (!i) return null;
                return (
                  <ToggleChip key={sug.id} pressed={target === sug.id} onClick={() => setTarget(sug.id)}>
                    {i.name}
                    {i.needsReview ? <span className="font-mono text-[0.625rem] font-bold">NEW</span> : null}
                  </ToggleChip>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <SectionLabel>Or search</SectionLabel>
          <IngredientPicker
            ingredients={all}
            value={into}
            onPick={(i) => setTarget(i.id)}
            uid={s.user.uid}
            label="Merge into"
            allowCreate={false}
            exclude={[from.id]}
            placeholder="Search ingredients…"
          />
        </div>
        <div role="status" aria-live="polite" className="min-h-[1.5rem] text-sm font-bold">
          {!online ? (
            "You're offline. Merging needs a connection."
          ) : !into ? null : !shown ? (
            "Checking what moves…"
          ) : shown.error ? (
            <span className="block rounded-ui border-2 border-line bg-red p-2.5 text-onc">{shown.error}</span>
          ) : (
            <span className="block rounded-ui border-2 border-line bg-base p-2.5" data-testid="merge-preview">
              Moves {describeMerge(shown.report!)} to <strong>{into.name}</strong>.
              {shown.report!.aliasesAdded.length ? ` Adds ${shown.report!.aliasesAdded.map((a) => `“${a}”`).join(", ")} to its names.` : ""}
            </span>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
