// Pending reviews (PRD R9.4; prototype Plan "PENDING REVIEWS"): cooked meals nobody has reviewed yet, and recent ones
// I haven't rated, so any member can finish a review later and each member adds their own rating.
import { MealThumb } from "@/components/recipes/RecipeThumb";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useRatings } from "@/data/supply";
import { usePendingReviews } from "./helpers";
import { useMemberNames } from "@/data/households";
import { cn } from "@/lib/utils";

export function PendingReviews({ hid, uid }: { hid: string; uid: string }) {
  const list = usePendingReviews(hid, uid);
  const ratings = useRatings(list.length ? hid : null);
  const members = useMemberNames(hid);
  const index = useRecipeIndex(list.length > 0);
  const thumbs = React.useMemo(() => new Map((index ?? []).map((r) => [r.id, r])), [index]);
  if (!list.length) return null;
  return (
    <section aria-label="Pending reviews" className="overflow-hidden rounded-ui border-bw bg-base shadow-hard" data-testid="pending-reviews">
      <div className="bg-ink px-3.5 py-2 font-mono text-[0.6875rem] font-bold tracking-[0.09rem] text-base uppercase">Pending reviews · {list.length}</div>
      {list.map((e, i) => {
        const theirs = (ratings.docs ?? []).filter((r) => r.data.cookEventId === e.id && r.data.uid !== uid);
        const byWho = new Map<string, number[]>();
        for (const r of theirs) byWho.set(r.data.uid, [...(byWho.get(r.data.uid) ?? []), r.data.score]);
        const rated = [...byWho].map(([who, scores]) => `${(members.get(who) ?? "someone").toUpperCase()} RATED IT ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}/10`);
        const sub = e.reason === "review" ? [`COOKED BY ${(members.get(e.cookedBy) ?? "someone").toUpperCase()}`, "NOT REVIEWED YET"] : [...rated, "ADD YOURS"];
        const title = e.title ?? e.titles.join(" + ");
        return (
          <div key={e.id} className={cn("flex items-center gap-3 px-3.5 py-3", i && "border-t-2 border-line")}>
            <MealThumb ids={e.recipeIds} summary={(id) => thumbs.get(id)} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[0.9375rem] leading-tight font-extrabold">{title}</span>
              <span className="font-mono text-[0.625rem] font-semibold text-sub">{sub.join(" · ")}</span>
            </span>
            <Link
              to="/review/$eventId"
              params={{ eventId: e.id }}
              className="press flex-none rounded-ui border-2 border-line bg-acc px-3.5 py-2 text-[0.875rem] font-extrabold text-onc no-underline shadow-hard-sm"
              aria-label={`${e.reason === "review" ? "Review" : "Rate"} ${title}`}
            >
              {e.reason === "review" ? "Review" : "Rate"}
            </Link>
          </div>
        );
      })}
    </section>
  );
}
