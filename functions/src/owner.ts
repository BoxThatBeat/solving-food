// The project owner (OWNER_UID, SETUP.md) may change app-wide settings: the PC Express key (R6.28) and the Gemini key
// (R4.36), and run Check names (R4.27). Under the emulator a test names its owner per household in
// `_stubPcx/{hid}` { ownerUid } (the real owner's uid isn't a test user).
import { db } from "./admin";
import { isEmulator } from "./pcx/client";

export async function isOwner(uid: string, hid: string, ownerUid: string | null): Promise<boolean> {
  if (ownerUid && uid === ownerUid) return true;
  if (!isEmulator()) return false;
  const o = (await db.doc(`_stubPcx/${hid}`).get().catch(() => null))?.data()?.ownerUid;
  return typeof o === "string" && o === uid;
}
