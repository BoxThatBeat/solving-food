import { useMemo } from "react";
import { collection, doc } from "firebase/firestore";
import type { HouseholdDoc, MemberDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc, useLiveQuery } from "./live";
import { useReadySession } from "@/session/useSession";

export function useHousehold(hid: string | null) {
  return useLiveDoc<HouseholdDoc>(hid ? doc(db, "households", hid) : null, hid ? `households/${hid}` : null);
}

/** Memberships come from the session's live collection-group query on `members`; the active one is resolved there. */
export function useMyHouseholds(): { householdIds: string[]; activeHouseholdId: string } {
  const s = useReadySession();
  return { householdIds: s.householdIds, activeHouseholdId: s.activeHouseholdId };
}

export function useActiveHousehold() {
  const { activeHouseholdId } = useMyHouseholds();
  return { id: activeHouseholdId, ...useHousehold(activeHouseholdId) };
}

/** uid → display name of the active household's members (who did what in ledgers and history). */
export function useMemberNames(hid: string | null): Map<string, string> {
  const q = useLiveQuery<MemberDoc>(hid ? collection(db, "households", hid, "members") : null, hid ? `households/${hid}/members` : null);
  return useMemo(() => new Map((q.docs ?? []).map((d) => [d.id, d.data.displayName])), [q.docs]);
}
