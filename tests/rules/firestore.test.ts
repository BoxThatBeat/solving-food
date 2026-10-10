// Firestore rules, M0 subset (Planning/M0 "Tests → Rules", TECHNICAL_SPECS §14).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
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
const EVE = { uid: "eve", email: "eve@example.com" }; // never allowlisted

const theme = { flavour: "latte", accent: "green" };

function dbAs(u: { uid: string; email: string }, verified = true): Firestore {
  return env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
}

function household(createdBy: string, extra: Record<string, unknown> = {}) {
  return {
    name: "Silbrass Pvt",
    createdBy,
    periodDays: 7,
    budgetCents: 20000,
    currency: "CAD",
    timezone: "America/Toronto",
    defaultServings: 4,
    plannedMealTypes: ["breakfast", "lunch", "dinner"],
    pcxStoreId: "loblaws-greenbank-road",
    currentPeriodId: null,
    settings: { scoreWeights: {}, tools: [], preferences: { likes: [], dislikes: [], diets: [] }, proteinGoals: {} },
    createdAt: serverTimestamp(),
    ...extra,
  };
}

/** The client's first-household batch (apps/web/src/routes/welcome/household.tsx). */
function createHouseholdBatch(db: Firestore, uid: string, hid: string, opts: { bump?: number; hh?: object; member?: object } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "households", hid), opts.hh ?? household(uid));
  b.set(doc(db, "households", hid, "members", uid), opts.member ?? { uid, displayName: "Alice", joinedAt: serverTimestamp() });
  b.update(doc(db, "users", uid), { householdsCreated: increment(opts.bump ?? 1), activeHouseholdId: hid });
  return b;
}

async function seed(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

async function allowlist(...emails: string[]) {
  await seed(async (db) => {
    for (const e of emails) await setDoc(doc(db, "allowlist", e), { addedBy: "seed", addedAt: new Date() });
  });
}

async function profile(u: { uid: string; email: string }, householdsCreated = 0) {
  await seed(async (db) => {
    await setDoc(doc(db, "users", u.uid), { email: u.email, activeHouseholdId: null, householdsCreated, theme });
    await setDoc(doc(db, "directory", u.uid), { displayName: u.uid, displayNameLower: u.uid });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "solvingfood",
    firestore: { rules, host: host ?? "127.0.0.1", port: Number(port ?? 8080) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await allowlist(ALICE.email, BOB.email);
});

describe("allowlist gate (R2.12, NFR4)", () => {
  it("a signed-in but non-allowlisted user can read and create nothing", async () => {
    await profile(ALICE, 1);
    await seed(async (db) => {
      await setDoc(doc(db, "households", "h1"), household(ALICE.uid));
      await setDoc(doc(db, "households", "h1", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: new Date() });
    });
    const db = dbAs(EVE);
    await assertFails(setDoc(doc(db, "users", EVE.uid), { email: EVE.email, activeHouseholdId: null, householdsCreated: 0, theme, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "directory", EVE.uid), { displayName: "Eve", displayNameLower: "eve" }));
    await assertFails(getDoc(doc(db, "users", EVE.uid)));
    await assertFails(getDocs(collection(db, "directory")));
    await assertFails(getDoc(doc(db, "households", "h1")));
    await assertFails(getDocs(query(collectionGroup(db, "members"), where("uid", "==", EVE.uid))));
    await assertFails(setDoc(doc(db, "allowlist", "friend@example.com"), { addedBy: EVE.uid, addedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "allowlist", EVE.email), { addedBy: EVE.uid, addedAt: serverTimestamp() }));
    await assertFails(createHouseholdBatch(db, EVE.uid, "h2").commit());
  });

  it("can check its own allowlist entry (and finds none), but not anyone else's", async () => {
    await assertSucceeds(getDoc(doc(dbAs(EVE), "allowlist", EVE.email)));
    await assertFails(getDoc(doc(dbAs(EVE), "allowlist", ALICE.email)));
  });

  it("an unverified address is not allowed even when its email is allowlisted", async () => {
    const db = dbAs(ALICE, false);
    await assertFails(getDoc(doc(db, "allowlist", ALICE.email)));
    await assertFails(setDoc(doc(db, "users", ALICE.uid), { email: ALICE.email, activeHouseholdId: null, householdsCreated: 0, theme, createdAt: serverTimestamp() }));
  });

  it("signed-out visitors get nothing", async () => {
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(db, "allowlist", ALICE.email)));
    await assertFails(getDocs(collection(db, "directory")));
  });
});

describe("allowlist", () => {
  it("allowlisted users read only their own entry, and nobody lists it", async () => {
    await assertSucceeds(getDoc(doc(dbAs(ALICE), "allowlist", ALICE.email)));
    await assertFails(getDoc(doc(dbAs(ALICE), "allowlist", BOB.email)));
    await assertFails(getDocs(collection(dbAs(ALICE), "allowlist")));
  });

  it("allowlisted users can add a lower-cased address as themselves (invite by email)", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "allowlist", "friend@example.com"), { addedBy: ALICE.uid, addedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "allowlist", "other@example.com"), { addedBy: BOB.uid, addedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "allowlist", "Upper@Example.com"), { addedBy: ALICE.uid, addedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "allowlist", "x@example.com"), { addedBy: ALICE.uid, addedAt: serverTimestamp(), admin: true }));
  });

  it("entries can't be changed or removed by clients", async () => {
    await assertFails(updateDoc(doc(dbAs(ALICE), "allowlist", ALICE.email), { addedBy: ALICE.uid }));
    await assertFails(deleteDoc(doc(dbAs(ALICE), "allowlist", BOB.email)));
  });
});

describe("users (private to the user)", () => {
  const newUser = (u: typeof ALICE, extra: Record<string, unknown> = {}) => ({
    email: u.email,
    activeHouseholdId: null,
    householdsCreated: 0,
    theme,
    createdAt: serverTimestamp(),
    ...extra,
  });

  it("first run creates your own doc with a zero counter", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "users", ALICE.uid), newUser(ALICE)));
  });

  it("rejects someone else's doc, a non-zero counter, a wrong email, or a bad theme", async () => {
    const db = dbAs(ALICE);
    await assertFails(setDoc(doc(db, "users", BOB.uid), newUser(BOB)));
    await assertFails(setDoc(doc(db, "users", ALICE.uid), newUser(ALICE, { householdsCreated: 1 })));
    await assertFails(setDoc(doc(db, "users", ALICE.uid), newUser(ALICE, { email: BOB.email })));
    await assertFails(setDoc(doc(db, "users", ALICE.uid), newUser(ALICE, { theme: { flavour: "dracula", accent: "green" } })));
  });

  it("is readable only by its owner", async () => {
    await profile(ALICE);
    await assertSucceeds(getDoc(doc(dbAs(ALICE), "users", ALICE.uid)));
    await assertFails(getDoc(doc(dbAs(BOB), "users", ALICE.uid)));
  });

  it("theme and active household are editable; email isn't", async () => {
    await profile(ALICE);
    const db = dbAs(ALICE);
    await assertSucceeds(updateDoc(doc(db, "users", ALICE.uid), { theme: { flavour: "mocha", accent: "peach" } }));
    await assertSucceeds(updateDoc(doc(db, "users", ALICE.uid), { activeHouseholdId: "h9" }));
    await assertFails(updateDoc(doc(db, "users", ALICE.uid), { theme: { flavour: "mocha", accent: "neon" } }));
    await assertFails(updateDoc(doc(db, "users", ALICE.uid), { email: "new@example.com" }));
    await assertFails(updateDoc(doc(dbAs(BOB), "users", ALICE.uid), { theme }));
  });

  it("the household counter can't be decremented or bumped without creating a household", async () => {
    await profile(ALICE, 2);
    const db = dbAs(ALICE);
    await assertFails(updateDoc(doc(db, "users", ALICE.uid), { householdsCreated: 1 }));
    await assertFails(updateDoc(doc(db, "users", ALICE.uid), { householdsCreated: 3, activeHouseholdId: "nope" }));
  });
});

describe("directory (readable by allowlisted users only)", () => {
  it("allowlisted users read it; others don't", async () => {
    await profile(ALICE);
    await assertSucceeds(getDoc(doc(dbAs(BOB), "directory", ALICE.uid)));
    await assertSucceeds(getDocs(collection(dbAs(BOB), "directory")));
    await assertFails(getDoc(doc(dbAs(EVE), "directory", ALICE.uid)));
  });

  it("you write only your own entry, with a matching lower-case name", async () => {
    const db = dbAs(ALICE);
    await assertSucceeds(setDoc(doc(db, "directory", ALICE.uid), { displayName: "Alice B", displayNameLower: "alice b" }));
    await assertFails(setDoc(doc(db, "directory", BOB.uid), { displayName: "Bob", displayNameLower: "bob" }));
    await assertFails(setDoc(doc(db, "directory", ALICE.uid), { displayName: "Alice", displayNameLower: "ALICE" }));
    await assertFails(setDoc(doc(db, "directory", ALICE.uid), { displayName: "   ", displayNameLower: "   " }));
    await assertFails(setDoc(doc(db, "directory", ALICE.uid), { displayName: "x".repeat(41), displayNameLower: "x".repeat(41) }));
  });
});

describe("household creation (R2.3)", () => {
  it("the first-household batch succeeds", async () => {
    await profile(ALICE);
    await assertSucceeds(createHouseholdBatch(dbAs(ALICE), ALICE.uid, "h1").commit());
  });

  it("the counter must go up by exactly 1 in the same batch", async () => {
    await profile(ALICE);
    const db = dbAs(ALICE);
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { bump: 2 }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { bump: 0 }).commit());
    // Household + member without touching the counter.
    const b = writeBatch(db);
    b.set(doc(db, "households", "h1"), household(ALICE.uid));
    b.set(doc(db, "households", "h1", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: serverTimestamp() });
    await assertFails(b.commit());
  });

  it("allows a third household and refuses a fourth", async () => {
    await profile(ALICE, 2);
    await assertSucceeds(createHouseholdBatch(dbAs(ALICE), ALICE.uid, "h3").commit());
    await assertFails(createHouseholdBatch(dbAs(ALICE), ALICE.uid, "h4").commit());
  });

  it("needs a profile first", async () => {
    await assertFails(createHouseholdBatch(dbAs(ALICE), ALICE.uid, "h1").commit());
  });

  it("rejects a household created for someone else or with invalid fields", async () => {
    await profile(ALICE);
    const db = dbAs(ALICE);
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(BOB.uid) }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(ALICE.uid, { currency: "USD" }) }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(ALICE.uid, { plannedMealTypes: [] }) }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(ALICE.uid, { plannedMealTypes: ["snack"] }) }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(ALICE.uid, { defaultServings: 0 }) }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(ALICE.uid, { name: "" }) }).commit());
    await assertFails(createHouseholdBatch(db, ALICE.uid, "h1", { hh: household(ALICE.uid, { owner: ALICE.uid }) }).commit());
  });
});

describe("members (creator only, in the creation batch)", () => {
  beforeEach(async () => {
    await profile(ALICE, 1);
    await profile(BOB);
    await seed(async (db) => {
      await setDoc(doc(db, "households", "h1"), household(ALICE.uid));
      await setDoc(doc(db, "households", "h1", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: new Date() });
    });
  });

  it("the member doc must be for yourself", async () => {
    await profile(ALICE);
    await assertFails(
      createHouseholdBatch(dbAs(ALICE), ALICE.uid, "h2", { member: { uid: BOB.uid, displayName: "Bob", joinedAt: serverTimestamp() } }).commit(),
    );
  });

  it("nobody joins an existing household by writing a member doc, not even its creator", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households", "h1", "members", BOB.uid), { uid: BOB.uid, displayName: "Bob", joinedAt: serverTimestamp() }));
    await seed(async (db) => deleteDoc(doc(db, "households", "h1", "members", ALICE.uid)));
    await assertFails(setDoc(doc(dbAs(ALICE), "households", "h1", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: serverTimestamp() }));
  });

  it("a member doc alone (no household in the batch) is refused", async () => {
    await assertFails(setDoc(doc(dbAs(BOB), "households", "h9", "members", BOB.uid), { uid: BOB.uid, displayName: "Bob", joinedAt: serverTimestamp() }));
  });
});

describe("household isolation (R2.8, NFR4)", () => {
  beforeEach(async () => {
    await profile(ALICE, 1);
    await profile(BOB, 1);
    await seed(async (db) => {
      for (const [hid, u] of [["hA", ALICE], ["hB", BOB]] as const) {
        await setDoc(doc(db, "households", hid), household(u.uid));
        await setDoc(doc(db, "households", hid, "members", u.uid), { uid: u.uid, displayName: u.uid, joinedAt: new Date() });
      }
    });
  });

  it("members read their household and its members; others can't", async () => {
    await assertSucceeds(getDoc(doc(dbAs(ALICE), "households", "hA")));
    await assertSucceeds(getDocs(collection(dbAs(ALICE), "households", "hA", "members")));
    await assertFails(getDoc(doc(dbAs(ALICE), "households", "hB")));
    await assertFails(getDocs(collection(dbAs(ALICE), "households", "hB", "members")));
  });

  it("the my-households collection-group query works only for your own uid", async () => {
    await assertSucceeds(getDocs(query(collectionGroup(dbAs(ALICE), "members"), where("uid", "==", ALICE.uid))));
    await assertFails(getDocs(query(collectionGroup(dbAs(ALICE), "members"), where("uid", "==", BOB.uid))));
    await assertFails(getDocs(collectionGroup(dbAs(ALICE), "members")));
  });

  it("members update settings but can't change the creator; non-members can't update", async () => {
    await assertSucceeds(updateDoc(doc(dbAs(ALICE), "households", "hA"), { defaultServings: 2 }));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households", "hA"), { createdBy: BOB.uid }));
    await assertFails(updateDoc(doc(dbAs(ALICE), "households", "hA"), { currency: "USD" }));
    await assertFails(updateDoc(doc(dbAs(BOB), "households", "hA"), { defaultServings: 2 }));
  });

  it("households can't be deleted by clients", async () => {
    await assertFails(deleteDoc(doc(dbAs(ALICE), "households", "hA")));
  });
});

describe("everything not yet introduced is denied", () => {
  it("unknown top-level and household collections", async () => {
    await profile(ALICE, 1);
    await seed(async (db) => {
      await setDoc(doc(db, "households", "hA"), household(ALICE.uid));
      await setDoc(doc(db, "households", "hA", "members", ALICE.uid), { uid: ALICE.uid, displayName: "a", joinedAt: new Date() });
    });
    const db = dbAs(ALICE);
    await assertFails(setDoc(doc(db, "recipes", "r1"), { title: "x" })); // invalid recipe, no version snapshot
    await assertFails(getDoc(doc(db, "prices", "p1")));
    await assertFails(setDoc(doc(db, "meals", "m1"), { name: "x" }));
    await assertFails(setDoc(doc(db, "households", "hA", "supply", "s1"), { canonicalAmount: 1 }));
    await assertFails(setDoc(doc(db, "households", "hA", "planItems", "p1"), { status: "planned" }));
    await assertFails(setDoc(doc(db, "users", ALICE.uid, "notifications", "n1"), { message: "x" }));
  });
});
