// Household data download & import on the client (TECHNICAL_SPECS §13, PRD R11.10). The download reads the household
// through the Firestore SDK and zips it in the browser (packages/core export.ts); the import uploads the zip to
// imports/{hid}/ and writes an importHousehold command, which the function applies.
import { collection, doc, getCountFromServer, getDoc, getDocs } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import {
  buildExport,
  EXPORT_COLLECTIONS,
  exportFileName,
  gatherExport,
  zipExport,
  type ExportProgress,
  type ExportReader,
} from "@solving-food/core";
import { db, storage } from "@/firebase/app";
import { sendCommand } from "./supply";

function reader(hid: string): ExportReader {
  const all = async (...path: string[]) => (await getDocs(collection(db, "households", hid, ...path))).docs.map((d) => ({ id: d.id, data: d.data() }));
  return {
    household: async () => (await getDoc(doc(db, "households", hid))).data() ?? null,
    list: (c) => all(c),
    transactions: (supplyId) => all("supply", supplyId, "transactions"),
    recipe: async (id) => (await getDoc(doc(db, "recipes", id))).data() ?? null,
    meal: async (id) => (await getDoc(doc(db, "meals", id))).data() ?? null,
  };
}

/**
 * About how many document reads a download costs: count queries per collection and per supply item's history (each
 * count costs one read per 1,000 entries), plus the referenced recipes, guessed from the plan's size.
 */
export async function estimateExportReads(hid: string): Promise<number> {
  const count = async (...path: string[]) => (await getCountFromServer(collection(db, "households", hid, ...path))).data().count;
  const counts = await Promise.all(EXPORT_COLLECTIONS.map((c) => count(c)));
  const supply = await getDocs(collection(db, "households", hid, "supply"));
  const txs = await Promise.all(supply.docs.map((d) => count("supply", d.id, "transactions")));
  const docs = 1 + counts.reduce((a, b) => a + b, 0) + supply.size + txs.reduce((a, b) => a + b, 0);
  const recipes = Math.min(200, Math.ceil((counts[EXPORT_COLLECTIONS.indexOf("planItems")] ?? 0) * 0.6));
  return docs + recipes;
}

/** Reads, zips, and saves the household's data as `solving-food-<household>-<date>.zip`. */
export async function downloadHouseholdData(hid: string, householdName: string, timezone: string, progress: ExportProgress): Promise<{ fileName: string; bytes: number }> {
  const now = Date.now();
  const input = await gatherExport(hid, reader(hid), now, progress);
  const zip = zipExport(buildExport(input));
  const fileName = exportFileName(householdName, now, timezone);
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return { fileName, bytes: zip.byteLength };
}

/** Uploads the export and writes the importHousehold command; returns the command ID to follow. */
export async function startImport(hid: string, uid: string, bytes: Uint8Array): Promise<string> {
  const path = `imports/${hid}/${crypto.randomUUID()}.zip`;
  await uploadBytes(ref(storage, path), bytes, { contentType: "application/zip" });
  return sendCommand(hid, uid, "importHousehold", { path });
}
