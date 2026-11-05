// The project owner (OWNER_UID, SETUP.md) may change app-wide settings: the PC Express key (R6.28) and the Gemini key
// (R4.36), run Check names (R4.27) and merge ingredients (R4.35, M22). Under the Functions emulator a test names its
// owner per household in `_stubPcx/{hid}` { ownerUid } (the real owner's uid isn't a test user). That override depends
// on the real emulator flag only (FUNCTIONS_EMULATOR, set by the emulator itself), never on PCX_STUB, which only picks
// the PC Express and Gemini stubs (M22: a stray PCX_STUB in production must not let anyone name themselves owner).
import { db } from "./admin";

export const functionsEmulator = (): boolean => process.env.FUNCTIONS_EMULATOR === "true";

export async function isOwner(uid: string, hid: string, ownerUid: string | null): Promise<boolean> {
  if (ownerUid && uid === ownerUid) return true;
  if (!functionsEmulator() || !hid || hid.includes("/")) return false;
  const o = (await db.doc(`_stubPcx/${hid}`).get().catch(() => null))?.data()?.ownerUid;
  return typeof o === "string" && o === uid;
}
