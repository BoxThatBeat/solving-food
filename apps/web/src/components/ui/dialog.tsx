import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * A confirmation dialog in the prototype's language: base panel, look-weight border, hard shadow, over the scrim.
 * Used for destructive or consequential actions (delete to Trash, overwrite, discard an import).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  destructive,
  busy,
  extra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
  /** Further actions between cancel and confirm. */
  extra?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          role="alertdialog"
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-ui border-bw bg-base p-5 text-ink shadow-hard"
        >
          <Dialog.Title className="m-0 font-display text-[1.375rem] leading-tight font-normal">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="text-[0.9375rem] leading-normal font-semibold">{children}</div>
          </Dialog.Description>
          <div className="flex flex-wrap justify-end gap-2.5">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">
                {cancelLabel}
              </Button>
            </Dialog.Close>
            {extra}
            <Button
              size="sm"
              disabled={busy}
              className={cn(destructive && "bg-red text-onc")}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
