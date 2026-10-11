// Plan, periods, stores, mappings, saved meals, and grocery lists: live reads and writes (TECHNICAL_SPECS §4.2, §7,
// §8, §11). Business math is in @solving-food/core; this file only moves documents.

import { useEffect, useState } from "react";
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import {
  buildPlanItem,
  carriedItemId,
  mergeDraft,
  carryOver,
  DEFAULT_STORE_ID,
  DEFAULT_STORES,
  firstPeriod,
  isEnded,
  lotFromDoc,
  unexpiredAmount,
  type StoredLotLike,
  newMeal,
  nextPeriod,
  type BrandMappingDoc,
  type CoverageRecipe,
  type CreateMealInput,
  type GroceryItem,
  type GroceryListDoc,
  type HouseholdDoc,
  type MealDoc,
  type MealType,
  type PeriodDoc,
  type PlanItemDoc,
  type RecipeRef,
  type SourcingRuleDoc,
  type StoreDoc,
} from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc, useLiveQuery } from "./live";
import type { StoredRecipe } from "./recipes";

export type StoredPeriod = PeriodDoc & { start: Timestamp; end: Timestamp };
export type StoredPlanItem = PlanItemDoc & { addedAt?: Timestamp };
export type StoredMeal = MealDoc & { updatedAt: Timestamp; createdAt?: Timestamp };
export type StoredList = GroceryListDoc & { createdAt: Timestamp; orderedAt?: Timestamp };

const hh = (hid: string, ...rest: string[]) => ["households", hid, ...rest].join("/");

// ---------- reads

export function usePeriod(hid: string, periodId: string | null | undefined) {
  return useLiveDoc<StoredPeriod>(periodId ? doc(db, "households", hid, "periods", periodId) : null, periodId ? hh(hid, "periods", periodId) : null);
}

export function usePlanItems(hid: string, periodId: string | null | undefined) {
  return useLiveQuery<StoredPlanItem>(
    periodId ? query(collection(db, "households", hid, "planItems"), where("periodId", "==", periodId)) : null,
    periodId ? `${hh(hid, "planItems")}?period=${periodId}` : null,
  );
}

export function useStores(hid: string) {
  return useLiveQuery<StoreDoc>(collection(db, "households", hid, "stores"), hh(hid, "stores"));
}

export function useSourcingRules(hid: string) {
  return useLiveQuery<SourcingRuleDoc>(collection(db, "households", hid, "sourcingRules"), hh(hid, "sourcingRules"));
}

export function useBrandMappings(hid: string) {
  return useLiveQuery<BrandMappingDoc>(collection(db, "households", hid, "brandMappings"), hh(hid, "brandMappings"));
}

export const DRAFT_ID = "draft";

export function useDraftList(hid: string) {
  return useLiveDoc<StoredList>(doc(db, "households", hid, "groceryLists", DRAFT_ID), hh(hid, "groceryLists", DRAFT_ID));
}

/** Lists copied to ChatGPT and not yet received: their items are "incoming" (§8). */
export function useOrderedLists(hid: string) {
  return useLiveQuery<StoredList>(query(collection(db, "households", hid, "groceryLists"), where("status", "==", "ordered")), `${hh(hid, "groceryLists")}?ordered`);
}

/** Saved meals (global; a few dozen at this scale, so the whole collection is followed). */
export function useMeals(enabled = true) {
  return useLiveQuery<StoredMeal>(enabled ? collection(db, "meals") : null, enabled ? "meals" : null);
}

export function useMeal(id: string | null) {
  return useLiveDoc<StoredMeal>(id ? doc(db, "meals", id) : null, id ? `meals/${id}` : null);
}

/** Full recipe documents by ID, each its own live document (works signed out: public `get`). */
export function useRecipeDocs(ids: readonly string[]): Map<string, StoredRecipe> {
  const key = [...new Set(ids)].sort().join(",");
  const [state, setState] = useState<{ key: string; map: Map<string, StoredRecipe> }>({ key: "", map: new Map() });
  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    const unsubs: Unsubscribe[] = wanted.map((id) =>
      onSnapshot(
        doc(db, "recipes", id),
        (snap) =>
          setState((s) => {
            const map = new Map(s.key === key ? s.map : []);
            if (snap.exists()) map.set(id, snap.data() as StoredRecipe);
            else map.delete(id);
            return { key, map };
          }),
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return state.key === key ? state.map : new Map();
}

export function millis(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}

// ---------- household bootstrap: rollover (§7) and default stores (Planning/M2 §5)

export type BootstrapResult = "ok" | "rolled" | "offline" | "error";

/**
 * Runs when the app opens, regains focus, or comes back online. If the current period has ended (or there is none
 * yet), one transaction creates the next period with a budget snapshot, carries every still-planned item into it
 * with `carriedFromId` (leftovers only while their batch hasn't expired), and advances `currentPeriodId`; deterministic
 * IDs make concurrent runs harmless. Households
 * created before M2 also get the default stores here. Needs a connection; offline the ended period stays.
 */
export async function bootstrapHousehold(hid: string, now = Date.now()): Promise<BootstrapResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  const hRef = doc(db, "households", hid);
  const h = (await getDoc(hRef)).data() as HouseholdDoc | undefined;
  if (!h) return "error";
  const curId = h.currentPeriodId;
  const cur = curId ? ((await getDoc(doc(db, "households", hid, "periods", curId))).data() as StoredPeriod | undefined) : undefined;
  const needPeriod = !cur || isEnded({ endMs: cur.end.toMillis() }, now);
  const needStores = !h.defaultStoreId;
  if (!needPeriod && !needStores) return "ok";

  // Queries can't run inside a client transaction: find the candidates first, re-check each inside it.
  const candidates =
    needPeriod && curId && cur
      ? (await getDocs(query(collection(db, "households", hid, "planItems"), where("periodId", "==", curId), where("status", "==", "planned")))).docs.map((d) => d.id)
      : [];

  let rolled = false;
  await runTransaction(db, async (tx) => {
    const hs = await tx.get(hRef);
    const hd = hs.data() as HouseholdDoc | undefined;
    if (!hd) return;
    const update: Record<string, unknown> = {};
    // ---- reads
    const stillCurrent = hd.currentPeriodId === (curId ?? null);
    const bounds = needPeriod && stillCurrent ? (cur ? nextPeriod(cur.end.toMillis(), hd.periodDays, hd.timezone, now) : firstPeriod(now, hd.periodDays, hd.timezone)) : null;
    const pRef = bounds ? doc(db, "households", hid, "periods", bounds.id) : null;
    const pSnap = pRef ? await tx.get(pRef) : null;
    const carry: Array<{ from: StoredPlanItem; fromId: string; exists: boolean }> = [];
    if (bounds && curId) {
      for (const id of candidates) {
        const s = await tx.get(doc(db, "households", hid, "planItems", id));
        const item = s.data() as StoredPlanItem | undefined;
        if (!item || item.status !== "planned" || item.periodId !== curId) continue;
        // Leftovers roll over only while their batch is still good (spec §7): an expired or eaten-up batch stays behind.
        if (item.kind === "leftover" && item.leftoverSupplyId) {
          const lo = (await tx.get(doc(db, "households", hid, "supply", item.leftoverSupplyId))).data() as { lots?: StoredLotLike[] } | undefined;
          const lots = (lo?.lots ?? []).map((l) => lotFromDoc(l, millis));
          if (unexpiredAmount(lots, now) <= 0) continue;
        }
        const c = await tx.get(doc(db, "households", hid, "planItems", carriedItemId(bounds.id, id)));
        carry.push({ from: item, fromId: id, exists: c.exists() });
      }
    }
    const storeSnaps = !hd.defaultStoreId ? await Promise.all(DEFAULT_STORES.map((s) => tx.get(doc(db, "households", hid, "stores", s.id)))) : [];
    // ---- writes
    if (bounds && pRef && pSnap) {
      if (!pSnap.exists()) tx.set(pRef, { start: Timestamp.fromMillis(bounds.startMs), end: Timestamp.fromMillis(bounds.endMs), budgetCents: hd.budgetCents });
      for (const c of carry) {
        if (c.exists) continue;
        tx.set(doc(db, "households", hid, "planItems", carriedItemId(bounds.id, c.fromId)), { ...carryOver(c.from, c.fromId, bounds.id), addedAt: c.from.addedAt ?? serverTimestamp() });
      }
      update.currentPeriodId = bounds.id;
      rolled = true;
    }
    if (!hd.defaultStoreId) {
      DEFAULT_STORES.forEach((s, i) => {
        if (!storeSnaps[i]?.exists()) tx.set(doc(db, "households", hid, "stores", s.id), { name: s.name, kind: s.kind, bulk: s.bulk });
      });
      update.defaultStoreId = DEFAULT_STORE_ID;
    }
    if (Object.keys(update).length) tx.update(hRef, update);
  });
  return rolled ? "rolled" : "ok";
}

// ---------- Create meal (R5.7, R5.8)

export async function createMeal(
  hid: string,
  periodId: string,
  input: CreateMealInput,
  uid: string,
  recipes: (id: string) => CoverageRecipe | undefined,
): Promise<{ planItemId: string; mealId?: string }> {
  const b = writeBatch(db);
  let mealId = input.savedMealId;
  let created: string | undefined;
  if (input.saveAsMeal && !input.savedMealId) {
    const mRef = doc(collection(db, "meals"));
    mealId = mRef.id;
    created = mRef.id;
    b.set(mRef, { ...newMeal(input.name ?? "", input.recipes, uid), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  const item = buildPlanItem(input, { periodId, uid, recipes, ...(mealId ? { savedMealId: mealId } : {}) });
  const iRef = doc(collection(db, "households", hid, "planItems"));
  b.set(iRef, { ...item, addedAt: serverTimestamp() });
  await b.commit();
  return { planItemId: iRef.id, ...(created ? { mealId: created } : {}) };
}

export function updatePlanItem(hid: string, id: string, patch: Partial<Pick<PlanItemDoc, "servings" | "mealType" | "coverage" | "name" | "savedMealId">>) {
  return updateDoc(doc(db, "households", hid, "planItems", id), patch);
}

export function removePlanItem(hid: string, id: string) {
  return deleteDoc(doc(db, "households", hid, "planItems", id));
}

/** Restores a removed plan item (the Undo in the removal banner). */
export function restorePlanItem(hid: string, id: string, item: StoredPlanItem) {
  return setDoc(doc(db, "households", hid, "planItems", id), item);
}

/** "Save as meal" for an unsaved planned item (R5.8): adds a reusable copy and links the item to it. */
export async function saveItemAsMeal(hid: string, itemId: string, name: string, recipes: readonly RecipeRef[], uid: string): Promise<string> {
  const b = writeBatch(db);
  const mRef = doc(collection(db, "meals"));
  b.set(mRef, { ...newMeal(name, recipes, uid), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.update(doc(db, "households", hid, "planItems", itemId), { savedMealId: mRef.id, name: name.trim() });
  await b.commit();
  return mRef.id;
}

// ---------- saved meals

export function updateMeal(id: string, patch: Partial<Pick<MealDoc, "name" | "recipes">>, uid: string) {
  return updateDoc(doc(db, "meals", id), { ...patch, updatedBy: uid, updatedAt: serverTimestamp() });
}

export function deleteMeal(id: string) {
  return deleteDoc(doc(db, "meals", id));
}

export function useMealFavourites(hid: string | null) {
  const q = useLiveQuery<{ type: string; targetId: string }>(hid ? collection(db, "households", hid, "favourites") : null, hid ? `households/${hid}/favourites` : null);
  return new Set((q.docs ?? []).filter((d) => d.data.type === "meal").map((d) => d.data.targetId));
}

export async function setMealFavourite(hid: string, mealId: string, on: boolean): Promise<void> {
  const ref = doc(db, "households", hid, "favourites", `meal_${mealId}`);
  if (on) await setDoc(ref, { type: "meal", targetId: mealId });
  else await deleteDoc(ref);
}

// ---------- household settings (R11.5, R11.6, R11.11–R11.13, R11.1)

export async function saveHouseholdSettings(
  hid: string,
  patch: Partial<Pick<HouseholdDoc, "name" | "periodDays" | "budgetCents" | "timezone" | "defaultServings" | "plannedMealTypes">>,
  currentPeriodId: string | null,
): Promise<void> {
  const b = writeBatch(db);
  b.update(doc(db, "households", hid), patch);
  // The current period's budget follows a budget change; a new length applies from the next period.
  if (patch.budgetCents !== undefined && currentPeriodId) b.update(doc(db, "households", hid, "periods", currentPeriodId), { budgetCents: patch.budgetCents });
  await b.commit();
}

export function saveTools(hid: string, tools: string[]) {
  return updateDoc(doc(db, "households", hid), { "settings.tools": tools });
}

// ---------- M5: preferences, weights, protein goals, PC Express store, alert dismissals, optimiser sets

/** Food preferences (R11.2): likes, dislikes, diets, written whole (the lists are small). */
export function savePreferences(hid: string, prefs: { likes: string[]; dislikes: string[]; diets: string[] }) {
  return updateDoc(doc(db, "households", hid), { "settings.preferences": prefs });
}

/** Suggestion weights (R6.12, R11.3): { factor: 0..5 }. */
export function saveWeights(hid: string, weights: Record<string, number>) {
  return updateDoc(doc(db, "households", hid), { "settings.scoreWeights": weights });
}

/** Protein goals per meal type (R6.14, R11.4): grams per serving; a missing type is "off". */
export function saveProteinGoals(hid: string, goals: Partial<Record<string, number>>) {
  const clean = Object.fromEntries(Object.entries(goals).filter(([, v]) => typeof v === "number" && v > 0));
  return updateDoc(doc(db, "households", hid), { "settings.proteinGoals": clean });
}

/** The household's PC Express store (R6.22). */
export function savePcxStore(hid: string, pcxStoreId: string, pcxStoreName: string) {
  return updateDoc(doc(db, "households", hid), { pcxStoreId, pcxStoreName: pcxStoreName.slice(0, 120) });
}

/** Dismisses expiry alerts for the rest of the period (R6.13): their lot IDs go on the period document. */
export function dismissExpiryAlert(hid: string, periodId: string, lotIds: readonly string[]) {
  return updateDoc(doc(db, "households", hid, "periods", periodId), { dismissedLots: arrayUnion(...lotIds) });
}

/**
 * Accepts an optimiser set (R6.20): every recipe becomes its own planned meal, in one batch. Coverage needs each
 * recipe's leftover estimate, so the recipe documents are read first (public gets, cached).
 */
export async function addOptimiserSet(hid: string, periodId: string, uid: string, recipeIds: readonly string[], mealType: MealType, servings: number): Promise<string[]> {
  const docs = await Promise.all(recipeIds.map((id) => getDoc(doc(db, "recipes", id))));
  const info = new Map(docs.filter((d) => d.exists()).map((d) => [d.id, d.data() as CoverageRecipe]));
  const b = writeBatch(db);
  const ids: string[] = [];
  for (const recipeId of recipeIds) {
    const item = buildPlanItem({ recipes: [{ recipeId, servingsMultiplier: 1 }], mealType, servings, saveAsMeal: false }, { periodId, uid, recipes: (id) => info.get(id) });
    const ref = doc(collection(db, "households", hid, "planItems"));
    ids.push(ref.id);
    b.set(ref, { ...item, addedAt: serverTimestamp() });
  }
  await b.commit();
  return ids;
}

// ---------- stores, rules, mappings (R7.3, R7.4, R11.7)

export function saveStore(hid: string, id: string | null, store: StoreDoc) {
  return setDoc(id ? doc(db, "households", hid, "stores", id) : doc(collection(db, "households", hid, "stores")), store);
}
export function deleteStore(hid: string, id: string) {
  return deleteDoc(doc(db, "households", hid, "stores", id));
}
export function setDefaultStore(hid: string, id: string) {
  return updateDoc(doc(db, "households", hid), { defaultStoreId: id });
}

/** Category rules are keyed `cat_<category>`, ingredient rules `ing_<id>`: one rule per target. */
export function ruleId(match: SourcingRuleDoc["match"]): string {
  return "category" in match ? `cat_${match.category}` : `ing_${match.ingredientId}`;
}
export function saveRule(hid: string, rule: SourcingRuleDoc) {
  return setDoc(doc(db, "households", hid, "sourcingRules", ruleId(rule.match)), rule);
}
export function deleteRule(hid: string, id: string) {
  return deleteDoc(doc(db, "households", hid, "sourcingRules", id));
}

export function saveMapping(hid: string, ingredientId: string, m: BrandMappingDoc, uid: string) {
  const data: Record<string, unknown> = { productName: m.productName.trim(), packAmount: m.packAmount, packMeasure: m.packMeasure, storeId: m.storeId, updatedBy: uid, updatedAt: serverTimestamp() };
  if (m.productCode) data.productCode = m.productCode;
  return setDoc(doc(db, "households", hid, "brandMappings", ingredientId), data);
}
export function deleteMapping(hid: string, ingredientId: string) {
  return deleteDoc(doc(db, "households", hid, "brandMappings", ingredientId));
}

// ---------- grocery lists (§8, R7.1, R7.5, R7.6)

const draftRef = (hid: string) => doc(db, "households", hid, "groceryLists", DRAFT_ID);

/**
 * Regenerate (§8) in a transaction: read the stored draft, merge the generated plan lines into it (core `mergeDraft`:
 * manual lines and ticks kept), write only what changed. A tick or another member's regeneration in between makes the
 * transaction retry on fresh data, so nobody's tick is overwritten. Needs a connection; offline the page still shows
 * the computed lines and the draft catches up later.
 */
export async function syncDraft(hid: string, periodId: string, generated: Record<string, GroceryItem>): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const ref = draftRef(hid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.data() as StoredList | undefined;
    if (!stored) {
      tx.set(ref, { periodId, status: "draft", createdAt: serverTimestamp(), items: generated });
      return;
    }
    const { set, remove } = mergeDraft(stored.items ?? {}, generated);
    const args: unknown[] = [];
    for (const [id, it] of Object.entries(set)) args.push(new FieldPath("items", id), it);
    for (const id of remove) args.push(new FieldPath("items", id), deleteField());
    if (stored.periodId !== periodId) args.push(new FieldPath("periodId"), periodId);
    if (!args.length) return;
    const [f, v, ...rest] = args as [FieldPath, unknown, ...unknown[]];
    tx.update(ref, f, v, ...rest);
  });
}

/** Writes one whole line into the draft (creating the draft if needed; merge, never replace). */
export async function addLine(hid: string, periodId: string, id: string, item: GroceryItem, draftExists: boolean): Promise<void> {
  if (draftExists) await updateDoc(draftRef(hid), new FieldPath("items", id), item);
  // Two quick writes can both think the draft is missing: merge so neither replaces the other.
  else await setDoc(draftRef(hid), { periodId, status: "draft", createdAt: serverTimestamp(), items: { [id]: item } }, { merge: true });
}

export async function addManualItem(hid: string, periodId: string, item: GroceryItem, draftExists: boolean): Promise<string> {
  const id = `manual_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await addLine(hid, periodId, id, item, draftExists);
  return id;
}

export function removeItem(hid: string, listId: string, itemId: string) {
  return updateDoc(doc(db, "households", hid, "groceryLists", listId), new FieldPath("items", itemId), deleteField());
}

export function tickItem(hid: string, listId: string, itemId: string, checked: boolean, uid: string) {
  return updateDoc(
    doc(db, "households", hid, "groceryLists", listId),
    new FieldPath("items", itemId, "checked"),
    checked,
    new FieldPath("items", itemId, "checkedBy"),
    checked ? uid : deleteField(),
  );
}

/**
 * The Copy button (R7.5): the draft's items move into a new list with status `ordered` (who and when), and the draft
 * empties. Ordered items count as incoming, so regenerating doesn't add them again (§8).
 */
export async function orderDraft(hid: string, periodId: string, items: Record<string, GroceryItem>, uid: string): Promise<string> {
  const b = writeBatch(db);
  const ref = doc(collection(db, "households", hid, "groceryLists"));
  b.set(ref, { periodId, status: "ordered", createdAt: serverTimestamp(), orderedAt: serverTimestamp(), orderedBy: uid, items });
  b.update(draftRef(hid), { items: {} });
  await b.commit();
  return ref.id;
}

/** Undo: the order wasn't placed. Its items go back into the draft (ticks kept) and the ordered list is deleted. */
export async function undoOrder(hid: string, listId: string): Promise<void> {
  const ref = doc(db, "households", hid, "groceryLists", listId);
  const snap = await getDoc(ref);
  const list = snap.data() as StoredList | undefined;
  const b = writeBatch(db);
  if (list && Object.keys(list.items).length) {
    const args: unknown[] = [];
    for (const [id, it] of Object.entries(list.items)) args.push(new FieldPath("items", id), it);
    const [f, v, ...rest] = args as [FieldPath, unknown, ...unknown[]];
    b.update(draftRef(hid), f, v, ...rest);
  }
  b.delete(ref);
  await b.commit();
}

/**
 * "Save this meal?" from the review flow (R5.8): writes the saved meal and points the plan item at it. Returns the new
 * meal's ID at once (writes queue offline); a plan item that's gone since is skipped.
 */
export function saveMealFromReview(hid: string, planItemId: string | undefined, name: string, recipes: readonly RecipeRef[], uid: string): string {
  const mRef = doc(collection(db, "meals"));
  void setDoc(mRef, { ...newMeal(name, recipes, uid), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch((e) => console.error("save meal failed", e));
  if (planItemId) void updateDoc(doc(db, "households", hid, "planItems", planItemId), { savedMealId: mRef.id, name: name.trim() }).catch(() => undefined);
  return mRef.id;
}
