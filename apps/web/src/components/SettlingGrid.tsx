// <SettlingGrid> (TECHNICAL_SPECS §12, M7): the card grid under <CollectionView> on Recipes and Meals. While `busy`
// (useSettling: a re-sort is in progress) it shows skeleton cards of the same size, with no text, and `aria-busy`, so a
// tap can't land on a card that is about to move. Keyboard focus on a card moves to the list while it is busy and back
// to the same card (wherever it ends up) afterwards.
import * as React from "react";
import { cn } from "@/lib/utils";

export function SettlingGrid({
  busy,
  label,
  className,
  count,
  skeleton,
  children,
}: {
  busy: boolean;
  /** Accessible name of the list ("Recipes"). */
  label: string;
  className?: string;
  /** How many skeleton cards to show (the number of cards, capped). */
  count: number;
  /** One skeleton card. */
  skeleton: React.ReactNode;
  /** `<li data-card-id=…>` items. */
  children: React.ReactNode;
}) {
  const list = React.useRef<HTMLUListElement>(null);
  const focused = React.useRef<{ id: string; index: number } | null>(null);

  const onFocus = (e: React.FocusEvent<HTMLUListElement>) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
    if (!li) return;
    const index = [...li.querySelectorAll<HTMLElement>("a[href], button")].indexOf(e.target as HTMLElement);
    focused.current = { id: li.dataset.cardId!, index: Math.max(0, index) };
  };
  const onBlur = (e: React.FocusEvent<HTMLUListElement>) => {
    if (!busy && !list.current?.contains(e.relatedTarget as Node | null)) focused.current = null;
  };

  React.useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (busy) {
      if (focused.current && (lost || ul.contains(document.activeElement))) ul.focus({ preventScroll: true });
      return;
    }
    if (document.activeElement !== ul || !focused.current) return;
    const li = ul.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(focused.current.id)}"]`);
    const target = li?.querySelectorAll<HTMLElement>("a[href], button")[focused.current.index] ?? ul.querySelector<HTMLElement>("a[href]");
    target?.focus({ preventScroll: true });
  }, [busy]);

  return (
    <ul
      ref={list}
      className={cn(className, "outline-none")}
      aria-label={label}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {busy
        ? Array.from({ length: Math.max(1, Math.min(count, 12)) }, (_, i) => (
            <li key={i} className="min-w-0" data-testid="card-skeleton" aria-hidden>
              {skeleton}
            </li>
          ))
        : children}
    </ul>
  );
}

const BAR = "rounded-sm bg-mantle motion-safe:animate-pulse";

/** A recipe card's shape (4:5 image, meta line, two-line title, stats line) with no text. */
export function RecipeCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-ui border-bw bg-base shadow-hard">
      <div className={cn("aspect-[4/5] w-full border-b-bw", BAR, "rounded-none")} />
      <div className="flex flex-col gap-[0.3125rem] px-2.5 pt-[0.5625rem] pb-[0.6875rem]">
        <span className={cn("h-[0.85rem] w-4/5", BAR)} />
        <span className={cn("h-[2.15rem] w-full", BAR)} />
        <span className={cn("h-[0.85rem] w-2/5", BAR)} />
      </div>
    </div>
  );
}

/** A saved meal card's shape (image strip, title, meta, two recipe rows) with no text. */
export function MealCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-ui border-bw bg-base shadow-hard">
      <div className={cn("h-[8.25rem] flex-none border-b-bw", BAR, "rounded-none")} />
      <div className="flex flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <span className={cn("h-[1.5rem] w-3/4", BAR)} />
        <span className={cn("h-[0.85rem] w-1/2", BAR)} />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="border-t-2 border-line px-3.5 py-2">
          <span className={cn("block h-[2.1rem] w-2/3", BAR)} />
        </div>
      ))}
      <div className="h-[3.875rem] border-t-2 border-line" />
    </div>
  );
}
