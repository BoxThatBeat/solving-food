// Storage rules: M0 denies everything (recipe images, drop folder, imports arrive in M1/M4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadString, type FirebaseStorage } from "firebase/storage";

const rules = readFileSync(fileURLToPath(new URL("../../storage.rules", import.meta.url)), "utf8");
const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199").split(":");
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "solvingfood",
    storage: { rules, host: host ?? "127.0.0.1", port: Number(port ?? 9199) },
  });
});
afterAll(async () => env?.cleanup());

describe("storage (M0: deny all)", () => {
  it("signed-in users can't upload or read anything", async () => {
    const st = env.authenticatedContext("alice", { email: "alice@example.com", email_verified: true }).storage() as unknown as FirebaseStorage;
    await assertFails(uploadString(ref(st, "recipe-drop/alice/x.cook"), ">> title: x"));
    await assertFails(uploadString(ref(st, "recipes/r1/480.webp"), "x"));
    await assertFails(getBytes(ref(st, "recipes/r1/480.webp")));
  });
});
