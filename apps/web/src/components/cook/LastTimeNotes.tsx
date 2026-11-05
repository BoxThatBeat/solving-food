// "Last time" (M28, PRD R4.38): the newest note left in a review of this recipe, with when and by whom, and Show earlier
// for up to four more. On mise en place and the recipe page; a dashed card like the recipe page's "made n times" row.
import * as React from "react";
import type { CookNote } from "@solving-food/core";
import { cn } from "@/lib/utils";
import { noteWhen } from "./noteWhen";

export function LastTimeNotes({ notes, names, tz, className }: { notes: readonly CookNote[]; names: ReadonlyMap<string, string>; tz: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [first, ...earlier] = notes;
  if (!first) return null;
  return (
    <section aria-label="Notes from last time" className={cn("flex flex-col gap-1.5 rounded-ui border-2 border-dashed border-line bg-base px-3 py-2.5", className)} data-testid="last-time">
      <p className="m-0 text-[0.9375rem] leading-snug font-semibold">
        <span className="font-extrabold">Last time ({noteWhen(first, names, tz)}):</span> <span data-testid="last-time-text">{first.text}</span>
      </p>
      {earlier.length ? (
        open ? (
          <ul className="m-0 flex list-none flex-col gap-1 border-t-2 border-dashed border-line p-0 pt-1.5" aria-label="Earlier notes">
            {earlier.map((n) => (
              <li key={n.eventId} className="text-[0.8125rem] leading-snug font-semibold">
                <span className="font-extrabold">{noteWhen(n, names, tz)}:</span> {n.text}
              </li>
            ))}
          </ul>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="min-h-11 cursor-pointer self-start bg-transparent px-0 text-[0.8125rem] font-extrabold text-ink underline underline-offset-2">
            Show earlier ({earlier.length})
          </button>
        )
      ) : null}
    </section>
  );
}
