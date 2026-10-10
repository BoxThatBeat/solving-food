// Firestore rules, M4 (Planning/M4 "Tests → Rules", TECHNICAL_SPECS §10): invites by name and by email, accepting
// them, removing and leaving, collection-group reads scoped to yourself, and isolation between households.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

const rules = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
let env: RulesTestEnvironment;

const ALICE = { uid: "alice", email: "alice@example.com" };
const BOB = { uid: "bob", email: "bob@example.com" };
const CARA = { uid: "cara", email: "cara@example.com" }; // allowlisted later, through an invite by email
const EVE = { uid: "eve", email: "eve@example.com" }; // never allowlisted

const dbAs = (u: { uid: string; email: string }) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore() as unknown as Firestore;
const seed = (fn: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as unknown as Firestore));

function household(createdBy: string, name = "Silbrass Pvt") {
  return {
    name, createdBy, periodDays: 7, budgetCents: 20000, currency: "CAD", timezone: "America/Toronto", defaultServings: 4,
    plannedMealTypes: ["dinner"], pcxStoreId: "loblaws-greenbank-road", currentPeriodId: null,
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} },
  };
}
const inviteByName = (to: string, extra: Record<string, unknown> = {}) => ({
  inviteeUid: to, householdName: "Silbrass Pvt", invitedBy: ALICE.uid, invitedByName: "Alice", createdAt: serverTimestamp(), ...extra,
});
const inviteByEmail = (to: string, extra: Record<string, unknown> = {}) => ({
  inviteeEmailLower: to, householdName: "Silbrass Pvt", invitedBy: ALICE.uid, invitedByName: "Alice", createdAt: serverTimestamp(), ...extra,
});
const memberDoc = (u: { uid: string }, name = "Bob") => ({ uid: u.uid, displayName: name, joinedAt: serverTimestamp() });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "solvingfood", firestore: { rules, host: host ?? "127.0.0.1", port: Number(port ?? 8080) } });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    for (const u of [ALICE, BOB]) {
      await setDoc(doc(db, "allowlist", u.email), { addedBy: "seed", addedAt: new Date() });
      await setDoc(doc(db, "users", u.uid), { email: u.email, activeHouseholdId: null, householdsCreated: 1, theme: { flavour: "latte", accent: "green" } });
      await setDoc(doc(db, "directory", u.uid), { displayName: u.uid, displayNameLower: u.uid });
    }
    await setDoc(doc(db, "households", "hA"), household(ALICE.uid));
    await setDoc(doc(db, "households", "hA", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: new Date() });
    await setDoc(doc(db, "households", "hB"), household(BOB.uid, "Cottage"));
    await setDoc(doc(db, "households", "hB", "members", BOB.uid), { uid: BOB.uid, displayName: "Bob", joinedAt: new Date() });
  });
});

describe("invite by name (R2.4)", () => {
  it("a member invites someone from the directory; they see it, accept, and become a member", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), inviteByName(BOB.uid)));
    // Bob finds it with the collection-group query and reads it, though he can't read the household.
    await assertSucceeds(getDocs(query(collectionGroup(dbAs(BOB), "invites"), where("inviteeUid", "==", BOB.uid))));
    await assertSucceeds(getDoc(doc(dbAs(BOB), "households/hA/invites", BOB.uid)));
    await assertFails(getDoc(doc(dbAs(BOB), "households/hA")));
    const bob = dbAs(BOB);
    const b = writeBatch(bob);
    b.set(doc(bob, "households/hA/members", BOB.uid), memberDoc(BOB));
    b.delete(doc(bob, "households/hA/invites", BOB.uid));
    b.update(doc(bob, "users", BOB.uid), { activeHouseholdId: "hA" });
    await assertSucceeds(b.commit());
    await assertSucceeds(getDoc(doc(bob, "households/hA")));
  });

  it("only members invite, as themselves, with the household's real name, and not existing members or themselves", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/invites", "cara"), { ...inviteByName("cara"), invitedBy: BOB.uid }));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), inviteByName(BOB.uid, { invitedBy: BOB.uid })));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), inviteByName(BOB.uid, { householdName: "Free food" })));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", "someone"), inviteByName(BOB.uid)));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", ALICE.uid), inviteByName(ALICE.uid)));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), { ...inviteByName(BOB.uid), inviteeEmailLower: BOB.email }));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), inviteByName(BOB.uid, { role: "admin" })));
  });

  it("invites can't be edited; members cancel them; the invitee declines", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), inviteByName(BOB.uid)));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), { householdName: "x" }));
    await assertSucceeds(deleteDoc(doc(dbAs(BOB), "households/hA/invites", BOB.uid)));
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid), inviteByName(BOB.uid)));
    await assertSucceeds(deleteDoc(doc(dbAs(ALICE), "households/hA/invites", BOB.uid)));
  });
});

describe("invite by email (R2.4, R2.12)", () => {
  it("allowlist + invite in one batch; the newcomer signs up, sees the invite by email, and accepts", async () => {
    const a = dbAs(ALICE);
    const b = writeBatch(a);
    b.set(doc(a, "allowlist", CARA.email), { addedBy: ALICE.uid, addedAt: serverTimestamp(), inviteHouseholdId: "hA" });
    b.set(doc(a, "households/hA/invites", CARA.email), inviteByEmail(CARA.email));
    await assertSucceeds(b.commit());
    await assertSucceeds(getDocs(query(collectionGroup(dbAs(CARA), "invites"), where("inviteeEmailLower", "==", CARA.email))));
    await assertSucceeds(setDoc(doc(dbAs(CARA), "users", CARA.uid), { email: CARA.email, activeHouseholdId: null, householdsCreated: 0, theme: { flavour: "latte", accent: "green" }, createdAt: serverTimestamp() }));
    const c = dbAs(CARA);
    const accept = writeBatch(c);
    accept.set(doc(c, "households/hA/members", CARA.uid), memberDoc(CARA, "Cara"));
    accept.delete(doc(c, "households/hA/invites", CARA.email));
    accept.delete(doc(c, "households/hA/invites", CARA.uid)); // a by-name invite may also exist; deleting none is fine
    await assertSucceeds(accept.commit());
    await assertSucceeds(getDocs(collection(c, "households/hA/planItems")));
  });

  it("an address already on the allowlist: the allowlist write is refused, the invite alone works", async () => {
    const a = dbAs(ALICE);
    const b = writeBatch(a);
    b.set(doc(a, "allowlist", BOB.email), { addedBy: ALICE.uid, addedAt: serverTimestamp(), inviteHouseholdId: "hA" });
    b.set(doc(a, "households/hA/invites", BOB.email), inviteByEmail(BOB.email));
    await assertFails(b.commit());
    await assertSucceeds(setDoc(doc(a, "households/hA/invites", BOB.email), inviteByEmail(BOB.email)));
  });

  it("email invites need a lower-cased address key matching the field", async () => {
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", "Cara@Example.com"), inviteByEmail("Cara@Example.com")));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", "not-an-email"), inviteByEmail("not-an-email")));
    await assertFails(setDoc(doc(dbAs(ALICE), "households/hA/invites", CARA.email), inviteByEmail("dan@example.com")));
    await assertFails(setDoc(doc(dbAs(ALICE), "allowlist", CARA.email), { addedBy: ALICE.uid, addedAt: serverTimestamp(), inviteHouseholdId: "hB" }));
  });
});

describe("joining needs an invite (member create requires uid, §10)", () => {
  it("no invite, no membership; an invite for someone else doesn't help", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid), memberDoc(BOB)));
    await seed((db) => setDoc(doc(db, "households/hA/invites", "dan"), { inviteeUid: "dan", householdName: "Silbrass Pvt", invitedBy: ALICE.uid, createdAt: new Date() }));
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid), memberDoc(BOB)));
  });

  it("with an invite the member doc must carry your uid and only the known fields", async () => {
    await seed((db) => setDoc(doc(db, "households/hA/invites", BOB.uid), { inviteeUid: BOB.uid, householdName: "Silbrass Pvt", invitedBy: ALICE.uid, createdAt: new Date() }));
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid), { displayName: "Bob", joinedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid), { ...memberDoc(BOB), uid: "someone" }));
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid), { ...memberDoc(BOB), role: "owner" }));
    await assertFails(setDoc(doc(dbAs(BOB), "households/hA/members", "dan"), { ...memberDoc({ uid: "dan" }) }));
    await assertSucceeds(setDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid), memberDoc(BOB)));
  });

  it("someone not on the allowlist can't accept even an invite keyed to them", async () => {
    await seed((db) => setDoc(doc(db, "households/hA/invites", EVE.email), { inviteeEmailLower: EVE.email, householdName: "Silbrass Pvt", invitedBy: ALICE.uid, createdAt: new Date() }));
    await assertFails(getDocs(query(collectionGroup(dbAs(EVE), "invites"), where("inviteeEmailLower", "==", EVE.email))));
    await assertFails(setDoc(doc(dbAs(EVE), "households/hA/members", EVE.uid), memberDoc(EVE, "Eve")));
  });
});

describe("remove and leave (R2.5, R2.13)", () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, "households/hA/members", BOB.uid), { uid: BOB.uid, displayName: "Bob", joinedAt: new Date() }));
  });

  it("any member removes any other (no roles) and anyone can leave", async () => {
    await assertSucceeds(deleteDoc(doc(dbAs(BOB), "households/hA/members", ALICE.uid)));
    await assertFails(getDoc(doc(dbAs(ALICE), "households/hA")));
    await assertSucceeds(deleteDoc(doc(dbAs(BOB), "households/hA/members", BOB.uid)));
  });

  it("non-members remove nobody; member docs can't be edited", async () => {
    await assertFails(deleteDoc(doc(dbAs(ALICE), "households/hB/members", BOB.uid)));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households/hA/members", BOB.uid), { displayName: "Robert" }));
  });
});

describe("collection-group reads are scoped to yourself (NFR4)", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "households/hB/invites", "dan"), { inviteeUid: "dan", householdName: "Cottage", invitedBy: BOB.uid, createdAt: new Date() });
      await setDoc(doc(db, "households/hB/invites", "dan@example.com"), { inviteeEmailLower: "dan@example.com", householdName: "Cottage", invitedBy: BOB.uid, createdAt: new Date() });
    });
  });

  it("nobody lists other people's invites or memberships", async () => {
    await assertFails(getDocs(collectionGroup(dbAs(ALICE), "invites")));
    await assertFails(getDocs(query(collectionGroup(dbAs(ALICE), "invites"), where("inviteeUid", "==", "dan"))));
    await assertFails(getDocs(query(collectionGroup(dbAs(ALICE), "invites"), where("inviteeEmailLower", "==", "dan@example.com"))));
    await assertFails(getDocs(query(collectionGroup(dbAs(ALICE), "members"), where("uid", "==", BOB.uid))));
    await assertFails(getDocs(collection(dbAs(ALICE), "households/hB/invites")));
    await assertSucceeds(getDocs(query(collectionGroup(dbAs(ALICE), "invites"), where("inviteeUid", "==", ALICE.uid))));
  });

  it("a member of A reads nothing under B, whatever the collection", async () => {
    await seed(async (db) => {
      for (const c of ["supply", "planItems", "cookEvents", "ratings", "stats", "groceryLists", "commands", "favourites", "notes", "cadence", "periods", "stores"]) {
        await setDoc(doc(db, `households/hB/${c}/x`), { a: 1 });
      }
      await setDoc(doc(db, "households/hB/supply/x/transactions/t"), { delta: 1 });
    });
    const a = dbAs(ALICE);
    for (const c of ["supply", "planItems", "cookEvents", "ratings", "stats", "groceryLists", "commands", "favourites", "notes", "cadence", "periods", "stores"]) {
      await assertFails(getDoc(doc(a, `households/hB/${c}/x`)));
      await assertFails(getDocs(collection(a, `households/hB/${c}`)));
    }
    await assertFails(getDoc(doc(a, "households/hB/supply/x/transactions/t")));
    await assertFails(getDocs(collectionGroup(a, "transactions")));
    await assertFails(getDocs(collectionGroup(a, "ratings")));
    await assertFails(getDocs(collectionGroup(a, "supply")));
  });
});
