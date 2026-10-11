// Page helpers for the Plan, Create meal, Meals, and Grocery pages (TECHNICAL_SPECS §14.1 "Page objects").
import { expect, type Locator, type Page } from "@playwright/test";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firstPeriod, nextPeriod, periodBounds } from "../../packages/core/src/index";
import { adminDb } from "../fixtures/admin";
import { makeRecipe, uniqueTitle, waitForIndexed } from "../fixtures/recipes";

export const TZ = "America/Toronto";

/** A small recipe of the spec's own with known ingredients (all priced in data/price-estimates.json). */
export function cook(opts: { servings?: number; lines: string; tags?: string[]; leftovers?: number; tools?: string; cuisine?: string; protein?: string } = { lines: "" }): string {
  return `---
title: x
servings: ${opts.servings ?? 4}
cuisine: ${opts.cuisine ?? "other"}
main_protein: ${opts.protein ?? "chicken"}
prep_time: 10
cook_time: 20
tags: [${(opts.tags ?? ["dinner"]).join(", ")}]
leftover_portions: ${opts.leftovers ?? 0}
---

${opts.lines}${opts.tools ? ` Use the #${opts.tools}{}.` : ""}
`;
}

/**
 * The chicken recipe the budget and grocery specs use. 4 servings: 600 g chicken thigh (1 × 1 kg pack, $12.99),
 * 140 g baby spinach (1 × 312 g bag, $4.99), olive oil (free-use: never on the list). $17.98 for one plan at 4 servings.
 */
export const CHICKEN_LINES = "Sear @chicken thigh{600%g} in @olive oil{2%tbsp}, then wilt @baby spinach{140%g}.";

/**
 * Created once per worker and reused by later tests in it (each test has its own household, and these recipes are
 * never edited): every recipe write re-sends the index chunk to every open page, and a full run creating a fresh one
 * per test ran the Firestore emulator out of heap.
 */
const planRecipes = new Map<string, Promise<{ id: string; title: string }>>();
export function makePlanRecipe(base: string, opts: Parameters<typeof cook>[0] = { lines: CHICKEN_LINES }): Promise<{ id: string; title: string }> {
  const key = JSON.stringify([base, opts]);
  let p = planRecipes.get(key);
  if (!p) {
    p = (async () => {
      const title = uniqueTitle(base);
      const id = await makeRecipe(title, { cook: cook(opts), ...(opts.cuisine ? { content: { cuisine: opts.cuisine as never } } : {}) });
      await waitForIndexed(id);
      return { id, title };
    })();
    p.catch(() => planRecipes.delete(key));
    planRecipes.set(key, p);
  }
  return p;
}

/** Seeds the household's current period (the client would otherwise create it on open). */
export async function seedPeriod(hid: string, opts: { startDate?: string; days?: number; budgetCents?: number } = {}): Promise<string> {
  const days = opts.days ?? 7;
  const b = opts.startDate ? periodBounds(opts.startDate, days, TZ) : firstPeriod(Date.now(), days, TZ);
  await adminDb.doc(`households/${hid}/periods/${b.id}`).set({ start: Timestamp.fromMillis(b.startMs), end: Timestamp.fromMillis(b.endMs), budgetCents: opts.budgetCents ?? 20000 });
  await adminDb.doc(`households/${hid}`).update({ currentPeriodId: b.id, periodDays: days, ...(opts.budgetCents !== undefined ? { budgetCents: opts.budgetCents } : {}) });
  return b.id;
}

/** A plan item written directly (the UI path is covered by the Create meal specs). */
export async function seedPlanItem(hid: string, periodId: string, recipeIds: string[], extra: Record<string, unknown> = {}): Promise<string> {
  const ref = adminDb.collection(`households/${hid}/planItems`).doc();
  await ref.set({
    periodId,
    kind: "meal",
    mealType: "dinner",
    servings: 4,
    recipes: recipeIds.map((recipeId) => ({ recipeId, servingsMultiplier: 1 })),
    coverage: { dinner: 1 },
    status: "planned",
    addedBy: "e2e",
    addedAt: FieldValue.serverTimestamp(),
    ...extra,
  });
  return ref.id;
}

export { nextPeriod };

export class PlanPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/plan");
    await expect(this.page.getByTestId("period-range")).not.toHaveText(/SETTING UP/, { timeout: 20_000 });
    await expect(this.page.getByTestId("plan-count")).not.toHaveText("LOADING…");
  }

  /** The visible budget figure (the phone meter or the desktop card). */
  budgetLeft(): Locator {
    return this.page.locator('[data-testid="budget-left"]:visible');
  }
  meter(): Locator {
    return this.page.locator('[data-testid="budget-meter"]:visible');
  }
  item(title: string | RegExp): Locator {
    return this.page.getByTestId("plan-item").filter({ has: this.page.getByRole("button", { name: title, exact: typeof title === "string" }) });
  }
  stripCount(mealType: string): Locator {
    return this.page.getByTestId(`strip-count-${mealType}`);
  }

  async openCreateMeal(): Promise<Locator> {
    await this.page.getByRole("button", { name: "+ Create meal" }).first().click();
    const sheet = this.page.getByRole("dialog", { name: "Create meal" });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  /** Create meal through the UI: pick recipes by title (or a saved meal), then meal type, servings, optional save. */
  async createMeal(opts: { recipes?: string[]; savedMeal?: string; mealType?: string; servings?: number; saveAs?: string; sides?: string[] }): Promise<void> {
    const sheet = await this.openCreateMeal();
    if (opts.savedMeal) {
      await sheet.getByRole("tab", { name: /Saved meals/ }).click();
      await sheet.getByRole("button", { name: new RegExp(`^${escape(opts.savedMeal)}`) }).click();
    } else {
      for (const t of opts.recipes ?? []) {
        await sheet.getByRole("searchbox", { name: "Search recipes to add…" }).fill(t);
        await sheet.getByRole("checkbox", { name: new RegExp(`^${escape(t)}`) }).click();
      }
      await sheet.getByRole("button", { name: /^Next/ }).click();
    }
    await this.finish(opts);
  }

  /** Step 2 of Create meal (also reached directly from an "Add to plan" shortcut). */
  async finish(opts: { mealType?: string; servings?: number; saveAs?: string; sides?: string[] }): Promise<void> {
    const sheet = this.page.getByRole("dialog", { name: "Add to plan" });
    await expect(sheet).toBeVisible();
    if (opts.mealType) await sheet.getByRole("button", { name: opts.mealType, exact: true }).click();
    if (opts.servings) {
      const group = sheet.getByRole("group", { name: "SERVINGS" });
      for (let i = 0; i < 20; i++) {
        const v = Number(await group.getByRole("status").textContent());
        if (v === opts.servings) break;
        await group.getByRole("button", { name: v < opts.servings ? "More servings" : "Fewer servings" }).click();
        await expect(group.getByRole("status")).not.toHaveText(String(v));
      }
    }
    for (const side of opts.sides ?? []) await pickSide(sheet, side);
    if (opts.saveAs) {
      await sheet.getByRole("checkbox", { name: "Save as meal" }).check();
      await sheet.getByLabel(/^NAME/).fill(opts.saveAs);
    }
    await expect(sheet.getByTestId("budget-impact")).not.toContainText("Working it out", { timeout: 15_000 });
    await sheet.getByRole("button", { name: /^Add to plan/ }).click();
    await expect(sheet).toBeHidden();
  }
}

/** Picks a side (R5.9) in a <SidePicker>: type its name, choose the option that starts with it. */
export async function pickSide(scope: Locator, name: string, search = name): Promise<void> {
  const box = scope.getByRole("combobox", { name: "Add a side" });
  await box.fill(search);
  await scope.getByRole("option", { name: new RegExp(`^${escape(name)}`, "i") }).click();
  await expect(scope.getByRole("button", { name: new RegExp(`^Remove ${escape(name)}$`, "i") })).toBeVisible();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function planItems(hid: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  const snap = await adminDb.collection(`households/${hid}/planItems`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
