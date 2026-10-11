// Weekly maintenance (TECHNICAL_SPECS §4.4, §13; Planning/M1 §8). M1: purge recipes trashed more than 30 days ago
// (each delete triggers the cleanup function), sweep drop-folder leftovers older than a day (images nobody's recipe
// used), and drop old import logs. M2: refresh stale index summaries. M5: the weekly PC Express price refresh, in this
// same function (one Cloud Scheduler job, §2).
import { Timestamp } from "firebase-admin/firestore";
import { bucket, db } from "./admin";
import { isIndexed, recipeSummary, type RecipeDoc } from "@solving-food/core";
import { DROP_PREFIX } from "./dropFolder";
import type { IndexChunk } from "./recipeIndex";
import { refreshPrices, type RefreshReport } from "./pcx";

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export interface MaintenanceReport {
  purged: string[];
  dropFilesSwept: number;
  importLogsDeleted: number;
  summariesRefreshed: number;
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
    if (JSON.stringify(have) === JSON.stringify(want)) continue;
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

export async function runMaintenance(now = Date.now(), opts: { ownerUid?: string | null; prices?: boolean } = {}): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { purged: [], dropFilesSwept: 0, importLogsDeleted: 0, summariesRefreshed: 0 };

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

  report.summariesRefreshed = await refreshSummaries();
  if (opts.prices !== false) {
    try {
      report.prices = await refreshPrices(opts.ownerUid ?? null, now);
    } catch (e) {
      report.prices = { status: "error", error: (e as Error).message };
    }
  }
  return report;
}
