// <LeaveHouseholdDialog> (PRD R2.13): leaving is always allowed. The last member is warned that leaving deletes the
// household and all of its data (the cleanup function does it), with a way to download it first.
import { Link } from "@tanstack/react-router";
import { leaveConsequence } from "@solving-food/core";
import { ConfirmDialog } from "@/components/ui/dialog";

export function LeaveHouseholdDialog({
  open,
  onOpenChange,
  householdName,
  memberCount,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdName: string;
  memberCount: number;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const last = leaveConsequence(memberCount) === "deletesHousehold";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={last ? `Delete ${householdName}?` : `Leave ${householdName}?`}
      confirmLabel={last ? "Leave and delete" : "Leave"}
      destructive
      busy={busy}
      onConfirm={onConfirm}
    >
      {last ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0">
            You&apos;re the last member. Leaving <strong>deletes the household and all of its data</strong>: supply and its
            history, plans, grocery lists, cook history, ratings, and settings. This can&apos;t be undone.
          </p>
          <p className="m-0 text-[0.8125rem]">
            Recipes and meals in the shared library stay.{" "}
            <Link to="/settings/data" className="font-extrabold text-ink" onClick={() => onOpenChange(false)}>
              Download its data first
            </Link>
          </p>
        </div>
      ) : (
        <p className="m-0">
          You&apos;ll stop seeing its plan, supply, and history. Anyone still in it can invite you back.
        </p>
      )}
    </ConfirmDialog>
  );
}
