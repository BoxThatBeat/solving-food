import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type QuerySnapshot,
} from "firebase/firestore";
import {
  buildInvite,
  buildNewHousehold,
  DEFAULT_STORES,
  firstPeriod,
  inviteInbox,
  MAX_HOUSEHOLDS_CREATED,
  nextActiveHousehold,
  type DirectoryDoc,
  type HouseholdDoc,
  type InviteDoc,
  type InviteView,
  type MemberDoc,
  type NewHouseholdInput,
} from "@solving-food/core";
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

// ---------- M4: members, invites, create, leave (TECHNICAL_SPECS §10, PRD R2.2–R2.5, R2.13)

export interface MemberRow {
  uid: string;
  displayName: string;
  joinedAtMs: number | null;
}

/** The household's members, oldest first. */
export function useMembers(hid: string | null): { members: MemberRow[] | undefined } {
  const q = useLiveQuery<MemberDoc & { joinedAt?: { toMillis(): number } | null }>(
    hid ? collection(db, "households", hid, "members") : null,
    hid ? `households/${hid}/members` : null,
  );
  const members = useMemo(
    () =>
      q.docs
        ?.map((d) => ({ uid: d.id, displayName: d.data.displayName, joinedAtMs: d.data.joinedAt?.toMillis?.() ?? null }))
        .sort((a, b) => (a.joinedAtMs ?? Infinity) - (b.joinedAtMs ?? Infinity) || a.displayName.localeCompare(b.displayName)),
    [q.docs],
  );
  return { members };
}

export interface HouseholdInviteRow {
  key: string;
  inviteeUid?: string;
  inviteeEmailLower?: string;
  invitedByName?: string;
  createdAtMs: number | null;
}

/** Invites the household has sent and nobody has answered yet. */
export function useHouseholdInvites(hid: string | null): HouseholdInviteRow[] | undefined {
  const q = useLiveQuery<InviteDoc & { createdAt?: { toMillis(): number } | null }>(
    hid ? collection(db, "households", hid, "invites") : null,
    hid ? `households/${hid}/invites` : null,
  );
  return useMemo(
    () =>
      q.docs?.map((d) => ({
        key: d.id,
        inviteeUid: d.data.inviteeUid,
        inviteeEmailLower: d.data.inviteeEmailLower,
        invitedByName: d.data.invitedByName,
        createdAtMs: d.data.createdAt?.toMillis?.() ?? null,
      })),
    [q.docs],
  );
}

export interface DirectoryRow {
  uid: string;
  displayName: string;
}

/** The whole user directory (with friends and family it's a handful of docs; §10 "Invite by name"). */
export function useDirectory(enabled: boolean): DirectoryRow[] | undefined {
  const q = useLiveQuery<DirectoryDoc>(enabled ? collection(db, "directory") : null, enabled ? "directory" : null);
  return useMemo(() => q.docs?.map((d) => ({ uid: d.id, displayName: d.data.displayName })), [q.docs]);
}

export interface MyInvite extends InviteView {
  invitedByName?: string;
  createdAtMs: number | null;
}

/**
 * Invites addressed to me: two live collection-group queries (by uid and by address) merged, one per household, minus
 * households I'm already in (§10 "See invites").
 */
export function useMyInvites(uid: string | null, email: string | null, memberOf: readonly string[]): MyInvite[] | undefined {
  const [byUid, setByUid] = useState<MyInvite[] | undefined>(undefined);
  const [byEmail, setByEmail] = useState<MyInvite[] | undefined>(undefined);
  useEffect(() => {
    if (!uid || !email) return;
    const rows = (snap: QuerySnapshot): MyInvite[] =>
      snap.docs
        .filter((d) => !d.metadata.hasPendingWrites)
        .map((d) => {
          const data = d.data() as InviteDoc & { createdAt?: { toMillis(): number } | null };
          return {
            hid: d.ref.parent.parent?.id ?? "",
            key: d.id,
            householdName: data.householdName,
            invitedByName: data.invitedByName,
            createdAtMs: data.createdAt?.toMillis?.() ?? null,
          };
        })
        .filter((r) => r.hid);
    const onErr = (e: unknown) => console.error("invites listener failed", e);
    const u1 = onSnapshot(query(collectionGroup(db, "invites"), where("inviteeUid", "==", uid)), (s) => setByUid(rows(s)), onErr);
    const u2 = onSnapshot(query(collectionGroup(db, "invites"), where("inviteeEmailLower", "==", email)), (s) => setByEmail(rows(s)), onErr);
    return () => {
      u1();
      u2();
    };
  }, [uid, email]);
  return useMemo(() => {
    if (!byUid || !byEmail) return undefined;
    const all = [...byUid, ...byEmail].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    return inviteInbox(all, memberOf);
  }, [byUid, byEmail, memberOf]);
}

/** Thrown with a sentence the person can act on. */
export class HouseholdActionError extends Error {}

function isDenied(e: unknown): boolean {
  return (e as { code?: string })?.code === "permission-denied";
}

/**
 * Invite by email (R2.4): adds the address to the allowlist and creates the invite in one batch. Rules only let you
 * read your own allowlist entry, so when the address is already allowlisted the batch is refused and the invite is
 * written alone.
 */
export async function inviteByEmail(hid: string, email: string, ctx: { householdName: string; uid: string; displayName: string }): Promise<void> {
  const { key, doc: inv } = buildInvite({ email }, { householdName: ctx.householdName, invitedBy: ctx.uid, invitedByName: ctx.displayName });
  const inviteRef = doc(db, "households", hid, "invites", key);
  const invite = { ...inv, createdAt: serverTimestamp() };
  const b = writeBatch(db);
  b.set(doc(db, "allowlist", key), { addedBy: ctx.uid, addedAt: serverTimestamp(), inviteHouseholdId: hid });
  b.set(inviteRef, invite);
  try {
    await b.commit();
  } catch (e) {
    if (!isDenied(e)) throw e;
    try {
      await setDoc(inviteRef, invite);
    } catch (e2) {
      if (isDenied(e2)) throw new HouseholdActionError(`Couldn't invite ${key}. They may already be invited.`);
      throw e2;
    }
  }
}

/** Invite by name (R2.4): someone from the directory. */
export async function inviteByUid(hid: string, inviteeUid: string, ctx: { householdName: string; uid: string; displayName: string }): Promise<void> {
  const { key, doc: inv } = buildInvite({ uid: inviteeUid }, { householdName: ctx.householdName, invitedBy: ctx.uid, invitedByName: ctx.displayName });
  await setDoc(doc(db, "households", hid, "invites", key), { ...inv, createdAt: serverTimestamp() });
}

export async function cancelInvite(hid: string, key: string): Promise<void> {
  await deleteDoc(doc(db, "households", hid, "invites", key));
}

/**
 * Accept: my member doc and the invite's deletion in one batch (the rules check that an invite keyed by my uid or my
 * address exists). Both possible invite keys are removed, and the household becomes my active one.
 */
export async function acceptInvite(invite: { hid: string }, me: { uid: string; email: string; displayName: string }): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, "households", invite.hid, "members", me.uid), { uid: me.uid, displayName: me.displayName, joinedAt: serverTimestamp() });
  b.delete(doc(db, "households", invite.hid, "invites", me.uid));
  b.delete(doc(db, "households", invite.hid, "invites", me.email));
  b.update(doc(db, "users", me.uid), { activeHouseholdId: invite.hid });
  try {
    await b.commit();
  } catch (e) {
    if (isDenied(e)) throw new HouseholdActionError("That invite is no longer open.");
    throw e;
  }
}

export async function declineInvite(invite: { hid: string }, me: { uid: string; email: string }): Promise<void> {
  const b = writeBatch(db);
  b.delete(doc(db, "households", invite.hid, "invites", me.uid));
  b.delete(doc(db, "households", invite.hid, "invites", me.email));
  await b.commit();
}

/** Remove someone (R2.5, any member) or leave (yourself, R2.13). The last member leaving deletes the household. */
export async function removeMember(hid: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "households", hid, "members", uid));
}

export async function leaveHousehold(hid: string, me: { uid: string }, otherHouseholds: readonly string[]): Promise<void> {
  const next = nextActiveHousehold(hid, otherHouseholds);
  // Switch first, so the shell doesn't flash the household that's going away.
  await updateDoc(doc(db, "users", me.uid), { activeHouseholdId: next });
  await deleteDoc(doc(db, "households", hid, "members", me.uid));
}

/**
 * Create a household (R2.2, R2.3): one batch writes the household, my member doc, the first period, the default stores,
 * and bumps users/{uid}.householdsCreated; the rules refuse a 4th.
 */
export async function createHousehold(input: NewHouseholdInput, me: { uid: string; displayName: string }): Promise<string> {
  const { household, member } = buildNewHousehold(input, { uid: me.uid, displayName: me.displayName });
  const hRef = doc(collection(db, "households"));
  const batch = writeBatch(db);
  // The first plan period starts today (Planning/M2 §1) and the default stores exist from the start (§5).
  const p = firstPeriod(Date.now(), household.periodDays, household.timezone);
  batch.set(hRef, { ...household, currentPeriodId: p.id, createdAt: serverTimestamp() });
  batch.set(doc(hRef, "members", me.uid), { ...member, joinedAt: serverTimestamp() });
  batch.update(doc(db, "users", me.uid), { householdsCreated: increment(1), activeHouseholdId: hRef.id });
  batch.set(doc(hRef, "periods", p.id), { start: Timestamp.fromMillis(p.startMs), end: Timestamp.fromMillis(p.endMs), budgetCents: household.budgetCents });
  for (const st of DEFAULT_STORES) batch.set(doc(hRef, "stores", st.id), { name: st.name, kind: st.kind, bulk: st.bulk });
  try {
    await batch.commit();
  } catch (e) {
    if (isDenied(e)) throw new HouseholdActionError(`You've already created ${MAX_HOUSEHOLDS_CREATED} households, the most anyone can. A household you created stops counting when it's deleted (its last member leaves).`);
    throw e;
  }
  return hRef.id;
}
