// Empty-household cleanup (TECHNICAL_SPECS §10 "Empty household cleanup", PRD R2.13): when a household's last member
// leaves (or is removed), the household document and every subcollection are deleted, its import uploads go too, and
// the creator's `householdsCreated` counter drops by one (never below zero), so it no longer counts toward the
// 3-household limit (R2.3).
//
// Idempotent and safe under concurrent leaves: only the transaction that still finds the household document deletes
// it and decrements the counter; everyone else just finishes the recursive delete. If someone joined meanwhile, the
// household is kept.
import { db, bucket } from "./admin";

export type CleanupOutcome =
  | { status: "kept" }
  | { status: "deleted"; decremented: boolean }
  | { status: "gone" };

export async function cleanupIfEmpty(hid: string): Promise<CleanupOutcome> {
  const hRef = db.doc(`households/${hid}`);
  if (!(await hRef.collection("members").limit(1).get()).empty) return { status: "kept" };

  const outcome = await db.runTransaction(async (tx) => {
    const members = await tx.get(hRef.collection("members").limit(1));
    if (!members.empty) return "kept" as const;
    const h = await tx.get(hRef);
    if (!h.exists) return "gone" as const;
    const createdBy = h.data()?.createdBy;
    const userRef = typeof createdBy === "string" && createdBy ? db.doc(`users/${createdBy}`) : null;
    const user = userRef ? await tx.get(userRef) : null;
    tx.delete(hRef);
    if (userRef && user?.exists) {
      const n = Number(user.data()?.householdsCreated ?? 0);
      tx.update(userRef, { householdsCreated: Math.max(0, (Number.isFinite(n) ? n : 0) - 1) });
      return "decremented" as const;
    }
    return "deleted" as const;
  });
  if (outcome === "kept") return { status: "kept" };

  // The household document is gone; its subcollections (supply and transactions, plans, history, …) follow.
  await db.recursiveDelete(hRef);
  await bucket()
    .deleteFiles({ prefix: `imports/${hid}/` })
    .catch(() => undefined);
  return outcome === "gone" ? { status: "gone" } : { status: "deleted", decremented: outcome === "decremented" };
}
