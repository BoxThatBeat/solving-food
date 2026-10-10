// Storage rules (TECHNICAL_SPECS §10): public recipe images with allowlisted WebP uploads ≤ 2 MB; the drop folder takes
// .cook files ≤ 1 MB and images ≤ 10 MB in the uploader's own folder; nothing else.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, ref, uploadBytes, uploadString, type FirebaseStorage } from "firebase/storage";
import { doc, setDoc, type Firestore } from "firebase/firestore";

const storageRules = readFileSync(fileURLToPath(new URL("../../storage.rules", import.meta.url)), "utf8");
const firestoreRules = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199").split(":");
const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
let env: RulesTestEnvironment;

const ALICE = { uid: "alice", email: "alice@example.com" };
const EVE = { uid: "eve", email: "eve@example.com" };
const st = (u: { uid: string; email: string }) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).storage() as unknown as FirebaseStorage;
const anon = () => env.unauthenticatedContext().storage() as unknown as FirebaseStorage;
const bytes = (n: number) => new Uint8Array(n);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "solvingfood",
    storage: { rules: storageRules, host: host ?? "127.0.0.1", port: Number(port ?? 9199) },
    firestore: { rules: firestoreRules, host: fsHost ?? "127.0.0.1", port: Number(fsPort ?? 8080) },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, "allowlist", ALICE.email), { addedBy: "seed", addedAt: new Date() });
  });
});

describe("recipe images", () => {
  it("allowlisted users upload WebP ≤ 2 MB; anyone reads (share links)", async () => {
    await assertSucceeds(uploadBytes(ref(st(ALICE), "recipes/r1/img1/480.webp"), bytes(1000), { contentType: "image/webp" }));
    await assertSucceeds(getBytes(ref(anon(), "recipes/r1/img1/480.webp")));
    // Safari can't encode WebP from a canvas; its JPEG variants are accepted too.
    await assertSucceeds(uploadBytes(ref(st(ALICE), "recipes/r1/img2/480.webp"), bytes(1000), { contentType: "image/jpeg" }));
    await assertSucceeds(deleteObject(ref(st(ALICE), "recipes/r1/img1/480.webp")));
  });

  it("refuses non-allowlisted users, signed-out uploads, other types, and big files", async () => {
    await assertFails(uploadBytes(ref(st(EVE), "recipes/r1/img1/480.webp"), bytes(10), { contentType: "image/webp" }));
    await assertFails(uploadBytes(ref(anon(), "recipes/r1/img1/480.webp"), bytes(10), { contentType: "image/webp" }));
    await assertFails(uploadBytes(ref(st(ALICE), "recipes/r1/img1/480.png"), bytes(10), { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(st(ALICE), "recipes/r1/img1/480.webp"), bytes(10), { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(st(ALICE), "recipes/r1/img1/1920.webp"), bytes(2 * 1024 * 1024 + 1), { contentType: "image/webp" }));
  });
});

describe("drop folder (R4.16)", () => {
  it("the owner uploads .cook files ≤ 1 MB and images ≤ 10 MB into their own folder", async () => {
    await assertSucceeds(uploadString(ref(st(ALICE), "recipe-drop/alice/baked-feta-pasta.cook"), "---\ntitle: x\n---\n"));
    await assertSucceeds(uploadBytes(ref(st(ALICE), "recipe-drop/alice/Pasted image 1.png"), bytes(3_000_000), { contentType: "image/png" }));
  });

  it("refuses other folders, other file types, big files, non-allowlisted users", async () => {
    await assertFails(uploadString(ref(st(ALICE), "recipe-drop/bob/x.cook"), "x"));
    await assertFails(uploadString(ref(st(ALICE), "recipe-drop/alice/x.txt"), "x", undefined, { contentType: "text/plain" }));
    await assertFails(uploadBytes(ref(st(ALICE), "recipe-drop/alice/x.cook"), bytes(1024 * 1024 + 1)));
    await assertFails(uploadBytes(ref(st(ALICE), "recipe-drop/alice/x.png"), bytes(10 * 1024 * 1024 + 1), { contentType: "image/png" }));
    await assertFails(uploadString(ref(st(EVE), "recipe-drop/eve/x.cook"), "x"));
  });

  it("nobody reads or deletes drop files from a client (functions only)", async () => {
    await assertFails(getBytes(ref(st(ALICE), "recipe-drop/alice/baked-feta-pasta.cook")));
    await assertFails(deleteObject(ref(st(ALICE), "recipe-drop/alice/baked-feta-pasta.cook")));
  });
});

describe("household data imports (M4, §13)", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "households", "h1", "members", ALICE.uid), { uid: ALICE.uid, displayName: "Alice", joinedAt: new Date() });
    });
  });

  it("a member uploads one zip ≤ 20 MB into their household's folder; nobody reads or deletes it", async () => {
    await assertSucceeds(uploadBytes(ref(st(ALICE), "imports/h1/0f1e2d3c.zip"), bytes(1000), { contentType: "application/zip" }));
    await assertFails(getBytes(ref(st(ALICE), "imports/h1/0f1e2d3c.zip")));
    await assertFails(deleteObject(ref(st(ALICE), "imports/h1/0f1e2d3c.zip")));
  });

  it("refuses other households, other types, big files, and odd names", async () => {
    await assertFails(uploadBytes(ref(st(ALICE), "imports/h2/x.zip"), bytes(10), { contentType: "application/zip" }));
    await assertFails(uploadBytes(ref(st(ALICE), "imports/h1/x.zip"), bytes(20 * 1024 * 1024 + 1), { contentType: "application/zip" }));
    await assertFails(uploadBytes(ref(st(ALICE), "imports/h1/x.html"), bytes(10), { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(st(ALICE), "imports/h1/x.zip"), bytes(10), { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(st(EVE), "imports/h1/x.zip"), bytes(10), { contentType: "application/zip" }));
  });
});

describe("everything else", () => {
  it("is denied", async () => {
    await assertFails(uploadString(ref(st(ALICE), "imports/h1/x.json"), "{}"));
    await assertFails(getBytes(ref(anon(), "other/x")));
  });
});
