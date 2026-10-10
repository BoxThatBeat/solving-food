// Cooking timer push (PRD R4.23; TECHNICAL_SPECS §12 "Cooking timers"). Starting a timer calls `scheduleTimer`, which
// records users/{uid}/timers/{timerId} and enqueues a Cloud Tasks task for `endsAt` on the `timers` queue; the task
// handler (`timers`, onTaskDispatched) sends a data-only web push through FCM to the user's devices, and the service
// worker shows it. Pausing or cancelling deletes the task; adjusting reschedules it under a new task name.
//
// Cloud Tasks and FCM have no emulator here, so both sit behind small adapters: production uses firebase-admin's
// task queue and messaging; under the Functions emulator (or in tests) a stub records tasks in `_stubTasks/{id}` and
// pushes in `_stubPushes/{id}`, with the same schedule/cancel semantics (a deleted task never fires).
import { FieldValue } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getMessaging } from "firebase-admin/messaging";
import { REGION, timerPushData, timerTaskId } from "@solving-food/core";
import { db } from "./admin";

export interface TimerTask {
  uid: string;
  timerId: string;
  taskId: string;
}

export interface TaskQueue {
  enqueue(task: TimerTask, scheduleAtMs: number): Promise<void>;
  delete(taskId: string): Promise<void>;
}

export interface Pusher {
  /** Sends data to every token; returns the tokens FCM says are gone. */
  send(tokens: string[], data: Record<string, string>): Promise<string[]>;
}

export const TIMER_QUEUE = "timers";

export const realQueue: TaskQueue = {
  async enqueue(task, scheduleAtMs) {
    const q = getFunctions().taskQueue(`locations/${REGION}/functions/${TIMER_QUEUE}`);
    await q.enqueue(task, { scheduleTime: new Date(scheduleAtMs), id: task.taskId });
  },
  async delete(taskId) {
    const q = getFunctions().taskQueue(`locations/${REGION}/functions/${TIMER_QUEUE}`);
    await q.delete(taskId).catch(() => undefined); // already fired or gone
  },
};

export const stubQueue: TaskQueue = {
  async enqueue(task, scheduleAtMs) {
    await db.doc(`_stubTasks/${task.taskId}`).set({ ...task, scheduleAtMs, state: "scheduled", createdAt: FieldValue.serverTimestamp() });
  },
  async delete(taskId) {
    const ref = db.doc(`_stubTasks/${taskId}`);
    const s = await ref.get();
    if (s.exists) await ref.update({ state: "deleted" });
  },
};

export const realPusher: Pusher = {
  async send(tokens, data) {
    if (!tokens.length) return [];
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      data,
      webpush: { headers: { Urgency: "high", TTL: "600" }, fcmOptions: { link: data.link } },
    });
    const gone: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code ?? "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token") || code.includes("invalid-argument")) gone.push(tokens[i]!);
    });
    return gone;
  },
};

export const stubPusher: Pusher = {
  async send(tokens, data) {
    await db.collection("_stubPushes").add({ tokens, data, createdAt: FieldValue.serverTimestamp() });
    return [];
  },
};

const emulated = () => process.env.FUNCTIONS_EMULATOR === "true";
export const defaultQueue = (): TaskQueue => (emulated() ? stubQueue : realQueue);
export const defaultPusher = (): Pusher => (emulated() ? stubPusher : realPusher);

export interface ScheduleInput {
  timerId: string;
  endsAt: number;
  label: string;
  title?: string | undefined;
  link: string;
}

const MAX_AHEAD_MS = 24 * 3600_000;

/** Schedules (or reschedules) a timer's push. Returns the task name. */
export async function scheduleTimer(uid: string, input: ScheduleInput, queue: TaskQueue = defaultQueue(), nowMs = Date.now()): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.timerId)) throw new Error("bad timer id");
  if (!(input.endsAt > nowMs - 5000) || input.endsAt > nowMs + MAX_AHEAD_MS) throw new Error("timer end out of range");
  if (!input.link.startsWith("/")) throw new Error("link must be an app path");
  const ref = db.doc(`users/${uid}/timers/${input.timerId}`);
  const prev = await ref.get();
  if (prev.exists && prev.data()!.taskId) await queue.delete(prev.data()!.taskId as string);
  const taskId = timerTaskId(uid, input.timerId, input.endsAt);
  await ref.set({ endsAt: input.endsAt, label: input.label.slice(0, 120), title: (input.title ?? "").slice(0, 120), link: input.link.slice(0, 300), taskId, createdAt: FieldValue.serverTimestamp() });
  await queue.enqueue({ uid, timerId: input.timerId, taskId }, input.endsAt);
  return taskId;
}

/** Pause or cancel: deletes the task and the record, so nothing fires. */
export async function cancelTimer(uid: string, timerId: string, queue: TaskQueue = defaultQueue()): Promise<void> {
  const ref = db.doc(`users/${uid}/timers/${timerId}`);
  const s = await ref.get();
  if (!s.exists) return;
  if (s.data()!.taskId) await queue.delete(s.data()!.taskId as string);
  await ref.delete();
}

/**
 * The task handler: sends the push if the timer is still the one this task was scheduled for (a task that was
 * superseded or cancelled finds a different task name or no record and does nothing). Prunes dead device tokens.
 */
export async function fireTimer(task: TimerTask, pusher: Pusher = defaultPusher()): Promise<{ sent: number } | { skipped: string }> {
  const ref = db.doc(`users/${task.uid}/timers/${task.timerId}`);
  const s = await ref.get();
  if (!s.exists) return { skipped: "cancelled" };
  const t = s.data()!;
  if (t.taskId !== task.taskId) return { skipped: "superseded" };
  const devices = await db.collection(`users/${task.uid}/devices`).get();
  const tokens = devices.docs.map((d) => d.id);
  const gone = await pusher.send(tokens, timerPushData({ label: String(t.label), title: t.title ? String(t.title) : undefined, link: String(t.link), timerId: task.timerId }));
  await Promise.all(gone.map((tok) => db.doc(`users/${task.uid}/devices/${tok}`).delete()));
  await ref.delete();
  return { sent: tokens.length - gone.length };
}
