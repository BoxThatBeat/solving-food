// The filter sheet shared by Recipes (and every <CollectionView>) and Supply (M24): the options change a draft, and
// nothing applies until "Show N …" (N counts the draft); Reset clears the draft, closing without Show discards it.
import * as React from "react";
import { Sheet, SheetContent } from "./ui/sheet";

export function FilterSheet({
  open,
  onOpenChange,
  title,
  onReset,
  showLabel,
  onShow,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onReset: () => void;
  /** "Show 14 recipes" */
  showLabel: string;
  onShow: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={title}
        headerExtra={
          <button type="button" onClick={onReset} className="min-h-11 cursor-pointer bg-transparent px-1.5 text-[0.8125rem] font-extrabold text-ink underline">
            Reset
          </button>
        }
        footer={
          <button type="button" onClick={onShow} className="press w-full cursor-pointer rounded-ui border-bw bg-acc p-4 text-[1rem] font-extrabold text-onc shadow-hard">
            {showLabel}
          </button>
        }
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}
