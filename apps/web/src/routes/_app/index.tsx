import { createFileRoute, redirect } from "@tanstack/react-router";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { landingPath, type HouseholdDoc } from "@solving-food/core";
import { db } from "@/firebase/app";

/** Does the active household's current period have any plan items? False when unknown (offline cache miss, slow). */
async function currentPeriodHasItems(hid: string): Promise<boolean> {
  const h = (await getDoc(doc(db, "households", hid))).data() as HouseholdDoc | undefined;
  if (!h?.currentPeriodId) return false;
  const q = query(collection(db, "households", hid, "planItems"), where("periodId", "==", h.currentPeriodId), limit(1));
  return !(await getDocs(q)).empty;
}

// R12 landing: Plan if the current period has items, else Recipes.
export const Route = createFileRoute("/_app/")({
  beforeLoad: async ({ context }) => {
    const s = await context.session.settled();
    let has = false;
    if (s.status === "ready") {
      try {
        has = await Promise.race([currentPeriodHasItems(s.activeHouseholdId), new Promise<boolean>((r) => setTimeout(() => r(false), 4000))]);
      } catch {
        has = false;
      }
    }
    throw redirect({ to: landingPath(has), replace: true });
  },
});
