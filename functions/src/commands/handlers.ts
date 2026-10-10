// One handler per command type (TECHNICAL_SPECS §6 table). Each runs inside the command's transaction: reads first
// (supply docs, plan items, lists, events), then the core ledger math, then writes. Global docs (ingredients,
// recipes) are read outside the transaction through the context's caches: they change rarely and needn't lock.
import { FieldValue, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import {
  addLocalDays,
  applyCorrection,
  applyPurchase,
  consumeFEFO,
  cookedCoverage,
  discardLot,
  estimateExpiry,
  EXTEND_DEFAULT_DAYS,
  extendExpiry,
  freezeLot,
  frozenExpiry,
  LEFTOVER_FREEZER_DAYS,
  leftoverExpiry,
  leftoverMealTypeOf,
  leftoverPortionsByType,
  leftoverSupplyId,
  mealRequirements,
  newLotFor,
  ratingId,
  refund,
  reviewDeltas,
  statsId,
  thawLot,
  THAWED_DAYS,
  toMap,
  totalPortions,
  updateCadence,
  type AnyCommand,
  type CommandPayload,
  type IngredientDoc,
  type LedgerLot,
  type MealType,
  type PlannableMealType,
  type RecipeDoc,
} from "@solving-food/core";
import { db } from "../admin";
import { CommandError, toMs, ts, type SupplyStore } from "./store";

export interface Ctx {
  tx: Transaction;
  hid: string;
  uid: string;
  cmdId: string;
  nowMs: number;
  tz: string;
  currentPeriodId: string | null;
  store: SupplyStore;
  ingredient(id: string): Promise<(IngredientDoc & { id: string }) | undefined>;
  recipe(id: string): Promise<(RecipeDoc & { id: string }) | undefined>;
}

/** What a handler reports back: a short note for no-op outcomes ("already cooked"). */
export type Outcome = string | undefined;

const hh = (ctx: Ctx, path: string) => db.doc(`households/${ctx.hid}/${path}`);

async function ingredientsFor(ctx: Ctx, ids: Iterable<string>) {
  const out = new Map<string, IngredientDoc & { id: string }>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const i = await ctx.ingredient(id);
      if (i) out.set(id, i);
    }),
  );
  return out;
}

function supplyInit(ing: IngredientDoc & { id: string }) {
  return () => ({ ingredientId: ing.id, label: ing.name, canonicalUnit: ing.canonicalUnit });
}

function purchaseLot(ctx: Ctx, lotId: string, amount: number, ing: IngredientDoc, location = ing.defaultLocation): LedgerLot {
  const lot = newLotFor(lotId, amount, location, ing.shelfLifeDays, ctx.nowMs, ctx.tz);
  // Something that lives in the freezer is frozen from the start.
  if (location === "freezer") return { ...lot, frozenAtMs: ctx.nowMs, expiresFrozenMs: lot.expiresFreshMs ?? null, expiresFreshMs: null };
  return lot;
}

// ---------- addSupply (R8.2)

export async function addSupply(ctx: Ctx, p: CommandPayload<"addSupply">): Promise<Outcome> {
  const ing = await ctx.ingredient(p.ingredientId);
  if (!ing) throw new CommandError(`Unknown ingredient ${p.ingredientId}`);
  if (ing.freeUse) {
    // Free-use staples aren't tracked by amount (R8.14): adding one only records the date for the cadence.
    const ref = hh(ctx, `cadence/${ing.id}`);
    const prev = await ctx.tx.get(ref);
    writeCadence(ctx, ref, prev.exists ? prev.data()! : null);
    return "staple: last bought updated";
  }
  await ctx.store.load([ing.id]);
  const d = ctx.store.ensure(ing.id, supplyInit(ing));
  ctx.store.apply(ing.id, applyPurchase(d.lots, purchaseLot(ctx, ctx.cmdId, p.amount, ing, p.location), "purchase", p.entered ? `added ${p.entered}` : "added"), { clearShort: true });
  ctx.store.commit();
  return undefined;
}

function writeCadence(ctx: Ctx, ref: DocumentReference, prev: Record<string, unknown> | null) {
  const next = updateCadence(
    prev ? { avgIntervalDays: (prev.avgIntervalDays as number | null) ?? null, lastPurchasedAtMs: toMs(prev.lastPurchasedAt), purchaseCount: (prev.purchaseCount as number | undefined) ?? 1 } : null,
    ctx.nowMs,
  );
  ctx.tx.set(ref, { avgIntervalDays: next.avgIntervalDays, lastPurchasedAt: ts(next.lastPurchasedAtMs!), purchaseCount: next.purchaseCount }, { merge: true });
}

// ---------- receiveGroceries (R7.8, R7.9, §8 cadence)

export async function receiveGroceries(ctx: Ctx, p: CommandPayload<"receiveGroceries">): Promise<Outcome> {
  const listRef = hh(ctx, `groceryLists/${p.listId}`);
  const list = await ctx.tx.get(listRef);
  if (!list.exists) throw new CommandError("That grocery list is gone");
  const listData = list.data()!;
  if (listData.status === "received") return "already received";
  if (listData.status !== "ordered") throw new CommandError("Only an ordered list can be received");
  const items = (listData.items ?? {}) as Record<string, { amount?: number; estPriceCents?: number | null }>;

  const bought = p.items.filter((i) => i.ingredientId && !i.missing && i.amount > 0);
  const ings = await ingredientsFor(ctx, bought.map((i) => i.ingredientId!));
  const tracked = bought.filter((i) => ings.get(i.ingredientId!) && !ings.get(i.ingredientId!)!.freeUse);
  const cadenceIds = [...new Set(bought.filter((i) => ings.has(i.ingredientId!)).map((i) => i.ingredientId!))];
  const cadenceRefs = cadenceIds.map((id) => hh(ctx, `cadence/${id}`));
  const cadenceSnaps = cadenceRefs.length ? await ctx.tx.getAll(...cadenceRefs) : [];
  await ctx.store.load(tracked.map((i) => i.ingredientId!));

  for (const it of tracked) {
    const ing = ings.get(it.ingredientId!)!;
    const d = ctx.store.ensure(ing.id, supplyInit(ing));
    const lotId = `${ctx.cmdId}-${it.itemId}`.slice(0, 200);
    let r = applyPurchase(d.lots, purchaseLot(ctx, lotId, it.amount, ing), "purchase", "groceries arrived");
    const ref = { type: "groceryList", id: p.listId };
    ctx.store.apply(ing.id, r, { ref, clearShort: true });
    if (it.freezeAmount && it.freezeAmount > 0 && ing.defaultLocation !== "freezer") {
      r = freezeLot(r.lots, lotId, it.freezeAmount, ctx.nowMs, frozenExpiry(ing.shelfLifeDays, ctx.nowMs, ctx.tz));
      ctx.store.apply(ing.id, r, { ref });
    }
  }
  cadenceSnaps.forEach((s, i) => writeCadence(ctx, cadenceRefs[i]!, s.exists ? s.data()! : null));

  // The list: received, with what arrived and its estimated cost (the period's spend, R10.3).
  const update: Record<string, unknown> = { status: "received", receivedAt: ts(ctx.nowMs), receivedBy: ctx.uid };
  let cents = 0;
  const byItem = new Map(p.items.map((i) => [i.itemId, i]));
  for (const [itemId, it] of Object.entries(items)) {
    const got = byItem.get(itemId);
    const amount = it.amount ?? 0;
    const received = got ? (got.missing ? 0 : got.amount) : amount; // unchanged lines arrived as listed (R7.8)
    if (got) {
      update[`items.${itemId}.receivedAmount`] = received;
      if (got.ingredientId) update[`items.${itemId}.receivedIngredientId`] = got.ingredientId;
    }
    if (it.estPriceCents) cents += amount > 0 ? Math.round((it.estPriceCents * received) / amount) : got?.missing ? 0 : it.estPriceCents;
  }
  update.receivedCents = Math.max(0, cents);
  ctx.store.commit();
  ctx.tx.update(listRef, update);
  return undefined;
}

// ---------- finishCooking (R9.3, R6.8–R6.10)

export async function finishCooking(ctx: Ctx, p: CommandPayload<"finishCooking">): Promise<Outcome> {
  const eventRef = hh(ctx, `cookEvents/${p.cookEventId}`);
  const planRef = p.planItemId ? hh(ctx, `planItems/${p.planItemId}`) : null;
  const [event, plan] = await Promise.all([ctx.tx.get(eventRef), planRef ? ctx.tx.get(planRef) : Promise.resolve(null)]);
  if (event.exists) return "already finished";
  const planData = plan?.exists ? plan.data()! : null;
  // Double-finish guard (§6): two members finishing the same meal.
  if (planData && planData.status !== "planned") return "already cooked";

  const recipes = (await Promise.all(p.recipes.map((r) => ctx.recipe(r.recipeId)))).map((r, i) => ({ ref: p.recipes[i]!, doc: r }));
  const present = recipes.filter((r) => r.doc);
  const ings = await ingredientsFor(
    ctx,
    present.flatMap((r) => r.doc!.ingredientIds ?? []),
  );
  const byId = new Map(present.map((r) => [r.ref.recipeId, r.doc!]));
  const needs = mealRequirements(
    present.map((r) => r.ref),
    p.servings,
    { recipes: (id) => byId.get(id), ingredients: (id) => ings.get(id) },
  );
  const titles = recipes.map((r) => r.doc?.title ?? "Recipe");
  const title = p.title ?? (planData?.name as string | undefined) ?? titles.join(" + ");
  const mealType: MealType = p.mealType ?? (planData?.mealType as MealType | undefined) ?? "dinner";

  const by = leftoverPortionsByType(
    present.map((r) => r.ref),
    (id) => byId.get(id),
  );
  const portions = totalPortions(by);
  const loId = leftoverSupplyId(p.cookEventId);
  await ctx.store.load([...needs.keys(), ...(portions > 0 ? [loId] : [])]);

  const ref = { type: "cookEvent", id: p.cookEventId };
  const takes: Array<{ ingredientId: string; lotId: string; amount: number }> = [];
  const deducted: Array<{ ingredientId: string; canonicalAmount: number }> = [];
  for (const [id, amount] of needs) {
    const d = ctx.store.get(id);
    if (!d) {
      deducted.push({ ingredientId: id, canonicalAmount: 0 });
      continue;
    }
    const r = consumeFEFO(d.lots, amount, ctx.nowMs, "cook", title);
    ctx.store.apply(id, r, { ref, short: r.short > 0 });
    for (const t of r.takes) takes.push({ ingredientId: id, lotId: t.lotId, amount: t.amount });
    deducted.push({ ingredientId: id, canonicalAmount: r.takes.reduce((s, t) => s + t.amount, 0) });
  }

  // Leftovers: one supply lot of portions (4 days in the fridge) and one plan item per portion (§7).
  const leftoverItemIds: string[] = [];
  const periodId = ctx.currentPeriodId ?? (planData?.periodId as string | undefined) ?? null;
  if (portions > 0) {
    const loType = leftoverMealTypeOf(by);
    const d = ctx.store.ensure(loId, () => ({ label: title, canonicalUnit: "count", cookEventId: p.cookEventId, leftoverMealType: loType }));
    ctx.store.apply(loId, applyPurchase(d.lots, { lotId: p.cookEventId, amount: portions, location: "fridge", acquiredAtMs: ctx.nowMs, expiresFreshMs: leftoverExpiry(ctx.nowMs, ctx.tz) }, "leftover", title), { ref });
    if (periodId) {
      let n = 0;
      for (const [t, count] of Object.entries(by) as Array<[PlannableMealType, number]>) {
        for (let i = 0; i < count; i++) {
          const id = `${p.cookEventId}_lo${++n}`;
          leftoverItemIds.push(id);
          ctx.tx.set(hh(ctx, `planItems/${id}`), leftoverItem(ctx, { periodId, mealType: t, title, loId, sourcePlanItemId: p.planItemId }));
        }
      }
    }
  }
  ctx.store.commit();

  if (planRef && planData) ctx.tx.update(planRef, { status: "cooked", coverage: cookedCoverage(planData.mealType as MealType) });

  const savedMealId = p.savedMealId ?? (planData?.savedMealId as string | undefined);
  const defaults = [...needs].map(([ingredientId, canonicalAmount]) => ({ ingredientId, canonicalAmount: round(canonicalAmount) }));
  const eventDoc: Record<string, unknown> = {
    recipeIds: present.map((r) => r.ref.recipeId),
    titles: present.map((r) => r.doc!.title),
    title,
    mealType,
    servings: p.servings,
    cookedBy: ctx.uid,
    cookedAt: ts(ctx.nowMs),
    used: defaults,
    defaults,
    deducted: deducted.map((d) => ({ ...d, canonicalAmount: round(d.canonicalAmount) })),
    takes,
    leftoverPortions: portions,
    leftoverPlanItemIds: leftoverItemIds,
    reviewStatus: "pending",
    ratedBy: [],
  };
  if (p.planItemId) eventDoc.planItemId = p.planItemId;
  if (periodId) eventDoc.periodId = periodId;
  if (savedMealId) eventDoc.savedMealId = savedMealId;
  if (portions > 0) eventDoc.leftoverSupplyId = loId;
  ctx.tx.set(eventRef, eventDoc);

  // "Made n times" and last cooked (R4.5) count at cooking; ratings arrive with the review.
  const statsRefs = [...present.map((r) => statsId("recipe", r.ref.recipeId)), ...(savedMealId ? [statsId("meal", savedMealId)] : [])];
  for (const sid of new Set(statsRefs)) {
    ctx.tx.set(hh(ctx, `stats/${sid}`), { timesCooked: FieldValue.increment(1), lastCookedAt: ts(ctx.nowMs), ratingSum: FieldValue.increment(0), ratingCount: FieldValue.increment(0) }, { merge: true });
  }
  return undefined;
}

function leftoverItem(ctx: Ctx, o: { periodId: string; mealType: MealType; title: string; loId: string; sourcePlanItemId?: string | undefined }) {
  const doc: Record<string, unknown> = {
    periodId: o.periodId,
    kind: "leftover",
    mealType: o.mealType,
    servings: 1,
    recipes: [],
    name: o.title.slice(0, 80),
    leftoverSupplyId: o.loId,
    coverage: cookedCoverage(o.mealType),
    status: "planned",
    addedBy: ctx.uid,
    addedAt: FieldValue.serverTimestamp(),
  };
  if (o.sourcePlanItemId) doc.sourcePlanItemId = o.sourcePlanItemId;
  return doc;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

// ---------- submitReview (R9.2–R9.4, R5.3, R6.9)

export async function submitReview(ctx: Ctx, p: CommandPayload<"submitReview">): Promise<Outcome> {
  const eventRef = hh(ctx, `cookEvents/${p.cookEventId}`);
  const event = await ctx.tx.get(eventRef);
  if (!event.exists) throw new CommandError("That cooked meal is gone");
  const e = event.data()!;
  const savedMealId = (e.savedMealId as string | undefined) ?? p.savedMealId;
  const recipeIds = new Set((e.recipeIds as string[]) ?? []);
  const ratings = p.ratings.filter((r) => (r.targetType === "recipe" ? recipeIds.has(r.targetId) : r.targetId === savedMealId));
  const ratingRefs = ratings.map((r) => hh(ctx, `ratings/${ratingId(p.cookEventId, ctx.uid, r.targetType, r.targetId)}`));
  const old = ratingRefs.length ? await ctx.tx.getAll(...ratingRefs) : [];

  const doCorrect = !!p.used && e.reviewStatus === "pending";
  const eventUpdate: Record<string, unknown> = {};
  let leftoverRefs: DocumentReference[] = [];
  let leftoverSnaps: FirebaseFirestore.DocumentSnapshot[] = [];
  const loId = (e.leftoverSupplyId as string | undefined) ?? leftoverSupplyId(p.cookEventId);
  const oldPortions = (e.leftoverPortions as number) ?? 0;
  const newPortions = p.leftoverPortions ?? oldPortions;

  let deltas: Array<{ ingredientId: string; delta: number }> = [];
  let ings = new Map<string, IngredientDoc & { id: string }>();
  if (doCorrect) {
    const ids = [...new Set([...(p.used ?? []).map((u) => u.ingredientId), ...((e.deducted ?? []) as Array<{ ingredientId: string }>).map((u) => u.ingredientId)])];
    ings = await ingredientsFor(ctx, ids);
    const confirmed = toMap((p.used ?? []).filter((u) => ings.has(u.ingredientId) && !ings.get(u.ingredientId)!.freeUse));
    const deducted = toMap((e.deducted ?? []) as Array<{ ingredientId: string; canonicalAmount: number }>);
    deltas = reviewDeltas(deducted, confirmed);
    if (newPortions !== oldPortions) {
      leftoverRefs = ((e.leftoverPlanItemIds ?? []) as string[]).map((id) => hh(ctx, `planItems/${id}`));
      leftoverSnaps = leftoverRefs.length ? await ctx.tx.getAll(...leftoverRefs) : [];
    }
    await ctx.store.load([...deltas.map((d) => d.ingredientId), ...(newPortions !== oldPortions ? [loId] : [])]);
  }

  // Ratings: one per person, event, and target; re-rating replaces and adjusts the stats.
  ratings.forEach((r, i) => {
    const prev = old[i]!.exists ? (old[i]!.data()!.score as number) : null;
    ctx.tx.set(ratingRefs[i]!, { uid: ctx.uid, cookEventId: p.cookEventId, targetType: r.targetType, targetId: r.targetId, score: r.score, createdAt: FieldValue.serverTimestamp() });
    ctx.tx.set(
      hh(ctx, `stats/${statsId(r.targetType, r.targetId)}`),
      { ratingSum: FieldValue.increment(r.score - (prev ?? 0)), ratingCount: FieldValue.increment(prev === null ? 1 : 0), timesCooked: FieldValue.increment(0) },
      { merge: true },
    );
  });
  if (ratings.length) eventUpdate.ratedBy = FieldValue.arrayUnion(ctx.uid);
  if (p.savedMealId && !e.savedMealId) eventUpdate.savedMealId = p.savedMealId;
  if (p.note) eventUpdate.note = p.note;

  if (doCorrect) {
    const ref = { type: "cookEvent", id: p.cookEventId };
    const takes = [...((e.takes ?? []) as Array<{ ingredientId: string; lotId: string; amount: number }>)];
    const deducted = toMap((e.deducted ?? []) as Array<{ ingredientId: string; canonicalAmount: number }>);
    for (const { ingredientId, delta } of deltas) {
      const ing = ings.get(ingredientId);
      if (delta > 0) {
        const d = ctx.store.get(ingredientId);
        if (!d) continue; // nothing in supply to take it from
        const r = consumeFEFO(d.lots, delta, ctx.nowMs, "correction", "review: used more");
        ctx.store.apply(ingredientId, r, { ref, short: r.short > 0 });
        for (const t of r.takes) takes.push({ ingredientId, lotId: t.lotId, amount: t.amount });
        deducted.set(ingredientId, (deducted.get(ingredientId) ?? 0) + r.takes.reduce((s, t) => s + t.amount, 0));
      } else if (ing) {
        const d = ctx.store.ensure(ingredientId, supplyInit(ing));
        const mine = takes.filter((t) => t.ingredientId === ingredientId);
        const r = refund(d.lots, mine, -delta, () => purchaseLot(ctx, `${ctx.cmdId}-${ingredientId}`.slice(0, 200), 0, ing), "correction", "review: used less");
        ctx.store.apply(ingredientId, r, { ref });
        let back = -delta;
        for (const t of [...mine].reverse()) {
          const x = Math.min(t.amount, back);
          t.amount = round(t.amount - x);
          back -= x;
        }
        deducted.set(ingredientId, Math.max(0, (deducted.get(ingredientId) ?? 0) + delta));
      }
    }

    // Leftovers: resize the batch and its plan items to the confirmed count (R6.9).
    if (newPortions !== oldPortions) {
      const diff = newPortions - oldPortions;
      const lo = ctx.store.get(loId);
      const loType = (lo?.leftoverMealType ?? "lunch") as MealType;
      if (diff > 0) {
        const d = ctx.store.ensure(loId, () => ({ label: String(e.title ?? (e.titles as string[]).join(" + ")), canonicalUnit: "count", cookEventId: p.cookEventId, leftoverMealType: "lunch" }));
        const lotTemplate = () => ({ lotId: p.cookEventId, amount: 0, location: "fridge" as const, acquiredAtMs: toMs(e.cookedAt) ?? ctx.nowMs, expiresFreshMs: leftoverExpiry(toMs(e.cookedAt) ?? ctx.nowMs, ctx.tz) });
        const current = d.lots.reduce((s, l) => s + l.amount, 0);
        ctx.store.apply(loId, applyCorrection(d.lots, current + diff, ctx.nowMs, lotTemplate, "review: more leftovers"), { ref });
      } else if (lo) {
        ctx.store.apply(loId, consumeFEFO(lo.lots, -diff, ctx.nowMs, "correction", "review: fewer leftovers"), { ref });
      }
      const ids = [...((e.leftoverPlanItemIds ?? []) as string[])];
      const periodId = ctx.currentPeriodId ?? (e.periodId as string | undefined);
      if (diff > 0 && periodId) {
        let n = ids.length;
        for (let i = 0; i < diff; i++) {
          let id = `${p.cookEventId}_lo${++n}`;
          while (ids.includes(id)) id = `${p.cookEventId}_lo${++n}`;
          ids.push(id);
          ctx.tx.set(hh(ctx, `planItems/${id}`), leftoverItem(ctx, { periodId, mealType: loType, title: String(e.title ?? (e.titles as string[]).join(" + ")), loId, sourcePlanItemId: e.planItemId as string | undefined }));
        }
      } else if (diff < 0) {
        let drop = -diff;
        for (let i = leftoverSnaps.length - 1; i >= 0 && drop > 0; i--) {
          const s = leftoverSnaps[i]!;
          if (!s.exists || s.data()!.status !== "planned") continue;
          ctx.tx.delete(leftoverRefs[i]!);
          ids.splice(ids.indexOf(s.id), 1);
          drop--;
        }
      }
      eventUpdate.leftoverPlanItemIds = ids;
      eventUpdate.leftoverPortions = newPortions;
      if (newPortions > 0) eventUpdate.leftoverSupplyId = loId;
    }
    ctx.store.commit();
    eventUpdate.used = (p.used ?? []).map((u) => ({ ingredientId: u.ingredientId, canonicalAmount: round(u.canonicalAmount) }));
    eventUpdate.deducted = [...deducted].map(([ingredientId, canonicalAmount]) => ({ ingredientId, canonicalAmount: round(canonicalAmount) }));
    eventUpdate.takes = takes.filter((t) => t.amount > 1e-6);
    eventUpdate.reviewStatus = "done";
    eventUpdate.reviewedBy = ctx.uid;
  }
  if (Object.keys(eventUpdate).length) ctx.tx.update(eventRef, eventUpdate);
  return doCorrect || !p.used ? undefined : "already reviewed: ratings added";
}

// ---------- correctSupply, discard, extendExpiry, freeze, thaw (R8.6, R8.8, R8.15)

async function ingredientForSupply(ctx: Ctx, supplyId: string, fallbackId?: string) {
  const d = ctx.store.get(supplyId);
  const id = d?.ingredientId ?? fallbackId ?? (supplyId.startsWith("leftover_") ? undefined : supplyId);
  return id ? ctx.ingredient(id) : undefined;
}

export async function correctSupply(ctx: Ctx, p: CommandPayload<"correctSupply">): Promise<Outcome> {
  await ctx.store.load([p.supplyId]);
  const ing = await ingredientForSupply(ctx, p.supplyId, p.ingredientId);
  let d = ctx.store.get(p.supplyId);
  if (!d) {
    if (!ing) throw new CommandError("Nothing to correct");
    d = ctx.store.ensure(p.supplyId, supplyInit(ing));
  }
  const fallback = (): LedgerLot =>
    ing ? purchaseLot(ctx, ctx.cmdId, 0, ing) : { lotId: ctx.cmdId, amount: 0, location: "fridge", acquiredAtMs: ctx.nowMs, expiresFreshMs: leftoverExpiry(ctx.nowMs, ctx.tz) };
  const note = p.note ?? `I actually have ${round(p.target)}`;
  ctx.store.apply(p.supplyId, applyCorrection(d.lots, p.target, ctx.nowMs, fallback, note), { clearShort: true });
  ctx.store.commit();
  return undefined;
}

async function lotOf(ctx: Ctx, supplyId: string, lotId: string) {
  await ctx.store.load([supplyId]);
  const d = ctx.store.get(supplyId);
  if (!d || !d.lots.some((l) => l.lotId === lotId)) throw new CommandError("That purchase is no longer in supply");
  return d;
}

export async function discard(ctx: Ctx, p: CommandPayload<"discard">): Promise<Outcome> {
  const d = await lotOf(ctx, p.supplyId, p.lotId);
  ctx.store.apply(p.supplyId, discardLot(d.lots, p.lotId, p.amount, "threw it out"));
  ctx.store.commit();
  return undefined;
}

export async function extendExpiryCmd(ctx: Ctx, p: CommandPayload<"extendExpiry">): Promise<Outcome> {
  const d = await lotOf(ctx, p.supplyId, p.lotId);
  const until = p.until ?? addLocalDays(ctx.nowMs, EXTEND_DEFAULT_DAYS, ctx.tz);
  if (until <= ctx.nowMs) throw new CommandError("Pick a date after today");
  ctx.store.apply(p.supplyId, extendExpiry(d.lots, p.lotId, until));
  ctx.store.commit();
  return undefined;
}

export async function freeze(ctx: Ctx, p: CommandPayload<"freeze">): Promise<Outcome> {
  const d = await lotOf(ctx, p.supplyId, p.lotId);
  const ing = await ingredientForSupply(ctx, p.supplyId);
  if (ing && !ing.freezable) throw new CommandError(`${ing.name} doesn't freeze well`);
  const exp = ing ? (frozenExpiry(ing.shelfLifeDays, ctx.nowMs, ctx.tz) ?? estimateExpiry({ freezer: 180 }, "freezer", ctx.nowMs, ctx.tz)) : addLocalDays(ctx.nowMs, LEFTOVER_FREEZER_DAYS, ctx.tz);
  const r = freezeLot(d.lots, p.lotId, p.amount, ctx.nowMs, exp);
  if (!r.txs.length) return "already frozen";
  ctx.store.apply(p.supplyId, r);
  ctx.store.commit();
  return undefined;
}

export async function thaw(ctx: Ctx, p: CommandPayload<"thaw">): Promise<Outcome> {
  const d = await lotOf(ctx, p.supplyId, p.lotId);
  const r = thawLot(d.lots, p.lotId, p.amount, addLocalDays(ctx.nowMs, THAWED_DAYS, ctx.tz));
  if (!r.txs.length) return "not frozen";
  ctx.store.apply(p.supplyId, r);
  ctx.store.commit();
  return undefined;
}

// ---------- markEaten (R9.5)

export async function markEaten(ctx: Ctx, p: CommandPayload<"markEaten">): Promise<Outcome> {
  const ref = hh(ctx, `planItems/${p.planItemId}`);
  const snap = await ctx.tx.get(ref);
  if (!snap.exists) throw new CommandError("That plan item is gone");
  const it = snap.data()!;
  if (it.status === "eaten") return "already eaten";
  const txRef = { type: "planItem", id: p.planItemId };
  if (it.kind === "leftover") {
    const sid = it.leftoverSupplyId as string | undefined;
    if (sid) {
      await ctx.store.load([sid]);
      const d = ctx.store.get(sid);
      if (d) {
        const r = consumeFEFO(d.lots, 1, ctx.nowMs, "eaten", "ate a portion");
        ctx.store.apply(sid, r, { ref: txRef });
      }
    }
  } else if (it.status === "planned") {
    if (it.mealType !== "snack") throw new CommandError("Cook it first: Done cooking marks it cooked");
    // A snack eaten as is: its ingredients come out of supply like a cooked meal's.
    const refs = (it.recipes ?? []) as Array<{ recipeId: string; servingsMultiplier: number }>;
    const docs = new Map((await Promise.all(refs.map((r) => ctx.recipe(r.recipeId)))).filter((r): r is RecipeDoc & { id: string } => !!r).map((r) => [r.id, r]));
    const ings = await ingredientsFor(ctx, [...docs.values()].flatMap((r) => r.ingredientIds ?? []));
    const needs = mealRequirements(refs, it.servings as number, { recipes: (id) => docs.get(id), ingredients: (id) => ings.get(id) });
    await ctx.store.load(needs.keys());
    for (const [id, amount] of needs) {
      const d = ctx.store.get(id);
      if (!d) continue;
      const r = consumeFEFO(d.lots, amount, ctx.nowMs, "eaten", String(it.name ?? "snack"));
      ctx.store.apply(id, r, { ref: txRef, short: r.short > 0 });
    }
  } else if (it.status !== "cooked") {
    throw new CommandError(`Can't mark a ${it.status} item eaten`);
  }
  ctx.store.commit();
  ctx.tx.update(ref, { status: "eaten" });
  return undefined;
}

// ---------- importHousehold (§13) runs outside the transaction: see ../importHousehold.ts

export async function runHandler(ctx: Ctx, c: AnyCommand): Promise<Outcome> {
  switch (c.type) {
    case "addSupply":
      return addSupply(ctx, c.payload);
    case "receiveGroceries":
      return receiveGroceries(ctx, c.payload);
    case "finishCooking":
      return finishCooking(ctx, c.payload);
    case "submitReview":
      return submitReview(ctx, c.payload);
    case "correctSupply":
      return correctSupply(ctx, c.payload);
    case "discard":
      return discard(ctx, c.payload);
    case "extendExpiry":
      return extendExpiryCmd(ctx, c.payload);
    case "freeze":
      return freeze(ctx, c.payload);
    case "thaw":
      return thaw(ctx, c.payload);
    case "markEaten":
      return markEaten(ctx, c.payload);
    case "importHousehold":
      throw new CommandError("importHousehold isn't applied in a transaction");
  }
}
