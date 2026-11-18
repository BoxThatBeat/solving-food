// The recipe page's household suggestion score (M30, PRD R6.37; TECHNICAL_SPECS §7 "Suggestion score", §12): the
// recipe's score for this household right now (the same number Suggested ranks by) and what each factor adds or takes
// away, in points out of 100 (core `scoreBreakdown`). Signed in only; reads the shared scoring engine.
import { Link } from "@tanstack/react-router";
import { FACTORS, resolveWeights, scoreBreakdown, type FactorKey, type HouseholdDoc } from "@solving-food/core";
import { useSuggestions } from "@/data/suggestions";
import { cn } from "@/lib/utils";

const LABEL = new Map<FactorKey, string>(FACTORS.map((f) => [f.key, f.label]));

function fmtPoints(p: number): string {
  const n = Math.round(p);
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `−${-n}`;
}

const list = (keys: readonly FactorKey[]) => keys.map((k) => LABEL.get(k) ?? k).join(", ");

export function SuggestionScore({ recipeId, household }: { recipeId: string; household: HouseholdDoc | null | undefined }) {
  const s = useSuggestions();
  const result = s.byId.get(recipeId);
  const heading = (
    <h2 id="score-h" className="m-0 mt-1.5 font-display text-[1.3125rem] font-extrabold">
      Household suggestion score
    </h2>
  );
  if (!result) {
    // Scored once the engine has run; a recipe the index doesn't have (in Trash, waiting for review) isn't scored.
    if (s.ranked) return null;
    return (
      <section aria-labelledby="score-h" className="flex flex-col gap-2.5" data-testid="suggestion-score">
        {heading}
        <p role="status" className="m-0 text-sm font-semibold text-sub">
          Working out the score…
        </p>
      </section>
    );
  }
  const b = scoreBreakdown(result, resolveWeights(household?.settings?.scoreWeights));
  // Factors worth under half a point read as one line, not a row each (they'd round to 0).
  const counted = b.rows.filter((r) => Math.abs(r.points) >= 0.5);
  const zero = b.rows.filter((r) => Math.abs(r.points) < 0.5).map((r) => r.key);
  const widest = Math.max(1, ...counted.map((r) => Math.abs(r.points)));
  const capped = b.exact < -0.5 ? "below 0, so it shows 0" : b.exact > 100.5 ? "above 100, so it shows 100" : null;

  return (
    <section aria-labelledby="score-h" className="flex flex-col gap-2.5" data-testid="suggestion-score">
      <div className="flex items-end justify-between gap-3">
        {heading}
        <span className="flex flex-none items-baseline gap-0.5">
          <span className="font-extrabold tabular-nums text-[1.875rem] leading-none" data-testid="suggestion-score-total">
            {b.score}
          </span>
          <span className="tabular-nums text-[0.8125rem] font-bold text-sub">/100</span>
        </span>
      </div>
      <p className="-mt-1 m-0 text-[0.8125rem] leading-snug font-semibold text-sub">
        How well it suits the household right now, with your suggestion weights. Each factor adds or takes away points; Suggested ranks recipes by this score.
      </p>
      {result.blocked ? (
        <p className="m-0 rounded-ui border-2 border-dashed border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold" data-testid="suggestion-score-blocked">
          Not suggested · {result.blocked}
        </p>
      ) : result.planned ? (
        <p className="m-0 rounded-ui border-2 border-dashed border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold">Already in this period&apos;s plan, so it isn&apos;t suggested again</p>
      ) : null}
      <ul className="m-0 list-none overflow-hidden rounded-ui border-2 border-line bg-base p-0" aria-label="How the score adds up">
        {counted.map((r, i) => (
          <li key={r.key} className={cn("flex flex-col gap-1.5 px-3 py-2.5", i && "border-t-2 border-line")} data-testid={`score-row-${r.key}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[0.875rem] leading-tight font-extrabold">{r.label}</span>
                <span className="text-[0.6875rem] leading-snug font-semibold text-sub">
                  {r.detail ?? r.hint} · weight {r.weight}
                </span>
              </span>
              <span className="flex-none tabular-nums text-[1rem] font-extrabold" aria-label={`${fmtPoints(r.points)} points`}>
                {fmtPoints(r.points)}
              </span>
            </div>
            <div aria-hidden className="h-2 overflow-hidden rounded-[3px] border-[1.5px] border-line bg-mantle">
              <div className={cn("h-full", r.points >= 0 ? "bg-acc" : "bg-red")} style={{ width: `${Math.round((Math.abs(r.points) / widest) * 100)}%` }} />
            </div>
          </li>
        ))}
        <li className={cn("flex items-baseline justify-between gap-3 bg-mantle px-3 py-2.5", counted.length && "border-t-bw")}>
          <span className="text-[0.875rem] font-extrabold">Total</span>
          <span className="tabular-nums text-[1rem] font-extrabold">{b.score}</span>
        </li>
      </ul>
      <div className="flex flex-col gap-1 text-[0.6875rem] leading-snug font-semibold text-sub">
        {zero.length ? <span data-testid="score-zero">No points right now: {list(zero)}.</span> : null}
        <span>Points are rounded{capped ? `; the sum is ${capped}` : ""}.</span>
        {b.skipped.length ? <span>Not counted right now: {list(b.skipped)}.</span> : null}
        {b.off.length ? <span>Weighted 0: {list(b.off)}.</span> : null}
        <Link to="/settings/weights" className="inline-flex min-h-11 items-center self-start text-[0.8125rem] font-extrabold text-ink underline">
          Change suggestion weights
        </Link>
      </div>
    </section>
  );
}
