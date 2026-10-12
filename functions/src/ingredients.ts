// "Merge into…" (PRD R4.27, R8.16; TECHNICAL_SPECS §6 "Merging ingredients", §9; Planning/M8 item 2). A duplicate
// ingredient (usually one a drop-folder import created) is merged into the ingredient it means. Ingredient IDs are
// referenced from recipes, their version snapshots, saved meals and every household's Supply, plan, grocery lists and
// settings, and Supply is function-only, so the whole move runs here:
//
//   1. recipes using it: lines repointed, derived fields (canonical amounts, protein, fingerprint, ingredientIds)
//      recomputed with the target's conversions, without a version bump (the content didn't change); the recipeIndex
//      trigger then refreshes the search index;
//   2. every version snapshot that names it: lines and ingredientIds repointed (so restoring an old version can't bring
//      the duplicate back), version numbers untouched;
//   3. saved meals' sides;
//   4. per household, in one transaction for the Supply part: the duplicate's lots move onto the target's row (amounts
//      converted when one is counted and the other weighed), its transactions are copied onto the target's history
//      (plus a `merge` transaction for anything they don't explain), and the duplicate's row keeps its history, gets a
//      `merge` (−) per lot, amount 0 and `mergedInto` (rows are never deleted); then planned meals' sides, draft and
//      ordered grocery lines (joined with the target's line), brand mapping, sourcing rule, cadence, likes/dislikes and
//      the household's side setting move to the target's ID when the target has none (else the target's wins);
//   5. last, the ingredient docs: the target learns the duplicate's name and aliases (so the next import matches them)
//      and takes any conversion or protein it lacked; the duplicate becomes a tombstone (`mergedInto`, not needing
//      review), hidden from pickers, its names resolving to the target.
//
// Re-running a merge that already happened (or half happened) repeats every step as a no-op and finishes the rest.
// `dryRun` only counts. Received grocery lists, cook events and ratings are history and keep the old ID (the tombstone
// still names it).
import { FieldPath, FieldValue, Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import {
  copiedHistory,
  lotFromDoc,
  lotToDoc,
  mergedTarget,
  mergeFactor,
  mergeGroceryItems,
  mergeRefusal,
  moveLots,
  nextExpiry,
  recomputeAmount,
  repointLines,
  repointSides,
  uniqueIds,
  type GroceryItem,
  type IngredientDoc,
  type MealSide,
  type MergeReport,
  type RecipeIngredient,
} from "@solving-food/core";
import { db } from "./admin";
import { contentOf, derivedUpdate, loadIngredients, lookupOf } from "./recipes";
import { toMs } from "./commands/store";

export class MergeError extends Error {
  constructor(
    readonly code: "invalid-argument" | "failed-precondition" | "permission-denied" | "not-found",
    message: string,
  ) {
    super(message);
  }
}


/** Callers must be signed in with a verified, allowlisted address (the same gate as editing an ingredient). */
export async function requireAllowed(auth: { uid: string; token: { email?: string; email_verified?: boolean } } | undefined): Promise<string> {
  if (!auth || auth.token.email_verified !== true || !auth.token.email) throw new MergeError("permission-denied", "Sign in first");
  const ok = await db.doc(`allowlist/${auth.token.email.toLowerCase()}`).get();
  if (!ok.exists) throw new MergeError("permission-denied", "Not on the allowlist");
  return auth.uid;
}

function parse(data: unknown): { fromId: string; intoId: string; dryRun: boolean } {
  const d = (data ?? {}) as Record<string, unknown>;
  const fromId = typeof d.fromId === "string" ? d.fromId.trim() : "";
  const intoId = typeof d.intoId === "string" ? d.intoId.trim() : "";
  if (!fromId || !intoId || fromId.length > 200 || intoId.length > 200 || fromId.includes("/") || intoId.includes("/")) {
    throw new MergeError("invalid-argument", "fromId and intoId are ingredient IDs");
  }
  return { fromId, intoId, dryRun: d.dryRun === true };
}

const ts = (ms: number) => Timestamp.fromMillis(ms);

export async function mergeIngredient(uid: string, data: unknown): Promise<MergeReport> {
  const { fromId, intoId, dryRun } = parse(data);
  const [fromSnap, intoSnap] = await db.getAll(db.doc(`ingredients/${fromId}`), db.doc(`ingredients/${intoId}`));
  const from = fromSnap!.exists ? (fromSnap!.data() as IngredientDoc) : undefined;
  const into = intoSnap!.exists ? (intoSnap!.data() as IngredientDoc) : undefined;
  const refusal = mergeRefusal(fromId, from, intoId, into);
  if (refusal) throw new MergeError(!from || !into ? "not-found" : "failed-precondition", refusal);
  const factor = mergeFactor(from!, into!)!;
  const report: MergeReport = {
    fromId,
    intoId,
    fromName: from!.name,
    intoName: into!.name,
    dryRun,
    alreadyMerged: from!.mergedInto === intoId,
    recipes: 0,
    versions: 0,
    meals: 0,
    households: 0,
    supplyRows: 0,
    planItems: 0,
    groceryLists: 0,
    householdDocs: 0,
    aliasesAdded: [],
  };
  const writer = dryRun ? null : db.bulkWriter();

  // Both queries run before any write, so a missing index (or any read failure) changes nothing.
  // 1. Recipes (every status: trashed and pending ones are restorable).
  const recipes = await db.collection("recipes").where("ingredientIds", "array-contains", fromId).get();
  const versions = await db.collectionGroup("versions").where("ingredientIds", "array-contains", fromId).get();
  report.recipes = recipes.size;
  if (writer && recipes.size) {
    for (const d of recipes.docs) {
      const r = d.data();
      const lines = repointLines((r.ingredients ?? []) as RecipeIngredient[], fromId, intoId).lines;
      const content = { ...contentOf(r), ingredients: lines };
      const ids = uniqueIds((r.ingredientIds ?? []) as string[], fromId, intoId);
      const lookup = lookupOf(await loadIngredients(ids));
      const update = derivedUpdate(r, content, lookup);
      // derivedUpdate compares with the stored lines; the repointed lines always change.
      update.ingredients ??= lines;
      update.ingredientIds ??= ids;
      writer.update(d.ref, update);
    }
  }

  // 2. Version snapshots (collection-group query; firestore.indexes.json declares the array-contains index).
  report.versions = versions.size;
  if (writer) {
    for (const v of versions.docs) {
      const s = v.data();
      writer.update(v.ref, {
        ingredients: repointLines((s.ingredients ?? []) as RecipeIngredient[], fromId, intoId).lines,
        ingredientIds: uniqueIds((s.ingredientIds ?? []) as string[], fromId, intoId),
      });
    }
  }

  // 3. Saved meals' sides (a small collection: no query can match inside the side objects).
  const meals = await db.collection("meals").get();
  for (const m of meals.docs) {
    const sides = (m.data().sides ?? []) as MealSide[];
    const r = repointSides(sides, fromId, intoId);
    if (!r.changed) continue;
    report.meals++;
    writer?.update(m.ref, { sides: r.sides });
  }
  if (writer) await writer.close();

  // 4. Households.
  const households = await db.collection("households").listDocuments();
  report.households = households.length;
  for (const h of households) await mergeHousehold(h, fromId, intoId, from!, into!, factor, uid, dryRun, report);

  // 5. The ingredient docs, last: a failure above leaves the duplicate visible and a re-run finishes the job.
  if (!dryRun) {
    const target = mergedTarget(into!, from!);
    report.aliasesAdded = target.aliasesAdded;
    const batch = db.batch();
    const t = target.doc;
    const intoUpdate: Record<string, unknown> = { aliases: t.aliases, needsReview: t.needsReview, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() };
    if (t.densityGPerMl !== undefined) intoUpdate.densityGPerMl = t.densityGPerMl;
    if (t.unitWeightG !== undefined) intoUpdate.unitWeightG = t.unitWeightG;
    if (t.proteinPer100g !== undefined) intoUpdate.proteinPer100g = t.proteinPer100g;
    batch.update(intoSnap!.ref, intoUpdate);
    batch.update(fromSnap!.ref, { mergedInto: intoId, needsReview: false, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  } else {
    report.aliasesAdded = mergedTarget(into!, from!).aliasesAdded;
  }
  return report;
}

async function mergeHousehold(
  h: DocumentReference,
  fromId: string,
  intoId: string,
  from: IngredientDoc,
  into: IngredientDoc,
  factor: number,
  uid: string,
  dryRun: boolean,
  report: MergeReport,
): Promise<void> {
  const supplyFrom = h.collection("supply").doc(fromId);
  const supplyInto = h.collection("supply").doc(intoId);

  // Supply: one transaction, so a command can't interleave between reading and writing the two rows.
  const moved = await db.runTransaction(async (tx) => {
    const [fs, is] = await tx.getAll(supplyFrom, supplyInto);
    const fd = fs!.exists ? fs!.data()! : null;
    if (!fd || fd.mergedInto) return false;
    const fromLots = ((fd.lots ?? []) as unknown[]).map((l) => lotFromDoc(l as never, toMs));
    if (dryRun) return true;
    const id = is!.exists ? is!.data()! : null;
    const intoLots = ((id?.lots ?? []) as unknown[]).map((l) => lotFromDoc(l as never, toMs));
    const note = `merged into ${into.name}`;
    const m = moveLots(intoLots, fromLots, factor, note);
    const history = await tx.get(supplyFrom.collection("transactions"));
    // A transaction holds at most 500 writes: a very long history isn't copied (the target gets one merge transaction
    // for the whole amount instead; the duplicate's row keeps the history either way).
    const copyable = history.size <= 400 ? history.docs : [];
    const sourceTxs = copyable.map((d) => ({ ...(d.data() as DocumentData), delta: Number(d.data().delta ?? 0), lotId: String(d.data().lotId ?? ""), _id: d.id }));
    const { copies, balance } = copiedHistory(sourceTxs, m.moved, factor, m.renamed);

    // The target's row: created from the target ingredient when the household had none.
    const nextInto = nextExpiry(m.lots);
    tx.set(
      supplyInto,
      {
        ingredientId: intoId,
        label: id?.label ?? into.name,
        canonicalUnit: into.canonicalUnit,
        canonicalAmount: recomputeAmount(m.lots),
        lots: m.lots.map((l) => lotToDoc(l, ts)),
        nextExpiry: nextInto ? ts(nextInto) : null,
        updatedAt: FieldValue.serverTimestamp(),
        ...(fd.shortAt && !id?.shortAt ? { shortAt: fd.shortAt } : {}),
      },
      { merge: true },
    );
    for (const c of copies) {
      const { _id, ...rest } = c as typeof c & { _id: string };
      tx.set(supplyInto.collection("transactions").doc(`m_${fromId}_${_id}`.slice(0, 500)), { ...rest, mergedFrom: fromId });
    }
    tx.set(supplyInto.collection("transactions").doc(`m_${fromId}`), {
      delta: balance,
      kind: "merge",
      lotId: m.lots[0]?.lotId ?? "merge",
      uid,
      note: `merged from ${from.name}`,
      createdAt: FieldValue.serverTimestamp(),
    });
    // The duplicate's row keeps its history, gives up its lots, and points at the target.
    for (const [k, t] of m.sourceTxs.entries()) {
      tx.set(supplyFrom.collection("transactions").doc(`merge_${k}`), { ...t, uid, createdAt: FieldValue.serverTimestamp() });
    }
    tx.set(supplyFrom, { canonicalAmount: 0, lots: [], nextExpiry: null, shortAt: null, mergedInto: intoId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  if (moved) report.supplyRows++;

  const touched: Array<() => void> = [];
  const batch = db.batch();

  // Planned meals' sides (cooked ones are history).
  const planned = await h.collection("planItems").where("status", "==", "planned").get();
  for (const p of planned.docs) {
    const r = repointSides((p.data().sides ?? []) as MealSide[], fromId, intoId);
    if (!r.changed) continue;
    report.planItems++;
    touched.push(() => batch.update(p.ref, { sides: r.sides }));
  }

  // Draft and ordered grocery lists (received ones are history).
  const lists = await h.collection("groceryLists").where("status", "in", ["draft", "ordered"]).get();
  for (const l of lists.docs) {
    const items = mergeGroceryItems((l.data().items ?? {}) as Record<string, GroceryItem>, fromId, intoId, factor);
    if (!items) continue;
    report.groceryLists++;
    touched.push(() => batch.update(l.ref, { items }));
  }

  // Docs keyed by the ingredient ID: the target's wins; the duplicate's moves when the target has none.
  const keyed: Array<[DocumentReference, DocumentReference, (d: DocumentData) => DocumentData]> = [
    [h.collection("brandMappings").doc(fromId), h.collection("brandMappings").doc(intoId), (d) => d],
    [h.collection("sourcingRules").doc(`ing_${fromId}`), h.collection("sourcingRules").doc(`ing_${intoId}`), (d) => ({ ...d, match: { ingredientId: intoId } })],
    [h.collection("cadence").doc(fromId), h.collection("cadence").doc(intoId), (d) => d],
  ];
  const snaps = await db.getAll(...keyed.flatMap(([a, b]) => [a, b]));
  keyed.forEach(([a, b, map], k) => {
    const sa = snaps[2 * k]!;
    const sb = snaps[2 * k + 1]!;
    if (!sa.exists) return;
    report.householdDocs++;
    touched.push(() => {
      if (!sb.exists) batch.set(b, map(sa.data()!));
      batch.delete(a);
    });
  });

  // The household's own side setting (Settings → Sides).
  const hs = await h.get();
  const sides = (hs.data()?.settings?.sides ?? {}) as Record<string, unknown>;
  if (fromId in sides) {
    report.householdDocs++;
    // FieldPath, not a dotted string: ingredient IDs contain hyphens.
    const fromPath = new FieldPath("settings", "sides", fromId);
    const intoPath = new FieldPath("settings", "sides", intoId);
    touched.push(() =>
      intoId in sides ? batch.update(h, fromPath, FieldValue.delete()) : batch.update(h, fromPath, FieldValue.delete(), intoPath, sides[fromId]),
    );
  }

  // Likes and dislikes can name an ingredient ("ingredient:<id>", Settings → Preferences).
  const prefs = (hs.data()?.settings?.preferences ?? null) as { likes?: string[]; dislikes?: string[] } | null;
  for (const kind of ["likes", "dislikes"] as const) {
    const list = prefs?.[kind];
    if (!Array.isArray(list) || !list.includes(`ingredient:${fromId}`)) continue;
    report.householdDocs++;
    const next = [...new Set(list.map((e) => (e === `ingredient:${fromId}` ? `ingredient:${intoId}` : e)))];
    touched.push(() => batch.update(h, new FieldPath("settings", "preferences", kind), next));
  }

  if (!dryRun && touched.length) {
    touched.forEach((f) => f());
    await batch.commit();
  }
}
