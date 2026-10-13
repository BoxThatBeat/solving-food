// Recipe reads and versioned writes (TECHNICAL_SPECS §4.1, §4.4, §9, §11).
//
// Every save is one batch: the recipe document with `version + 1` and its `versions/{n}` snapshot (rules enforce
// both). Saves merge so the index function's `indexChunk` is never touched; optional fields that are now absent are
// deleted explicitly. Saving needs a connection (§11): a queued offline save would be rejected by the version rule
// if someone else saved first, and the SDK drops that silently.

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { deriveRecipe, type IngredientLookup, type RecipeContent, type RecipeDoc, type RecipeVersionDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useEffect, useState } from "react";
import { useLiveDoc, useLiveQuery } from "./live";

export type StoredRecipe = RecipeDoc & { createdAt: Timestamp; updatedAt: Timestamp; trashedAt?: Timestamp };

export function useRecipe(id: string | null) {
  return useLiveDoc<StoredRecipe>(id ? doc(db, "recipes", id) : null, id ? `recipes/${id}` : null);
}

export function useRecipesWithStatus(status: "trashed" | "pendingDuplicateReview", enabled = true) {
  return useLiveQuery<StoredRecipe>(
    enabled ? query(collection(db, "recipes"), where("status", "==", status)) : null,
    enabled ? `recipes?status=${status}` : null,
  );
}

export type StoredVersion = RecipeVersionDoc & { editedAt: Timestamp };

/**
 * A recipe's version snapshots (§4.4). The live listener answers from this device's cache first, and a long-lived
 * phone cache may hold only the snapshot it wrote itself (M7 review: "there is no more v1"), so the history also
 * asks the server once when it opens and merges the two. `confirmed` is false until the server has answered.
 */
export function useVersions(id: string | null, enabled = true) {
  const on = !!id && enabled;
  const live = useLiveQuery<StoredVersion>(on ? collection(db, "recipes", id, "versions") : null, on ? `recipes/${id}/versions` : null);
  const [server, setServer] = useState<{ key: string; docs: Array<{ id: string; data: StoredVersion }> } | null>(null);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    getDocsFromServer(collection(db, "recipes", id, "versions"))
      .then((snap) => {
        if (!gone) setServer({ key: id, docs: snap.docs.map((d) => ({ id: d.id, data: d.data() as StoredVersion })) });
      })
      .catch(() => undefined); // offline: the live listener's cached result is all there is
    return () => {
      gone = true;
    };
  }, [on, id]);
  const fromServer = server && server.key === id ? server.docs : null;
  if (live.docs === undefined && !fromServer) return { docs: undefined, confirmed: false, error: live.error };
  const byId = new Map<string, { id: string; data: StoredVersion }>();
  for (const d of fromServer ?? []) byId.set(d.id, d);
  for (const d of live.docs ?? []) byId.set(d.id, d);
  return { docs: [...byId.values()], confirmed: !live.fromCache || !!fromServer, error: live.error };
}

/** Keys that may be absent; a merge write deletes them when the new state doesn't have them. */
const OPTIONAL_KEYS = [
  "leftoverMealType",
  "proteinPerServingG",
  "proteinApproximate",
  "fibrePerServingG",
  "fibreApproximate",
  "nutrition",
  "nutritionApproximate",
  "notes",
  "sourceUrl",
  "sourceUrlCanonical",
  "possibleDuplicateOf",
  "trashedAt",
  "trashedBy",
] as const;

/** Only the content fields, in case a whole stored document is passed in. */
export function contentOf(r: RecipeContent | RecipeDoc): RecipeContent {
  const c: RecipeContent = {
    title: r.title,
    servings: r.servings,
    prepMin: r.prepMin,
    cookMin: r.cookMin,
    cuisine: r.cuisine,
    mainProtein: r.mainProtein,
    tags: r.tags,
    tools: r.tools,
    ingredients: r.ingredients,
    steps: r.steps,
    prepTasks: r.prepTasks,
    defaultLeftoverPortions: r.defaultLeftoverPortions,
    imagePaths: r.imagePaths,
  };
  if (r.leftoverMealType) c.leftoverMealType = r.leftoverMealType;
  if (r.notes) c.notes = r.notes;
  if (r.sourceUrl) c.sourceUrl = r.sourceUrl;
  return c;
}

export class EditedElsewhereError extends Error {
  constructor(public current: StoredRecipe) {
    super("This recipe was edited elsewhere");
    this.name = "EditedElsewhereError";
  }
}

export class OfflineError extends Error {
  constructor() {
    super("You're offline. The draft is kept and will save when you're back online.");
    this.name = "OfflineError";
  }
}

interface StateChange {
  status?: RecipeDoc["status"];
  trash?: "set" | "clear";
  clearDuplicate?: boolean;
}

/**
 * Writes `content` (or the current content) as the next version of `id`. `expectedVersion` is the version the
 * editor opened; when the server has moved on, throws EditedElsewhereError (the caller offers reload or overwrite,
 * and overwriting passes the new version).
 */
async function writeNextVersion(
  id: string,
  uid: string,
  lookup: IngredientLookup,
  opts: { content?: RecipeContent; expectedVersion?: number; change?: StateChange },
): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new OfflineError();
  const ref = doc(db, "recipes", id);
  const snap = await getDocFromServer(ref);
  if (!snap.exists()) throw new Error("This recipe no longer exists");
  const current = snap.data() as StoredRecipe;
  if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) throw new EditedElsewhereError(current);

  const content = opts.content ?? contentOf(current);
  const derived = deriveRecipe(content, lookup);
  const status = opts.change?.status ?? current.status;
  const next: Record<string, unknown> = {
    ...content,
    ...derived,
    status,
    createdBy: current.createdBy,
    createdAt: current.createdAt,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    version: current.version + 1,
  };
  if (current.possibleDuplicateOf && !opts.change?.clearDuplicate && status === "pendingDuplicateReview") next.possibleDuplicateOf = current.possibleDuplicateOf;
  if (status === "trashed") {
    if (opts.change?.trash === "set" || !current.trashedAt) {
      next.trashedAt = serverTimestamp();
      next.trashedBy = uid;
    } else {
      next.trashedAt = current.trashedAt;
      next.trashedBy = current.trashedBy;
    }
  }
  const write: Record<string, unknown> = { ...next };
  for (const k of OPTIONAL_KEYS) if (!(k in next)) write[k] = deleteField();

  const b = writeBatch(db);
  b.set(ref, write, { merge: true });
  b.set(doc(db, "recipes", id, "versions", String(next.version)), { ...next, editedBy: uid, editedAt: serverTimestamp() });
  await b.commit();
  return next.version as number;
}

/** Creates a recipe (version 1 + snapshot). Returns its ID. */
export async function createRecipe(content: RecipeContent, uid: string, lookup: IngredientLookup, id = doc(collection(db, "recipes")).id): Promise<string> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new OfflineError();
  const derived = deriveRecipe(content, lookup);
  const data: Record<string, unknown> = {
    ...content,
    ...derived,
    status: "active",
    createdBy: uid,
    updatedBy: uid,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  const b = writeBatch(db);
  b.set(doc(db, "recipes", id), data);
  b.set(doc(db, "recipes", id, "versions", "1"), { ...data, editedBy: uid, editedAt: serverTimestamp() });
  await b.commit();
  return id;
}

/** A new, unsaved recipe ID (images upload under it before the first save). */
export function newRecipeId(): string {
  return doc(collection(db, "recipes")).id;
}

export function saveRecipe(id: string, content: RecipeContent, uid: string, lookup: IngredientLookup, expectedVersion?: number) {
  return writeNextVersion(id, uid, lookup, { content, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
}

/** Delete = move to Trash for everyone (§4.4, R4.26). */
export function trashRecipe(id: string, uid: string, lookup: IngredientLookup) {
  return writeNextVersion(id, uid, lookup, { change: { status: "trashed", trash: "set" } });
}

export function restoreRecipe(id: string, uid: string, lookup: IngredientLookup) {
  return writeNextVersion(id, uid, lookup, { change: { status: "active", trash: "clear" } });
}

/** Restoring an old version saves its content as a new version (§9). */
export function restoreVersion(id: string, snapshot: RecipeVersionDoc, uid: string, lookup: IngredientLookup) {
  return writeNextVersion(id, uid, lookup, { content: contentOf(snapshot) });
}

// ---------- duplicate review (§9, R4.20)

/** Keep existing: the import is discarded (a hard delete, allowed only while pending; the cleanup function runs). */
export async function keepExisting(pendingId: string): Promise<void> {
  await deleteDoc(doc(db, "recipes", pendingId));
}

/** Keep both: the import becomes a normal recipe. */
export function keepBoth(pendingId: string, uid: string, lookup: IngredientLookup) {
  return writeNextVersion(pendingId, uid, lookup, { change: { status: "active", clearDuplicate: true } });
}

/** Keep new: the import's content becomes the next version of the existing recipe, then the import is deleted. */
export async function keepNew(pending: StoredRecipe, pendingId: string, existingId: string, uid: string, lookup: IngredientLookup): Promise<void> {
  await writeNextVersion(existingId, uid, lookup, { content: contentOf(pending) });
  await deleteDoc(doc(db, "recipes", pendingId));
}
