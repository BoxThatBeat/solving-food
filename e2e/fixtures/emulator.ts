// Emulator endpoints and the Auth emulator's out-of-band code API (TECHNICAL_SPECS §14.1 "Sign-in").
export const PROJECT_ID = "solvingfood";
export const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
export const FIRESTORE_EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

interface OobCode {
  email: string;
  oobCode: string;
  oobLink: string;
  requestType: string;
}

/** The newest email-sign-in link the Auth emulator "sent" to this address. */
export async function latestSignInLink(email: string, timeoutMs = 10_000): Promise<OobCode> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
    const { oobCodes = [] } = (await res.json()) as { oobCodes?: OobCode[] };
    const mine = oobCodes.filter((c) => c.email === email && c.requestType === "EMAIL_SIGNIN");
    const last = mine.at(-1);
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`No sign-in link for ${email}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * What the real email link does after Firebase's action handler: open the continue URL with the code attached.
 * The emulator's oobLink points at its own action page, so the app URL is rebuilt from its parameters.
 */
export function appLinkFrom(oob: OobCode): string {
  const link = new URL(oob.oobLink);
  const target = new URL(link.searchParams.get("continueUrl") ?? "/sign-in/finish", "http://localhost:4173");
  for (const k of ["mode", "oobCode", "apiKey", "lang"]) {
    const v = link.searchParams.get(k);
    if (v) target.searchParams.set(k, v);
  }
  return target.toString();
}

/** Wipes all Firestore emulator data. Global: only safe when nothing else is running against the emulator. */
export async function resetFirestore(): Promise<void> {
  await fetch(`http://${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: "DELETE",
  });
}
