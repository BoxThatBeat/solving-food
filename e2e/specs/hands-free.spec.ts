// hands-free.spec.ts (TECHNICAL_SPECS §14.1, M11): the hands-free toggle on mise en place, step mode and the review;
// what it reads and when; spoken commands; the microphone closed whenever it's off. Playwright has no microphone and
// can't run Whisper, so the emulator build's e2e seam replaces both (`window.__handsFreeFake`): a test says what was
// heard with `__handsFree.hear(text)` and reads `__handsFree.mic`. Speech synthesis is stubbed here and records what
// the app asked it to say.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { makeCookRecipe } from "../pages/supply";

interface Tts {
  spoken: string[];
  queue: unknown[];
  cancels: number;
}

async function fakeVoice(page: Page, opts: { enabled?: boolean; denyMic?: boolean } = {}) {
  await page.addInitScript((o) => {
    const w = window as unknown as Record<string, unknown>;
    w.__handsFreeFake = true;
    w.__handsFree = { mic: "off", loads: 0, denyMic: !!o.denyMic, hear: () => undefined };
    if (o.enabled) localStorage.setItem("sf.handsFree", "1");
    const log = { spoken: [] as string[], queue: [] as Array<{ onend?: (() => void) | null; onerror?: ((e: unknown) => void) | null }>, cancels: 0 };
    w.__tts = log;
    class Utterance {
      text: string;
      lang = "";
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onstart: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const synth = {
      get speaking() {
        return log.queue.length > 0;
      },
      get pending() {
        return log.queue.length > 1;
      },
      paused: false,
      speak(u: Utterance) {
        log.spoken.push(u.text);
        log.queue.push(u);
      },
      cancel() {
        log.cancels++;
        const q = log.queue;
        log.queue = [];
        for (const u of q) u.onerror?.({ error: "interrupted" });
      },
      getVoices: () => [],
      pause: () => undefined,
      resume: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, writable: true, value: Utterance });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
  }, opts);
}

const tts = (page: Page) => page.evaluate(() => (window as unknown as { __tts: Tts }).__tts).then((t) => ({ spoken: t.spoken, queued: t.queue.length, cancels: t.cancels }));
const mic = (page: Page) => page.evaluate(() => (window as unknown as { __handsFree: { mic: string } }).__handsFree.mic);
const hear = (page: Page, text: string) => page.evaluate((t) => (window as unknown as { __handsFree: { hear: (s: string) => void } }).__handsFree.hear(t), text);
const toggle = (page: Page) => page.getByRole("switch", { name: "Hands-free" });

test("the hands-free toggle is on mise en place, every step and the review; switching it on reads the prep list, a new step reads its ingredients then instructions (R4.31, R4.33)", { tag: ["@R4.31", "@R4.33"] }, async ({ page, household }) => {
  void household;
  await fakeVoice(page);
  const r = await makeCookRecipe("Hands-free flow");
  await page.goto(`/recipes/${r.id}/cook`);
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
  const sw = toggle(page);
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect(await mic(page)).toBe("off");
  expect((await tts(page)).spoken).toEqual([]);

  // On: in mise en place it reads the prep list only (R4.33), and the microphone opens.
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => mic(page)).toBe("on");
  await expect(sw).toHaveAttribute("data-state", "speaking");
  const mise = (await tts(page)).spoken;
  expect(mise).toEqual(["Dice the onion.", "Preheat the oven to 430 degrees Fahrenheit."]);

  // Entering step mode reads the step's ingredients, then its instructions.
  await page.getByRole("button", { name: "Start step mode →" }).click();
  await expect(page.getByTestId("step-card")).toContainText("Step 1 of 3", { ignoreCase: true });
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await tts(page)).spoken.slice(mise.length)).toEqual(["For step 1:", "600 grams chicken thigh.", "2 tablespoons olive oil.", "Step 1.", "Sear chicken thigh in olive oil for 10 minutes."]);

  // Every step has it; the next step is read on entering.
  await page.getByRole("button", { name: "Next step →" }).click();
  await expect.poll(async () => (await tts(page)).spoken.at(-1)).toMatch(/^Add baby spinach and let it wilt/);
  expect((await tts(page)).spoken).toContain("140 grams baby spinach.");
  await page.getByRole("button", { name: "Next step →" }).click();
  await expect.poll(async () => (await tts(page)).spoken.at(-1)).toBe("Rest and serve.");

  // The review has the toggle too, still on, and the microphone stayed open across the move.
  await page.getByRole("button", { name: "Done cooking ✓" }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => mic(page)).toBe("on");

  // No text about the commands anywhere (the owner asked for none).
  await expect(page.locator("body")).not.toContainText(/say “?next|unmute|shut up/i);
});

test("spoken commands: next, previous, last keyword wins, ingredients, steps, stop, mute and unmute (R4.32)", { tag: ["@R4.32"] }, async ({ page, household }) => {
  void household;
  await fakeVoice(page, { enabled: true }); // left on last time: it comes back on by itself (R4.31)
  const r = await makeCookRecipe("Hands-free commands");
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const card = page.getByTestId("step-card");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => mic(page)).toBe("on");
  await expect.poll(async () => (await tts(page)).spoken.at(-1)).toBe("Sear chicken thigh in olive oil for 10 minutes.");

  await hear(page, "Okay, next.");
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });
  await hear(page, "go back to the previous one");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await hear(page, "go back to the previous one, no wait, next");
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });
  await hear(page, "what was the step before");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await hear(page, "next step please");
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });
  await hear(page, "I said something without a keyword");
  await expect(card).toContainText("Step 2 of 3", { ignoreCase: true });

  // "ingredients" and "steps" / "instructions" read them again.
  let before = (await tts(page)).spoken.length;
  await hear(page, "what are the ingredients");
  await expect.poll(async () => (await tts(page)).spoken.slice(before)).toEqual(["For step 2:", "140 grams baby spinach."]);
  before = (await tts(page)).spoken.length;
  await hear(page, "read the instructions");
  await expect.poll(async () => (await tts(page)).spoken.slice(before)).toEqual(["Step 2.", "Add baby spinach and let it wilt for 3 seconds."]);
  before = (await tts(page)).spoken.length;
  await hear(page, "steps");
  await expect.poll(async () => (await tts(page)).spoken.length).toBe(before + 2);

  // "stop" silences at once; the user can talk over the voice (the mic stays open while it speaks).
  expect((await tts(page)).queued).toBeGreaterThan(0);
  const cancels = (await tts(page)).cancels;
  await hear(page, "stop");
  await expect.poll(async () => (await tts(page)).queued).toBe(0);
  expect((await tts(page)).cancels).toBeGreaterThan(cancels);
  expect(await mic(page)).toBe("on");

  // "shut up" mutes: a new step isn't read. "unmute" (never read as mute) lets it talk again.
  await hear(page, "steps");
  await hear(page, "shut up");
  await expect(toggle(page)).toHaveAttribute("data-state", "muted");
  expect((await tts(page)).queued).toBe(0);
  before = (await tts(page)).spoken.length;
  await hear(page, "next");
  await expect(card).toContainText("Step 3 of 3", { ignoreCase: true });
  await hear(page, "ingredients");
  await page.waitForTimeout(300);
  expect((await tts(page)).spoken.length).toBe(before);
  await hear(page, "unmute");
  await expect(toggle(page)).not.toHaveAttribute("data-state", "muted");
  await hear(page, "mute. no, unmute");
  await expect(toggle(page)).not.toHaveAttribute("data-state", "muted");
  await hear(page, "steps");
  await expect.poll(async () => (await tts(page)).spoken.at(-1)).toBe("Rest and serve.");
  // "next" on the last step doesn't finish cooking (that stays a tap).
  await hear(page, "next");
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/\/review\//);
});

test("no recording while off: the toggle closes the mic and silences at once; leaving the cooking pages closes the mic but keeps the setting (R4.34, R4.31)", { tag: ["@R4.34", "@R4.31"] }, async ({ page, household }) => {
  void household;
  await fakeVoice(page);
  const r = await makeCookRecipe("Hands-free privacy");
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const card = page.getByTestId("step-card");
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });
  await toggle(page).click();
  await expect.poll(() => mic(page)).toBe("on");
  expect((await tts(page)).queued).toBeGreaterThan(0);

  // Off: speech cancelled and the microphone closed straight away; anything "heard" afterwards does nothing.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  expect(await mic(page)).toBe("off");
  expect((await tts(page)).queued).toBe(0);
  await hear(page, "next");
  await page.waitForTimeout(300);
  await expect(card).toContainText("Step 1 of 3", { ignoreCase: true });

  // Back on, then leave the cooking view: the setting stays on but the microphone closes.
  await toggle(page).click();
  await expect.poll(() => mic(page)).toBe("on");
  await page.getByRole("button", { name: "Stop cooking" }).click();
  await expect(page).not.toHaveURL(/\/cook/);
  await expect.poll(() => mic(page)).toBe("off");
  expect(await page.evaluate(() => localStorage.getItem("sf.handsFree"))).toBe("1");
});

test("a meal's order list has no toggle and keeps the mic closed; a refused microphone switches hands-free off with a banner (R4.34, R4.31)", { tag: ["@R4.34", "@R4.31"] }, async ({ page, household }) => {
  const { seedPeriod, seedPlanItem, PlanPage } = await import("../pages/plan");
  await fakeVoice(page, { enabled: true });
  const a = await makeCookRecipe("Hands-free order a", { leftovers: 0 });
  const b = await makeCookRecipe("Hands-free order b", { leftovers: 0, lines: "Boil @jasmine rice{300%g} for ~{12%minutes}." });
  const pid = await seedPeriod(household.hid);
  await seedPlanItem(household.hid, pid, [a.id, b.id], { name: "Hands-free two-part" });
  await page.goto("/plan");
  await new PlanPage(page).item("Hands-free two-part").getByRole("button", { name: "Cook Hands-free two-part" }).click();
  await expect(page.getByRole("list", { name: "Recipes in cooking order" })).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(await mic(page)).toBe("off");
  await page.getByRole("button", { name: `Cook ${a.title}` }).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => mic(page)).toBe("on");

  // Microphone refused: an error banner, the toggle switches itself off, the cook carries on.
  await page.evaluate(() => {
    const h = (window as unknown as { __handsFree: { denyMic: boolean } }).__handsFree;
    h.denyMic = true;
  });
  await toggle(page).click();
  await toggle(page).click();
  await expect(page.getByText("Hands-free mode needs the microphone", { exact: false })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  expect(await mic(page)).toBe("off");
  await expect(page.getByRole("heading", { name: "Mise en place" })).toBeVisible();
});

test("the cook page with hands-free on passes axe; the toggle is at least 44 px tall (R4.31)", { tag: ["@R4.31"] }, async ({ page, household }) => {
  void household;
  await fakeVoice(page, { enabled: true });
  const r = await makeCookRecipe("Hands-free a11y");
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => mic(page)).toBe("on");
  const box = (await toggle(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await toggle(page).focus();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(bad).toEqual([]);
});
