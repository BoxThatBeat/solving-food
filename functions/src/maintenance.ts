// Weekly maintenance (TECHNICAL_SPECS §4.4, §13; Planning/M1 §8). M1: purge recipes trashed more than 30 days ago
// (each delete triggers the cleanup function), sweep drop-folder leftovers older than a day (images nobody's recipe
// used), and drop old import logs. M2: refresh stale index summaries. M5: the weekly PC Express price refresh, in this
// same function (one Cloud Scheduler job, §2). M22: stuck commands failed, applied commands and dismissed notifications
// older than 30 days pruned, orphaned uploads (recipe-photos/, imports/, recipes/{id}/ without a recipe) swept after 3
// days, and a run record in `system/maintenance` that tells the owner when the job fails twice in a row.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { bucket, db } from "./admin";
import { failStuckCommands } from "./commands";
import { notify } from "./notify";
import { isIndexed, recipeSummary, type RecipeDoc } from "@solving-food/core";
import { DROP_PREFIX } from "./dropFolder";
import { sameSummary, type IndexChunk } from "./recipeIndex";
import { refreshPrices, type RefreshReport } from "./pcx";

export const TRASH_DAYS = 30;
/** Applied / failed commands and dismissed notifications are kept this long (§13 "Retention"). */
export const RETENTION_DAYS = 30;
/** Uploads nothing claimed (failed imports, Add with Gemini photos, images of recipes never saved) go after this. */
export const ORPHAN_DAYS = 3;
const DAY = 86_400_000;
/** Function-only: { lastRunAt, lastStatus, lastError?, consecutiveFailures }. */
export const MAINTENANCE_DOC = "system/maintenance";

export interface MaintenanceReport {
  purged: string[];
  dropFilesSwept: number;
  importLogsDeleted: number;
  summariesRefreshed: number;
  stuckCommandsFailed: number;
  commandsPruned: number;
  notificationsPruned: number;
  orphanFilesSwept: number;
  prices?: RefreshReport | { status: "error"; error: string };
}

/**
 * Rewrites index summaries that differ from what `recipeSummary` makes of the recipe now (M2 added `tools` and
 * `lines`; summaries written before that are refreshed here instead of by a one-off script). Reads every active
 * recipe once a week: ~30–2,000 reads, well inside the free tier.
 */
export async function refreshSummaries(): Promise<number> {
  const chunks = await db.collection("recipeIndex").get();
  const byChunk = new Map(chunks.docs.map((d) => [Number(d.id), d.data() as IndexChunk]));
  const recipes = await db.collection("recipes").where("status", "==", "active").get();
  const updates = new Map<number, Record<string, unknown>>();
  for (const r of recipes.docs) {
    const doc = r.data() as RecipeDoc;
    if (typeof doc.indexChunk !== "number" || !isIndexed(doc.status)) continue;
    const want = recipeSummary(r.id, doc);
    const have = byChunk.get(doc.indexChunk)?.recipes?.[r.id];
    if (sameSummary(have, want)) continue;
    if (!updates.has(doc.indexChunk)) updates.set(doc.indexChunk, {});
    updates.get(doc.indexChunk)![`recipes.${r.id}`] = want;
  }
  let n = 0;
  for (const [chunk, u] of updates) {
    if (!byChunk.has(chunk)) continue; // the index function creates chunks
    await db.collection("recipeIndex").doc(String(chunk)).update(u);
    n += Object.keys(u).length;
  }
  return n;
}

function millis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") return (v as { toMillis(): number }).toMillis();
  return null;
}

const created = (f: { metadata: { timeCreated?: string | number } }) => Date.parse(String(f.metadata.timeCreated ?? ""));

/**
 * Per household (a handful): fails stuck commands (§6, the same check as the dispatcher's fast path) and deletes applied
 * or failed commands older than RETENTION_DAYS (nothing reads them after the banner; the ledger is in transactions).
 */
export async function sweepCommands(now: number): Promise<{ stuck: number; pruned: number }> {
  let stuck = 0;
  let pruned = 0;
  const cutoff = Timestamp.fromMillis(now - RETENTION_DAYS * DAY);
  for (const h of await db.collection("households").listDocuments()) {
    const open = await h.collection("commands").where("status", "in", ["pending", "running"]).get();
    stuck += await failStuckCommands(open.docs, now);
    const old = await h.collection("commands").where("appliedAt", "<", cutoff).get();
    const w = db.bulkWriter();
    for (const d of old.docs) {
      if (d.data().status !== "applied" && d.data().status !== "failed") continue;
      void w.delete(d.ref);
      pruned++;
    }
    await w.close();
  }
  return { stuck, pruned };
}

/** Notifications dismissed more than RETENTION_DAYS ago (undismissed ones stay until read). */
export async function pruneNotifications(now: number): Promise<number> {
  let n = 0;
  const cutoff = Timestamp.fromMillis(now - RETENTION_DAYS * DAY);
  for (const u of await db.collection("users").listDocuments()) {
    const old = await u.collection("notifications").where("dismissedAt", "<", cutoff).get();
    const w = db.bulkWriter();
    for (const d of old.docs) void w.delete(d.ref);
    await w.close();
    n += old.size;
  }
  return n;
}

/**
 * Uploads older than ORPHAN_DAYS that nothing will claim: `recipe-photos/` (Add with Gemini deletes its photo after the
 * call; one left means the call died), `imports/` (a successful import deletes its zip; a failed one keeps it for the
 * owner to look at, M22), and `recipes/{id}/…` images whose recipe doesn't exist (uploaded before M22's rule, or for
 * a recipe whose save failed).
 */
export async function sweepOrphanUploads(now: number): Promise<number> {
  let n = 0;
  const old = (f: { metadata: { timeCreated?: string | number } }) => {
    const c = created(f);
    return Number.isFinite(c) && c < now - ORPHAN_DAYS * DAY;
  };
  for (const prefix of ["recipe-photos/", "imports/"]) {
    const [files] = await bucket().getFiles({ prefix });
    for (const f of files) {
      if (!old(f)) continue;
      await f.delete({ ignoreNotFound: true });
      n++;
    }
  }
  const [images] = await bucket().getFiles({ prefix: "recipes/" });
  const byRecipe = new Map<string, typeof images>();
  for (const f of images) {
    const id = f.name.split("/")[1];
    if (!id) continue;
    if (!byRecipe.has(id)) byRecipe.set(id, []);
    byRecipe.get(id)!.push(f);
  }
  for (const [id, files] of byRecipe) {
    if (!files.every(old)) continue;
    if ((await db.doc(`recipes/${id}`).get()).exists) continue;
    for (const f of files) await f.delete({ ignoreNotFound: true });
    n += files.length;
  }
  return n;
}

export async function runMaintenance(now = Date.now(), opts: { ownerUid?: string | null; prices?: boolean } = {}): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { purged: [], dropFilesSwept: 0, importLogsDeleted: 0, summariesRefreshed: 0, stuckCommandsFailed: 0, commandsPruned: 0, notificationsPruned: 0, orphanFilesSwept: 0 };

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
    const c = created(f);
    if (Number.isFinite(c) && c < now - DAY) {
      await f.delete({ ignoreNotFound: true });
      report.dropFilesSwept++;
    }
  }

  const old = await db.collection("dropImports").where("startedAt", "<", Timestamp.fromMillis(now - TRASH_DAYS * DAY)).get();
  for (const d of old.docs) {
    await d.ref.delete();
    report.importLogsDeleted++;
  }

  report.summariesRefreshed = await refreshSummaries();
  const cmds = await sweepCommands(now);
  report.stuckCommandsFailed = cmds.stuck;
  report.commandsPruned = cmds.pruned;
  report.notificationsPruned = await pruneNotifications(now);
  report.orphanFilesSwept = await sweepOrphanUploads(now);
  if (opts.prices !== false) {
    try {
      report.prices = await refreshPrices(opts.ownerUid ?? null, now);
    } catch (e) {
      report.prices = { status: "error", error: (e as Error).message };
    }
  }
  return report;
}

/**
 * The scheduled job's body (§13 "Monitoring", M22): runs maintenance and records the run in `system/maintenance`. A
 * failure is logged and counted; the second failure in a row logs "maintenance failed twice" (the log-based alert in
 * SETUP.md matches it) and posts an error banner to the owner. A success resets the count. The error is rethrown so
 * Cloud Scheduler shows the run as failed.
 */
export async function runScheduledMaintenance(now = Date.now(), opts: { ownerUid?: string | null; prices?: boolean; run?: typeof runMaintenance } = {}): Promise<MaintenanceReport> {
  const ref = db.doc(MAINTENANCE_DOC);
  try {
    const report = await (opts.run ?? runMaintenance)(now, opts);
    await ref.set({ lastRunAt: Timestamp.fromMillis(now), lastStatus: "ok", lastError: FieldValue.delete(), consecutiveFailures: 0 }, { merge: true });
    return report;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    const prev = Number((await ref.get().catch(() => null))?.data()?.consecutiveFailures ?? 0);
    const failures = prev + 1;
    await ref.set({ lastRunAt: Timestamp.fromMillis(now), lastStatus: "failed", lastError: message.slice(0, 500), consecutiveFailures: failures }, { merge: true }).catch(() => undefined);
    if (failures >= 2) {
      logger.error("maintenance failed twice", { consecutiveFailures: failures, error: message });
      if (opts.ownerUid) {
        await notify(opts.ownerUid, { kind: "error", message: `The weekly maintenance failed ${failures} weeks in a row (${message}). Trash purge, cleanup and the price refresh wait until it runs; check the function logs.` }).catch(() => undefined);
      }
    } else logger.warn("maintenance failed", { error: message });
    throw e;
  }
}
