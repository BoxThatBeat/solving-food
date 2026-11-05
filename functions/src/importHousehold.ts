// The importHousehold command (TECHNICAL_SPECS §6, §13, PRD R11.10): replaces a household's data with an uploaded
// export. Runs outside the dispatcher's single transaction (an import writes far more than 500 documents):
//
//   1. claims the command (pending → running) so it runs once
//   2. downloads `imports/{hid}/…zip` (only this household's folder) and validates it with the shared zod schema
//   3. matches each referenced recipe by ID, then by fingerprint; missing ones are recreated from their .cook file
//      (M1 pipeline) under the original ID; missing saved meals are recreated too
//   4. writes the imported documents over the household's (same IDs: supply with its transactions, Σ transactions ==
//      amount, reconciled if not), and the household's settings (name and creator stay)
//   5. only then deletes the household's documents the import doesn't have (except members, invites, this command)
//   6. deletes the upload, marks the command applied, and notifies the importer
// M22: write-then-delete, so a failure part-way never leaves the household empty (it can leave old and imported
// documents side by side; importing the same file again finishes it), and the upload is deleted only on success: a
// failed import keeps it (its path is in the error banner) until the weekly maintenance sweeps imports/ (§13).
import { FieldValue, Timestamp, type CollectionReference, type DocumentReference } from "firebase-admin/firestore";
import {
  decodeValue,
  EXPORT_COLLECTIONS,
  ExportError,
  exportSummary,
  IMPORT_KEEPS,
  matchRecipe,
  readExportZip,
  reconcileSupply,
  remapExport,
  type ParsedExport,
} from "@solving-food/core";
import { bucket, db } from "./admin";
import { notify } from "./notify";
import { createRecipeFromCook } from "./dropFolder";

export interface ImportReport {
  status: "applied" | "failed" | "skipped";
  error?: string;
  result?: string;
  writes?: number;
  deletes?: number;
  recipesCreated?: number;
  recipesMatched?: number;
}

const decode = (v: unknown) => decodeValue(v, (ms) => Timestamp.fromMillis(ms)) as Record<string, unknown>;

class ImportFailure extends Error {}

export async function runImport(hid: string, cmdId: string, uid: string, path: string): Promise<ImportReport> {
  const cmdRef = db.doc(`households/${hid}/commands/${cmdId}`);
  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(cmdRef);
    if (s.data()?.status !== "pending") return false;
    tx.update(cmdRef, { status: "running", startedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return { status: "skipped" };

  const file = bucket().file(path);
  const finish = async (r: ImportReport, kept = false): Promise<ImportReport> => {
    if (r.status === "failed") {
      await cmdRef.update({ status: "failed", error: (r.error ?? "import failed").slice(0, 500), appliedAt: FieldValue.serverTimestamp() });
      const where = kept ? `. The uploaded file is kept for a few days at ${path}` : "";
      await notify(uid, { kind: "error", message: `Couldn't import household data: ${r.error}${where}`, link: "/settings/data" }).catch(() => undefined);
    } else {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      await cmdRef.update({ status: "applied", result: r.result ?? "", appliedAt: FieldValue.serverTimestamp() });
      await notify(uid, { kind: "success", message: `Household data imported. ${r.result ?? ""}`.trim(), link: "/plan" }).catch(() => undefined);
    }
    return r;
  };

  let own = false;
  try {
    // Only this household's import folder: a member of one household can't import another's upload.
    if (!path.startsWith(`imports/${hid}/`) || path.includes("..") || path.split("/").length !== 3) {
      throw new ImportFailure("the file isn't in this household's import folder");
    }
    own = true;
    const hRef = db.doc(`households/${hid}`);
    if (!(await hRef.get()).exists) throw new ImportFailure("household not found");
    const [exists] = await file.exists();
    if (!exists) throw new ImportFailure("the uploaded file is gone; try again");
    const [buf] = await file.download();
    let parsed: ParsedExport;
    try {
      parsed = readExportZip(new Uint8Array(buf));
    } catch (e) {
      if (e instanceof ExportError) throw new ImportFailure(e.message);
      throw e;
    }

    const recipes = await resolveRecipes(parsed, uid);
    const meals = await resolveMeals(parsed, uid, recipes.map);
    const exp = remapExport(parsed.export, recipes.map, new Map());

    const written = new Set<string>();
    const writes = await writeExport(hRef, exp, written);
    const deletes = await pruneHousehold(hRef, cmdId, written);
    const s = exportSummary({ export: exp, meals: parsed.meals });
    const created = recipes.created + meals.created;
    const result =
      `${s.counts.planItems} plan items, ${s.counts.supply} supply items, ${s.counts.cookEvents} cooked meals` +
      (created ? `; ${recipes.created} recipe${recipes.created === 1 ? "" : "s"} and ${meals.created} meal${meals.created === 1 ? "" : "s"} recreated` : "") +
      ".";
    console.info("importHousehold", { hid, cmdId, writes, deletes, recipesCreated: recipes.created, recipesMatched: recipes.matched, mealsCreated: meals.created });
    return finish({ status: "applied", result, writes, deletes, recipesCreated: recipes.created, recipesMatched: recipes.matched });
  } catch (e) {
    const msg = e instanceof ImportFailure ? e.message : "something went wrong on the server; try again";
    if (!(e instanceof ImportFailure)) console.error("importHousehold failed", { hid, cmdId, error: e });
    return finish({ status: "failed", error: msg }, own && (await file.exists().then(([x]) => x).catch(() => false)));
  }
}

/** Exported recipe ID → the ID to use here. Same ID if it exists, else a fingerprint match, else recreate it. */
async function resolveRecipes(p: ParsedExport, uid: string): Promise<{ map: Map<string, string>; created: number; matched: number }> {
  const map = new Map<string, string>();
  let created = 0;
  let matched = 0;
  for (const r of p.export.recipes) {
    const exists = (await db.doc(`recipes/${r.id}`).get()).exists;
    let fpHit: string | undefined;
    if (!exists && r.fingerprint) {
      const q = await db.collection("recipes").where("fingerprint", "==", r.fingerprint).limit(5).get();
      fpHit = (q.docs.find((d) => d.data().status === "active") ?? q.docs[0])?.id;
    }
    const m = matchRecipe(r, () => exists, () => fpHit);
    if (m.kind === "fingerprint") {
      map.set(r.id, m.id);
      matched++;
    } else if (m.kind === "create") {
      const text = p.cook.get(r.file);
      if (!text) continue; // nothing to recreate it from; references stay (shown as a missing recipe)
      try {
        await createRecipeFromCook(uid, r.id, text);
        created++;
      } catch (e) {
        console.warn("importHousehold: recipe not recreated", { id: r.id, error: (e as Error).message });
      }
    }
  }
  return { map, created, matched };
}

/** Saved meals referenced by the household: kept when they exist, else recreated under their ID. */
async function resolveMeals(p: ParsedExport, uid: string, recipes: Map<string, string>): Promise<{ created: number }> {
  let created = 0;
  for (const m of p.meals) {
    const ref = db.doc(`meals/${m.id}`);
    if ((await ref.get()).exists) continue;
    await ref.set({
      name: m.name,
      recipes: m.recipes.map((r) => ({ recipeId: recipes.get(r.recipeId) ?? r.recipeId, servingsMultiplier: r.servingsMultiplier })),
      ...(m.sides?.length ? { sides: m.sides.map((x) => ({ ingredientId: x.ingredientId, portion: x.portion })) } : {}),
      createdBy: uid,
      updatedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created++;
  }
  return { created };
}

/**
 * After the import is written (M22): deletes every household document the import didn't write, at any depth (a supply
 * row's old transactions too), except members, invites and the running import command. Other commands all go (they
 * aren't exported). Returns how many documents were deleted.
 */
async function pruneHousehold(hRef: DocumentReference, cmdId: string, written: ReadonlySet<string>): Promise<number> {
  let deletes = 0;
  const keep = new Set<string>(IMPORT_KEEPS);
  const w = db.bulkWriter();
  w.onWriteResult(() => {
    deletes++;
  });
  const prune = async (col: CollectionReference): Promise<void> => {
    for (const d of await col.listDocuments()) {
      if (!written.has(d.path)) await db.recursiveDelete(d, w);
      else for (const sub of await d.listCollections()) await prune(sub);
    }
  };
  for (const col of await hRef.listCollections()) {
    if (keep.has(col.id)) continue;
    if (col.id === "commands") {
      for (const d of (await col.select().get()).docs) if (d.id !== cmdId) void w.delete(d.ref);
      continue;
    }
    await prune(col);
  }
  await w.close();
  return deletes;
}

async function writeExport(hRef: DocumentReference, exp: ParsedExport["export"], written: Set<string>): Promise<number> {
  let writes = 0;
  let failed = 0;
  const w = db.bulkWriter();
  // A write that still fails after BulkWriter's retries stops the import before anything is deleted (M22).
  w.onWriteError((e) => {
    if (e.failedAttempts < 5) return true;
    failed++;
    return false;
  });
  const set = (ref: DocumentReference, data: Record<string, unknown>) => {
    void w.set(ref, data);
    written.add(ref.path);
    writes++;
  };
  const nowMs = Date.now();
  for (const c of EXPORT_COLLECTIONS) for (const d of exp.collections[c]) set(hRef.collection(c).doc(d.id), decode(d.data));
  for (const s of exp.supply) {
    const r = reconcileSupply(s, nowMs);
    const ref = hRef.collection("supply").doc(s.id);
    set(ref, decode(r.data));
    for (const t of r.transactions) set(ref.collection("transactions").doc(t.id), decode(t.data));
  }
  await w.close();
  if (failed) throw new ImportFailure(`${failed} documents couldn't be written; nothing was deleted, try again`);
  const fields = decode(exp.household.fields);
  delete fields.name;
  delete fields.createdBy;
  delete fields.createdAt;
  // Only fields the household rules know (validHousehold): no import marker, or members' later saves would fail.
  if (Object.keys(fields).length) await hRef.update(fields);
  return writes + 1;
}
