// The prototype's "Households" sheet (R2.2, R2.3): my households with their member counts, switching the active one
// (users/{uid}.activeHouseholdId), and "+ New household (n of 3 created)". Membership is the live collection-group
// query, so a household I'm removed from drops out of this list at once.

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { doc, updateDoc } from "firebase/firestore";
import { Check } from "lucide-react";
import { canCreateHousehold, MAX_HOUSEHOLDS_CREATED } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useHousehold, useMembers, useMyHouseholds } from "@/data/households";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";
import { Sheet, SheetClose, SheetContent } from "./ui/sheet";

function HouseholdRow({ hid, active, onPick }: { hid: string; active: boolean; onPick: () => void }) {
  const hh = useHousehold(hid);
  const { members } = useMembers(hid);
  const n = members?.length;
  return (
    <SheetClose asChild>
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex cursor-pointer items-center justify-between gap-2.5 rounded-ui border-bw p-3.5 text-left",
          active ? "bg-acc text-onc" : "bg-base text-ink shadow-hard",
        )}
      >
        <span className="flex flex-col gap-1">
          <span className="text-lg font-extrabold">{hh.data?.name ?? "…"}</span>
          <span className="font-mono text-[0.65625rem] font-semibold uppercase">
            {n === undefined ? "" : `${n} member${n === 1 ? "" : "s"}`}
            {hh.data ? ` · ${hh.data.timezone} · serves ${hh.data.defaultServings}` : ""}
          </span>
        </span>
        {active ? <Check aria-hidden className="size-5" strokeWidth={3} /> : <span aria-hidden className="text-base font-extrabold">→</span>}
      </button>
    </SheetClose>
  );
}

export function HouseholdSheet({ children }: { children: React.ReactNode }) {
  const s = useReadySession();
  const { householdIds, activeHouseholdId } = useMyHouseholds();
  const created = s.profile.householdsCreated;
  const canCreate = canCreateHousehold(created);
  const pick = (hid: string) => {
    if (hid !== activeHouseholdId) void updateDoc(doc(db, "users", s.user.uid), { activeHouseholdId: hid });
  };
  return (
    <Sheet>
      {children}
      <SheetContent title="Households">
        {householdIds.map((hid) => (
          <HouseholdRow key={hid} hid={hid} active={hid === activeHouseholdId} onPick={() => pick(hid)} />
        ))}
        {canCreate ? (
          <SheetClose asChild>
            <Link
              to="/welcome/household"
              className="rounded-ui border-2 border-dashed border-line bg-transparent p-3 text-center text-sm font-extrabold text-ink no-underline"
            >
              + New household ({created} of {MAX_HOUSEHOLDS_CREATED} created)
            </Link>
          </SheetClose>
        ) : (
          <div className="flex flex-col gap-1 rounded-ui border-2 border-dashed border-line p-3 text-center" role="note">
            <span className="text-sm font-extrabold">
              {created} of {MAX_HOUSEHOLDS_CREATED} households created
            </span>
            <span className="text-xs font-semibold">
              That&apos;s the most anyone can create. One you created stops counting when it&apos;s deleted (its last member
              leaves). You can still join others by invite.
            </span>
          </div>
        )}
        <p className="m-0 text-xs leading-relaxed font-semibold text-sub">
          Households can&apos;t see each other. Supply, plans, history and ratings stay inside each one.
        </p>
      </SheetContent>
    </Sheet>
  );
}
