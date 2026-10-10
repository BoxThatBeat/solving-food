// timers.spec.ts (TECHNICAL_SPECS §14.1): start, pause, adjust, cancel; the foreground alarm; the push scheduled and
// cancelled on the stub task queue; the install prompt on iPhone Safari; the offline warning. WebKit on Linux has no
// Push or Notification API, so on phone-ios the specs assert the UI around them (§14.1 "WebKit limits").
import { adminDb } from "../fixtures/admin";
import { expect, test } from "../fixtures/test";
import { makeCookRecipe } from "../pages/supply";
import type { Page } from "@playwright/test";

async function dismissInstall(page: Page) {
  const sheet = page.getByRole("dialog", { name: "Install for timer alerts" });
  if (await sheet.isVisible({ timeout: 1_500 }).catch(() => false)) await sheet.getByRole("button", { name: /Got it|Install/ }).click();
}

async function stubTasks(uid: string) {
  const snap = await adminDb.collection("_stubTasks").where("uid", "==", uid).get();
  return snap.docs.map((d) => d.data() as { state: string; scheduleAtMs: number; timerId: string });
}

test("start a timer: it counts down on wall-clock time and schedules the locked-phone push; pause cancels it; adjust reschedules (R4.23)", { tag: ["@R4.23", "@smoke"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Timer flow");
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  const timer = page.getByTestId("timer");
  await expect(timer).toHaveAttribute("data-state", "idle");
  await expect(timer.getByRole("timer")).toHaveText("10:00");
  const t0 = Date.now();
  await timer.getByRole("button", { name: "Start timer" }).click();
  await dismissInstall(page); // iPhone Safari asks to install first (covered in its own test below)
  await expect(timer).toHaveAttribute("data-state", "running");
  await expect(timer.getByRole("timer")).not.toHaveText("10:00", { timeout: 5_000 });
  await expect.poll(async () => (await stubTasks(household.uid)).filter((t) => t.state === "scheduled").length, { timeout: 15_000 }).toBe(1);
  const [task] = await stubTasks(household.uid);
  expect(task!.scheduleAtMs).toBeGreaterThan(t0 + 9 * 60_000);
  expect(task!.scheduleAtMs).toBeLessThan(Date.now() + 10 * 60_000 + 5_000);

  await timer.getByRole("button", { name: "Add a minute" }).click();
  await expect.poll(async () => (await stubTasks(household.uid)).filter((t) => t.state === "scheduled").map((t) => Math.round((t.scheduleAtMs - t0) / 60_000)), { timeout: 15_000 }).toEqual([11]);
  await timer.getByRole("button", { name: "Pause" }).click();
  await expect(timer).toHaveAttribute("data-state", "paused");
  await expect.poll(async () => (await stubTasks(household.uid)).filter((t) => t.state === "scheduled").length, { timeout: 15_000 }).toBe(0);
  await timer.getByRole("button", { name: "Resume" }).click();
  await expect(timer).toHaveAttribute("data-state", "running");
  await timer.getByRole("button", { name: "Cancel" }).click();
  await expect(timer).toHaveAttribute("data-state", "idle");
  await expect.poll(async () => (await stubTasks(household.uid)).filter((t) => t.state === "scheduled").length, { timeout: 15_000 }).toBe(0);
});

test("when a timer ends in the page, it rings and says so (R4.23)", { tag: ["@R4.23"] }, async ({ page, household }) => {
  const r = await makeCookRecipe("Alarm flow");
  await page.goto(`/recipes/${r.id}/cook?step=1`);
  const timer = page.getByTestId("timer");
  await expect(timer.getByRole("timer")).toHaveText("0:03");
  await timer.getByRole("button", { name: "Start timer" }).click();
  await dismissInstall(page);
  await expect(timer).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  await expect(timer).toContainText("Time's up!");
  await expect(page.getByTestId("notifications")).toContainText(/time's up/i);
  void household;
});

test("first timer on iPhone Safari asks to install the app; offline, it warns there'll be no lock-screen alert (R4.23)", { tag: ["@R4.23"] }, async ({ page, household, context, browserName }) => {
  const r = await makeCookRecipe("Install flow");
  await page.goto(`/recipes/${r.id}/cook?step=0`);
  await expect(page.getByTestId("timer")).toBeVisible();
  if (browserName === "webkit" && /iPhone/.test(await page.evaluate(() => navigator.userAgent))) {
    await page.getByTestId("timer").getByRole("button", { name: "Start timer" }).click();
    const sheet = page.getByRole("dialog", { name: "Install for timer alerts" });
    await expect(sheet.getByTestId("install-prompt")).toContainText("Add to Home Screen");
    await sheet.getByRole("button", { name: /Got it|Install/ }).click();
    await page.getByTestId("timer").getByRole("button", { name: "Cancel" }).click();
  }
  await context.setOffline(true);
  await page.getByTestId("timer").getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByTestId("notifications")).toContainText("won't alert while the phone is locked");
  await expect(page.getByTestId("timer")).toHaveAttribute("data-state", "running");
  await context.setOffline(false);
  void household;
});
