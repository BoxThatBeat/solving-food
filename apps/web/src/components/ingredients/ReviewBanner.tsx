// The Recipes page's "N ingredients from imports need review →" banner (PRD R4.27, Planning/M8 item 4). Dismissing it
// hides it for this browser session only; it comes back in the next session while anything still needs review.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useNeedsReview } from "@/data/ingredients";

const KEY = "sf.ingredientReviewDismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function IngredientReviewBanner() {
  const list = useNeedsReview();
  const [dismissed, setDismissed] = React.useState(readDismissed);
  const n = list?.length ?? 0;
  if (!n || dismissed) return null;
  const dismiss = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* private mode: dismissed until reload */
    }
    setDismissed(true);
  };
  return (
    <div
      data-testid="ingredient-review-banner"
      className="flex max-w-[60rem] items-center gap-2.5 rounded-ui border-2 border-dashed border-line bg-base py-1 pr-1 pl-3 text-[0.8125rem] font-bold text-ink"
    >
      <span className="rounded border-2 border-line bg-yellow px-1.5 py-0.5 font-mono text-[0.625rem] font-extrabold text-onc">{n}</span>
      <Link to="/ingredients" search={{ view: "review" }} className="flex min-h-[2.375rem] flex-1 items-center gap-2 text-ink no-underline">
        <span className="flex-1">{n === 1 ? "1 ingredient from imports needs review" : `${n} ingredients from imports need review`}</span>
        <span aria-hidden className="font-extrabold">
          →
        </span>
      </Link>
      <button type="button" onClick={dismiss} aria-label="Hide until next time" className="grid size-[2.375rem] flex-none cursor-pointer place-items-center bg-transparent text-ink">
        <X aria-hidden className="size-4" strokeWidth={3} />
      </button>
    </div>
  );
}
