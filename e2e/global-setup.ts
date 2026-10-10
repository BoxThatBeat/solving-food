// Fails fast with a useful message when the Emulator Suite isn't running (use `pnpm e2e` from the repo root).
import { AUTH_EMULATOR, FIRESTORE_EMULATOR } from "./fixtures/emulator";

async function up(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const checks = [`http://${AUTH_EMULATOR}/`, `http://${FIRESTORE_EMULATOR}/`];
  const deadline = Date.now() + 30_000;
  for (const url of checks) {
    while (!(await up(url))) {
      if (Date.now() > deadline) {
        throw new Error(`Emulator not reachable at ${url}. Run the suite with \`pnpm e2e\` from the repo root.`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
