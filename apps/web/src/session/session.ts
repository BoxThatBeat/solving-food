// The signed-in state the router guards and the shell read (Planning/M0 §4–5).
//
// Order matters because of the rules: the allowlist entry is read first (a non-allowlisted user can read nothing
// else), then the user doc, directory entry, and memberships are followed live. Memberships come from a
// collection-group query on `members` (TECHNICAL_SPECS §10), so being removed elsewhere takes effect immediately.

import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collectionGroup,
  doc,
  onSnapshot,
  query,
  where,
  type DocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { normalizeEmail, pickActiveHousehold, type DirectoryDoc, type UserDoc } from "@solving-food/core";
import { auth, db } from "@/firebase/app";

export interface AuthUser {
  uid: string;
  email: string;
}

export type Session =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "notInvited"; email: string }
  | { status: "needsProfile"; user: AuthUser }
  | { status: "needsHousehold"; user: AuthUser; profile: UserDoc; displayName: string }
  | {
      status: "ready";
      user: AuthUser;
      profile: UserDoc;
      displayName: string;
      householdIds: string[];
      activeHouseholdId: string;
    };

export type SessionStatus = Session["status"];

/** Remembers, per uid, that the allowlist check passed, so an offline cold start doesn't bounce to "not invited". */
const ALLOWED_KEY = "sf.allowed";

function rememberAllowed(uid: string): void {
  try {
    localStorage.setItem(ALLOWED_KEY, uid);
  } catch {
    /* ignore */
  }
}
function wasAllowed(uid: string): boolean {
  try {
    return localStorage.getItem(ALLOWED_KEY) === uid;
  } catch {
    return false;
  }
}

/** Last known memberships per uid, for offline cold starts where the cached collection-group result can be empty. */
const HOUSEHOLDS_KEY = "sf.households";

function rememberHouseholds(uid: string, ids: string[]): void {
  try {
    localStorage.setItem(HOUSEHOLDS_KEY, JSON.stringify({ uid, ids }));
  } catch {
    /* ignore */
  }
}
function rememberedHouseholds(uid: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(HOUSEHOLDS_KEY) ?? "null") as { uid?: string; ids?: unknown } | null;
    return v?.uid === uid && Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A cache-only "missing" answer may just mean we haven't heard from the server yet. */
function settledMissing(snap: DocumentSnapshot | QuerySnapshot): boolean {
  return !snap.metadata.fromCache || isOffline();
}

export class SessionStore {
  private state: Session = { status: "loading" };
  private listeners = new Set<() => void>();
  private waiters: Array<(s: Session) => void> = [];
  private unsubs: Array<() => void> = [];
  private started = false;

  // Latest values of the per-user listeners; undefined = not heard yet.
  private user: AuthUser | null = null;
  private profile: UserDoc | null | undefined;
  private directory: DirectoryDoc | null | undefined;
  private householdIds: string[] | undefined;

  start(): void {
    if (this.started) return;
    this.started = true;
    onAuthStateChanged(auth, (u) => this.onAuthUser(u));
  }

  get(): Session {
    return this.state;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Session => this.state;

  /** Resolves with the first non-loading state. Router guards await this. */
  settled(): Promise<Session> {
    if (this.state.status !== "loading") return Promise.resolve(this.state);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private set(next: Session): void {
    this.state = next;
    if (next.status !== "loading") {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((fn) => fn(next));
    }
    this.listeners.forEach((fn) => fn());
  }

  private stopListeners(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.profile = undefined;
    this.directory = undefined;
    this.householdIds = undefined;
  }

  private onAuthUser(u: User | null): void {
    this.stopListeners();
    if (!u) {
      this.user = null;
      this.set({ status: "signedOut" });
      return;
    }
    const email = u.email ? normalizeEmail(u.email) : "";
    this.user = { uid: u.uid, email };
    // Rules require a verified address (email-link sign-in always verifies). Anything else is treated as uninvited.
    if (!email || !u.emailVerified) {
      this.set({ status: "notInvited", email });
      return;
    }
    this.set({ status: "loading" });
    let following = false;
    const unsub = onSnapshot(
      doc(db, "allowlist", email),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.exists()) {
          rememberAllowed(u.uid);
          if (!following) {
            following = true;
            this.followUser(u.uid);
          }
        } else if (settledMissing(snap)) {
          if (isOffline() && wasAllowed(u.uid)) {
            if (!following) {
              following = true;
              this.followUser(u.uid);
            }
            return;
          }
          this.stopListeners();
          this.set({ status: "notInvited", email });
        }
      },
      () => {
        // Permission denied (e.g. unverified token) or similar: same outcome as not being on the list.
        this.stopListeners();
        this.set({ status: "notInvited", email });
      },
    );
    this.unsubs.push(unsub);
  }

  private followUser(uid: string): void {
    const onError = (err: unknown) => {
      console.error("session listener failed", err);
    };
    this.unsubs.push(
      onSnapshot(
        doc(db, "users", uid),
        { includeMetadataChanges: true },
        (snap) => {
          if (snap.exists()) this.profile = snap.data() as UserDoc;
          else if (!snap.metadata.fromCache) this.profile = null;
          else return; // offline cache miss: don't send a known user to first-run setup
          this.derive();
        },
        onError,
      ),
      onSnapshot(
        doc(db, "directory", uid),
        { includeMetadataChanges: true },
        (snap) => {
          if (snap.exists()) this.directory = snap.data() as DirectoryDoc;
          else if (!snap.metadata.fromCache) this.directory = null;
          else return;
          this.derive();
        },
        onError,
      ),
      onSnapshot(
        query(collectionGroup(db, "members"), where("uid", "==", uid)),
        { includeMetadataChanges: true },
        (snap) => {
          // members/{uid} lives at households/{hid}/members/{uid}
          // Only memberships the server has acknowledged: the shell's listeners on a household are refused by the
          // rules until its creation batch (household + member doc) has actually been committed.
          const ids = snap.docs
            .filter((d) => !d.metadata.hasPendingWrites)
            .map((d) => d.ref.parent.parent?.id)
            .filter((id): id is string => !!id)
            .sort();
          if (ids.length === 0 && snap.metadata.fromCache) {
            const remembered = isOffline() ? rememberedHouseholds(uid) : null;
            if (!remembered) return; // wait for the server
            this.householdIds = remembered;
          } else {
            this.householdIds = ids;
            if (!snap.metadata.fromCache) rememberHouseholds(uid, ids);
          }
          this.derive();
        },
        onError,
      ),
    );
  }

  private derive(): void {
    const user = this.user;
    if (!user) return;
    if (this.profile === undefined || this.directory === undefined) return;
    if (this.profile === null || this.directory === null) {
      this.set({ status: "needsProfile", user });
      return;
    }
    if (this.householdIds === undefined) return;
    const profile = this.profile;
    const displayName = this.directory.displayName;
    const active = pickActiveHousehold(profile.activeHouseholdId, this.householdIds);
    if (!active) {
      this.set({ status: "needsHousehold", user, profile, displayName });
      return;
    }
    this.set({ status: "ready", user, profile, displayName, householdIds: this.householdIds, activeHouseholdId: active });
  }
}

export const session = new SessionStore();
