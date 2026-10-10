// Supply, cooking, and history helpers (TECHNICAL_SPECS §14.1 "Page objects"): seed supply lots with the Admin SDK
// (as the command function would leave them), read supply back, and wait for commands to be applied.
import { expect, type Locator, type Page } from "@playwright/test";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../fixtures/admin";

const DAY = 86_400_000;

export interface SeedLot {
  amount: number;
  location?: "pantry" | "cupboard" | "fridge" | "freezer";
  boughtDaysAgo?: number;
  /** Days until the fresh expiry (negative = already expired); null = never expires. */
  expiresInDays?: number | null;
  frozen?: { frozenDaysAgo: number; expiresInDays: number };
}

/** Writes a supply doc with lots, plus one purchase transaction per lot (so the ledger has rows). */
export async function seedSupply(hid: string, ingredientId: string, lots: SeedLot[], opts: { label?: string; unit?: "g" | "count"; at?: number } = {}): Promise<void> {
  const now = opts.at ?? Date.now();
  const docLots = lots.map((l, i) => {
    const lot: Record<string, unknown> = {
      lotId: `seed${i}`,
      amount: l.amount,
      location: l.frozen ? "freezer" : (l.location ?? "fridge"),
      acquiredAt: Timestamp.fromMillis(now - (l.boughtDaysAgo ?? 1) * DAY),
    };
    if (l.expiresInDays !== null && l.expiresInDays !== undefined) lot.expiresFresh = Timestamp.fromMillis(now + l.expiresInDays * DAY);
    if (l.frozen) {
      lot.frozenAt = Timestamp.fromMillis(now - l.frozen.frozenDaysAgo * DAY);
      lot.expiresFrozen = Timestamp.fromMillis(now + l.frozen.expiresInDays * DAY);
    }
    return lot;
  });
  const ref = adminDb.doc(`households/${hid}/supply/${ingredientId}`);
  const b = adminDb.batch();
  b.set(ref, { ingredientId, label: opts.label ?? ingredientId.replace(/-/g, " "), canonicalUnit: opts.unit ?? "g", canonicalAmount: lots.reduce((s, l) => s + l.amount, 0), lots: docLots, nextExpiry: null });
  docLots.forEach((l, i) => b.set(ref.collection("transactions").doc(`seed${i}`), { delta: l.amount, kind: "purchase", lotId: l.lotId, uid: "e2e", note: "seeded", createdAt: Timestamp.fromMillis(now - (lots[i]!.boughtDaysAgo ?? 1) * DAY) }));
  await b.commit();
}

export async function supplyDoc(hid: string, id: string): Promise<{ canonicalAmount: number; lots: Array<Record<string, unknown> & { amount: number; lotId: string }> } | undefined> {
  return (await adminDb.doc(`households/${hid}/supply/${id}`).get()).data() as never;
}

/**
 * Waits until at least `min` commands exist (the client's write may still be in flight) and every one has been applied
 * or failed; returns the failures.
 */
export async function commandsSettled(hid: string, min = 1, timeoutMs = 30_000): Promise<string[]> {
  await expect
    .poll(
      async () => {
        const all = await adminDb.collection(`households/${hid}/commands`).get();
        return all.size >= min && all.docs.every((d) => d.data().status !== "pending");
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
  return (await adminDb.collection(`households/${hid}/commands`).where("status", "==", "failed").get()).docs.map((d) => `${d.data().type}: ${d.data().error}`);
}

/** Polls a supply amount until it equals `want`. */
export async function expectSupply(hid: string, id: string, want: number, timeout = 30_000): Promise<void> {
  await expect.poll(async () => Math.round(((await supplyDoc(hid, id))?.canonicalAmount ?? 0) * 1000) / 1000, { timeout }).toBe(want);
}

export async function cookEvents(hid: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  return (await adminDb.collection(`households/${hid}/cookEvents`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** An ordered grocery list, as the Copy button leaves it. */
export async function seedOrderedList(hid: string, periodId: string, items: Record<string, Record<string, unknown>>, listId = `ord-${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  await adminDb.doc(`households/${hid}/groceryLists/${listId}`).set({ periodId, status: "ordered", createdAt: FieldValue.serverTimestamp(), orderedAt: FieldValue.serverTimestamp(), orderedBy: "e2e", items });
  return listId;
}

export function groceryLine(o: { ingredientId?: string; freeText?: string; amount: number; packAmount?: number | null; packLabel?: string; packs?: number; productName: string; storeId: string; estPriceCents?: number | null }) {
  return {
    ...(o.ingredientId ? { ingredientId: o.ingredientId } : {}),
    ...(o.freeText ? { freeText: o.freeText } : {}),
    amount: o.amount,
    measure: "g",
    need: o.amount,
    packAmount: o.packAmount ?? null,
    ...(o.packLabel ? { packLabel: o.packLabel } : {}),
    packs: o.packs ?? 1,
    productName: o.productName,
    storeId: o.storeId,
    estPriceCents: o.estPriceCents ?? null,
    priceSource: "estimate",
    source: o.freeText ? "manual" : "plan",
    checked: false,
  };
}

export class SupplyPage {
  constructor(readonly page: Page) {}
  async goto(query = ""): Promise<void> {
    await this.page.goto(`/supply${query}`);
    await expect(this.page.getByTestId("supply-count")).not.toHaveText("LOADING…", { timeout: 20_000 });
  }
  row(name: string | RegExp): Locator {
    return this.page.getByTestId("supply-row").filter({ has: this.page.getByRole("button", { name: typeof name === "string" ? new RegExp(`^${name}`, "i") : name }) });
  }
  async open(name: string): Promise<Locator> {
    const r = this.row(name);
    await r.getByRole("button").first().click();
    await expect(r.getByText("Purchases · expiry per purchase", { exact: false })).toBeVisible();
    return r;
  }
}

/**
 * A recipe for the cooking specs: prep tasks, three steps (one with a 10-minute timer, one with a 3-second timer for
 * the alarm), 600 g chicken thigh + 140 g spinach + olive oil (free-use), 2 leftover lunches. Made once per worker.
 */
const cookRecipes = new Map<string, Promise<{ id: string; title: string }>>();
export function makeCookRecipe(base: string, opts: { leftovers?: number; lines?: string } = {}): Promise<{ id: string; title: string }> {
  const key = JSON.stringify([base, opts]);
  let p = cookRecipes.get(key);
  if (!p) {
    p = (async () => {
      const { makeRecipe, uniqueTitle, waitForIndexed } = await import("../fixtures/recipes");
      const title = uniqueTitle(base);
      const text = `---
title: x
servings: 4
cuisine: other
main_protein: chicken
prep_time: 10
cook_time: 20
tags: [dinner]
leftover_portions: ${opts.leftovers ?? 2}
prep:
  - Dice the onion
  - Preheat the oven to 220°C
---

${opts.lines ?? "Sear @chicken thigh{600%g} in @olive oil{2%tbsp} for ~{10%minutes}."}

Add @baby spinach{140%g} and let it wilt for ~{3%seconds}.

Rest and serve.
`;
      const id = await makeRecipe(title, { cook: text });
      await waitForIndexed(id);
      return { id, title };
    })();
    p.catch(() => cookRecipes.delete(key));
    cookRecipes.set(key, p);
  }
  return p;
}

/** Records Screen Wake Lock requests (and fakes the API where the browser has none) before the app loads. */
export async function fakeWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wakeLocks: number };
    w.__wakeLocks = 0;
    const sentinel = () => ({ released: false, type: "screen", release: async () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => (w.__wakeLocks++, sentinel()) } });
  });
}
