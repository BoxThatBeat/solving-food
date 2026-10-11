// The Plan page's Suggested section (PRD R6.11, R6.12, R6.16; TECHNICAL_SPECS §7): the best-scoring recipes not yet
// planned, each with its score, time · protein · what it adds to the order, and "why" chips (the top two raising
// factors and the strongest lowering one), one tap from Create meal. The header links to the weights (prototype:
// "WEIGHTS: BALANCED").
import { Link } from "@tanstack/react-router";
import { formatCents, formatProtein, presetOf, resolveWeights, type Reason, type RecipeSummary, type ScoreResult } from "@solving-food/core";
import { EmptyState } from "@/components/AppShell";
import { RecipeImage } from "@/components/recipes/RecipeImage";
import { cn } from "@/lib/utils";

export function WhyChips({ reasons, className }: { reasons: readonly Reason[]; className?: string }) {
  if (!reasons.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)} aria-label="Why">
      {reasons.map((r) => (
        <span
          key={r.key + r.label}
          data-tone={r.tone}
          className={cn(
            "rounded-[0.1875rem] border-[1.5px] border-line px-1 py-px font-mono text-[0.625rem] leading-[1.3] font-bold",
            r.tone === "expiry" ? "bg-peach text-onc" : r.tone === "good" ? "bg-acc text-onc" : "bg-s0 text-ink",
          )}
        >
          {r.label}
        </span>
      ))}
    </span>
  );
}

export function SuggestedSection({
  ranked,
  summaries,
  plannedIds,
  weights,
  wide,
  onAdd,
}: {
  ranked: readonly ScoreResult[] | null;
  summaries: ReadonlyMap<string, RecipeSummary>;
  plannedIds: ReadonlySet<string>;
  weights: Record<string, number> | undefined;
  wide: boolean;
  onAdd: (id: string) => void;
}) {
  const list = (ranked ?? []).filter((r) => !r.blocked && !plannedIds.has(r.id) && summaries.has(r.id)).slice(0, wide ? 6 : 4);
  const preset = presetOf(resolveWeights(weights));
  return (
    <section aria-labelledby="suggested-h" className="flex flex-col gap-3" data-testid="suggested">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="suggested-h" className="m-0 font-display text-[1.3125rem] font-normal">
          Suggested
        </h2>
        <Link to="/settings/weights" className="font-mono text-[0.65625rem] font-bold text-ink uppercase underline">
          Weights: {preset}
        </Link>
      </div>
      {ranked === null ? <EmptyState>Scoring recipes…</EmptyState> : null}
      {list.map((x) => {
        const r = summaries.get(x.id)!;
        return (
          <div key={x.id} data-testid="suggestion" className="flex items-stretch gap-2.5 rounded-ui border-bw bg-base p-2 shadow-hard">
            <Link to="/recipes/$id" params={{ id: r.id }} className="flex min-w-0 flex-1 items-stretch gap-2.5 text-ink no-underline">
              <span className="relative block w-16 flex-none overflow-hidden rounded-[calc(var(--r)*0.6)] border-2 border-line">
                <RecipeImage base={r.thumb} cuisine={r.cuisine} alt="" sizes="4rem" className="absolute inset-0" />
                <span className="absolute bottom-[0.1875rem] left-[0.1875rem] rounded-[0.1875rem] bg-ink px-1 py-px font-mono text-[0.625rem] font-extrabold text-base" aria-label={`Score ${x.score}`}>
                  {x.score}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-[0.3125rem] py-0.5">
                <span className="text-[0.90625rem] leading-tight font-extrabold">{r.title}</span>
                <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">
                  {r.totalMin} min · {formatProtein(r.proteinPerServingG, r.proteinApproximate)}
                  {x.costCents !== null ? ` · +${formatCents(x.costCents)}` : ""}
                </span>
                <WhyChips reasons={x.reasons} />
              </span>
            </Link>
            <button type="button" onClick={() => onAdd(r.id)} aria-label={`Add ${r.title} to plan`} className="press w-11 flex-none cursor-pointer rounded-ui border-2 border-line bg-acc text-xl font-extrabold text-onc shadow-hard-sm">
              +
            </button>
          </div>
        );
      })}
      {ranked && !list.length ? <EmptyState>No suggestions: every recipe is planned or filtered out by your preferences and tools.</EmptyState> : null}
    </section>
  );
}
