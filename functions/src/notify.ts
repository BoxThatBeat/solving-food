// The notification helper (TECHNICAL_SPECS §12 "<NotificationBanners>", PRD R12.1): every function that reports to a
// user writes users/{uid}/notifications/{id}. `dismissedAt: null` is written explicitly so the client's
// `where("dismissedAt", "==", null)` listener matches (Firestore equality never matches a missing field).
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

export type NotificationKind = "info" | "success" | "error";

export interface Notice {
  kind: NotificationKind;
  message: string;
  /** An in-app path, e.g. `/recipes/abc`. */
  link?: string;
  /** A second link with its label (M8: an import that created ingredients links to their review too). */
  link2?: { to: string; label: string };
}

const MAX_MESSAGE = 500;

export async function notify(uid: string, n: Notice): Promise<string> {
  const ref = db.collection("users").doc(uid).collection("notifications").doc();
  const data: Record<string, unknown> = {
    kind: n.kind,
    message: n.message.length > MAX_MESSAGE ? `${n.message.slice(0, MAX_MESSAGE - 1)}…` : n.message,
    createdAt: FieldValue.serverTimestamp(),
    dismissedAt: null,
  };
  if (n.link) data.link = n.link;
  if (n.link2) data.link2 = n.link2;
  await ref.set(data);
  return ref.id;
}
