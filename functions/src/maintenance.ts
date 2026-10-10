// Weekly maintenance (TECHNICAL_SPECS §4.4, §13; Planning/M1 §8). M1: purge recipes trashed more than 30 days ago
// (each delete triggers the cleanup function), sweep drop-folder leftovers older than a day (images nobody's recipe
// used), and drop old import logs. M5 adds the price refresh to this same function (one Cloud Scheduler job, §2).
import { Timestamp } from "firebase-admin/firestore";
import { bucket, db } from "./admin";
import { DROP_PREFIX } from "./dropFolder";

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export interface MaintenanceReport {
  purged: string[];
  dropFilesSwept: number;
  importLogsDeleted: number;
}

function millis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") return (v as { toMillis(): number }).toMillis();
  return null;
}

export async function runMaintenance(now = Date.now()): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { purged: [], dropFilesSwept: 0, importLogsDeleted: 0 };

  // Single-field query; the age filter runs here so no composite index is needed.
  const trashed = await db.collection("recipes").where("status", "==", "trashed").get();
  for (const d of trashed.docs) {
    const at = millis(d.data().trashedAt);
    if (at !== null && at < now - TRASH_DAYS * DAY) {
      await d.ref.delete();
      report.purged.push(d.id);
    }
  }

  const [files] = await bucket().getFiles({ prefix: DROP_PREFIX });
  for (const f of files) {
    const created = Date.parse(String(f.metadata.timeCreated ?? ""));
    if (Number.isFinite(created) && created < now - DAY) {
      await f.delete({ ignoreNotFound: true });
      report.dropFilesSwept++;
    }
  }

  const old = await db.collection("dropImports").where("startedAt", "<", Timestamp.fromMillis(now - TRASH_DAYS * DAY)).get();
  for (const d of old.docs) {
    await d.ref.delete();
    report.importLogsDeleted++;
  }
  return report;
}
