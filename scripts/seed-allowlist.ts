// Adds addresses to the sign-up allowlist (R2.12), bypassing rules (admin credentials).
//
//   pnpm seed:allowlist                         # live project: the owner's entry (buitenwerfa@gmail.com)
//   pnpm seed:allowlist -- --email a@b.ca       # live project: another address
//   pnpm seed:allowlist:emulator [-- --email …] # the local Firestore emulator
//
// Live credentials: Application Default Credentials if present (`gcloud auth application-default login`) via the
// Admin SDK; otherwise the gcloud CLI's own login (`gcloud auth print-access-token`) against the Firestore REST API.
// Never used in tests.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "solvingfood";
const OWNER_EMAIL = "buitenwerfa@gmail.com";

const args = process.argv.slice(2);
const emulator = args.includes("--emulator");
const emails = args.flatMap((a, i) => (args[i - 1] === "--email" ? [a.trim().toLowerCase()] : []));
if (emails.length === 0) emails.push(OWNER_EMAIL);
const where = emulator ? "emulator" : "live";

function hasAdc(): boolean {
  return (
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json"))
  );
}

async function viaAdmin(): Promise<void> {
  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  for (const email of emails) {
    const ref = db.collection("allowlist").doc(email);
    if ((await ref.get()).exists) {
      console.log(`allowlist/${email} already exists (${where})`);
      continue;
    }
    await ref.set({ addedBy: "seed-allowlist", addedAt: FieldValue.serverTimestamp() });
    console.log(`allowlist/${email} created (${where})`);
  }
}

async function viaRest(): Promise<void> {
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/allowlist`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": PROJECT_ID };
  for (const email of emails) {
    const got = await fetch(`${base}/${encodeURIComponent(email)}`, { headers });
    if (got.ok) {
      console.log(`allowlist/${email} already exists (${where})`);
      continue;
    }
    if (got.status !== 404) throw new Error(`GET allowlist/${email}: ${got.status} ${await got.text()}`);
    const res = await fetch(`${base}?documentId=${encodeURIComponent(email)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        fields: { addedBy: { stringValue: "seed-allowlist" }, addedAt: { timestampValue: new Date().toISOString() } },
      }),
    });
    if (!res.ok) throw new Error(`create allowlist/${email}: ${res.status} ${await res.text()}`);
    console.log(`allowlist/${email} created (${where})`);
  }
}

if (emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  await viaAdmin();
} else {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  await (hasAdc() ? viaAdmin() : viaRest());
}
