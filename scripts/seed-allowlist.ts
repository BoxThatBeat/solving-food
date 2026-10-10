// Adds addresses to the sign-up allowlist (R2.12), bypassing rules via the Admin SDK.
//
//   pnpm seed:allowlist                         # live project: the owner's entry (buitenwerfa@gmail.com)
//   pnpm seed:allowlist -- --email a@b.ca       # live project: another address
//   pnpm seed:allowlist:emulator [-- --email …] # the local Firestore emulator
//
// Live credentials: Application Default Credentials if present (`gcloud auth application-default login`),
// otherwise the gcloud CLI's own login via `gcloud auth print-access-token`. Never used in tests.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationDefault, initializeApp, type Credential } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "solvingfood";
const OWNER_EMAIL = "buitenwerfa@gmail.com";

const args = process.argv.slice(2);
const emulator = args.includes("--emulator");
const emails = args.flatMap((a, i) => (args[i - 1] === "--email" ? [a.trim().toLowerCase()] : []));
if (emails.length === 0) emails.push(OWNER_EMAIL);

function gcloudCredential(): Credential {
  return {
    async getAccessToken() {
      const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
      return { access_token: token, expires_in: 3000 };
    },
  };
}

function hasAdc(): boolean {
  return (
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json"))
  );
}

if (emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  initializeApp({ projectId: PROJECT_ID });
} else {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  initializeApp({ projectId: PROJECT_ID, credential: hasAdc() ? applicationDefault() : gcloudCredential() });
}

const db = getFirestore();
for (const email of emails) {
  const ref = db.collection("allowlist").doc(email);
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`allowlist/${email} already exists (${emulator ? "emulator" : "live"})`);
    continue;
  }
  await ref.set({ addedBy: "seed-allowlist", addedAt: FieldValue.serverTimestamp() });
  console.log(`allowlist/${email} created (${emulator ? "emulator" : "live"})`);
}
