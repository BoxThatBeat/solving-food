import { doc } from "firebase/firestore";
import type { HouseholdDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc } from "./live";
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
