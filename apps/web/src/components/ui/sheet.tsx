import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// The prototype's sheet: a bottom sheet on phones, a centred panel from md up, over the flavour's scrim.
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  title,
  description,
  children,
  className,
  headerExtra,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Controls next to the close button (e.g. Reset). */
  headerExtra?: React.ReactNode;
  /** A sticky action bar under the scrolling body (e.g. "Show 14 recipes"). */
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-pg text-ink border-bw",
          "inset-x-0 bottom-0 max-h-[calc(100dvh-3rem)] rounded-t-sheet border-b-0",
          "md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(38.75rem,94vw)] md:max-h-[88dvh] md:rounded-ui md:border-b-bw md:shadow-hard",
          className,
        )}
      >
        <div className="flex flex-none items-center justify-between gap-2 border-b-bw bg-base px-4 pt-3.5 pb-3">
          <Dialog.Title className="m-0 font-display font-normal text-[1.375rem]">{title}</Dialog.Title>
          <span className="ml-auto" />
          {headerExtra}
          <Dialog.Close
            aria-label="Close"
            className="grid size-[2.375rem] cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink shadow-hard-sm"
          >
            <X aria-hidden className="size-4" strokeWidth={3} />
          </Dialog.Close>
        </div>
        {description ? (
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
        ) : (
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
        {footer ? (
          <div className="flex-none border-t-bw bg-base px-4 pt-3 pb-[max(1.375rem,env(safe-area-inset-bottom))]">{footer}</div>
        ) : null}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
