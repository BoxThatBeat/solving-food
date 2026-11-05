import { createFileRoute, redirect } from "@tanstack/react-router";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { landingPath, type HouseholdDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { rememberedLanding } from "@/plan/landing";

/** Does the active household's current period have any plan items? False when unknown (offline cache miss, slow). */
async function currentPeriodHasItems(hid: string): Promise<boolean> {
  const h = (await getDoc(doc(db, "households", hid))).data() as HouseholdDoc | undefined;
  if (!h?.currentPeriodId) return false;
  const q = query(collection(db, "households", hid, "planItems"), where("periodId", "==", h.currentPeriodId), limit(1));
  return !(await getDocs(q)).empty;
}

// R12 landing: Plan if the current period has items, else Recipes. M23: from what this device last saw (the shell's
// plan model remembers it), without a server round trip; a first visit on this device asks, for at most 1.5 s.
export const Route = createFileRoute("/_app/")({
  beforeLoad: async ({ context }) => {
    const s = await context.session.settled();
    if (s.status !== "ready") throw redirect({ to: landingPath(false), replace: true });
    const known = rememberedLanding(s.activeHouseholdId);
    if (known !== null) throw redirect({ to: landingPath(known), replace: true });
    const has = await Promise.race([currentPeriodHasItems(s.activeHouseholdId).catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    throw redirect({ to: landingPath(has), replace: true });
  },
});
