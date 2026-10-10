// The prototype's "Households" sheet. M0: lists the user's households and switches the active one (stored on
// users/{uid}.activeHouseholdId). Creating more households and invites arrive in M4.

import * as React from "react";
import { doc, updateDoc } from "firebase/firestore";
import { Check } from "lucide-react";
import { db } from "@/firebase/app";
import { useHousehold, useMyHouseholds } from "@/data/households";
import { useReadySession } from "@/session/useSession";
import { cn } from "@/lib/utils";
import { Sheet, SheetClose, SheetContent } from "./ui/sheet";

function HouseholdRow({ hid, active, onPick }: { hid: string; active: boolean; onPick: () => void }) {
  const hh = useHousehold(hid);
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
            {hh.data ? `${hh.data.timezone} · serves ${hh.data.defaultServings}` : ""}
          </span>
        </span>
        {active ? <Check aria-hidden className="size-5" strokeWidth={3} /> : null}
      </button>
    </SheetClose>
  );
}

export function HouseholdSheet({ children }: { children: React.ReactNode }) {
  const s = useReadySession();
  const { householdIds, activeHouseholdId } = useMyHouseholds();
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
        <p className="m-0 text-xs leading-relaxed font-semibold text-sub">
          Households can&apos;t see each other. Supply, plans, history and ratings stay inside each one.
        </p>
      </SheetContent>
    </Sheet>
  );
}
