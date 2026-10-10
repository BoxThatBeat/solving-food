// Timer push (R4.23, §12): schedule/cancel/reschedule against the stub queue, and the task handler's push payload
// through the stub pusher. The real adapters (Cloud Tasks, FCM) are a few lines each in src/timers.ts.
import { beforeAll, describe, expect, it } from "vitest";
import { cancelTimer, fireTimer, scheduleTimer, stubPusher, stubQueue, type TaskQueue } from "../src/timers";
import { clearFirestore, db } from "./helpers";

const UID = "timer-user";

/** In-memory queue with Cloud Tasks semantics: deleted tasks never fire. */
function memoryQueue() {
  const tasks = new Map<string, { task: { uid: string; timerId: string; taskId: string }; at: number; deleted: boolean }>();
  const q: TaskQueue = {
    async enqueue(task, at) {
      if (tasks.has(task.taskId)) throw new Error("ALREADY_EXISTS");
      tasks.set(task.taskId, { task, at, deleted: false });
    },
    async delete(id) {
      const t = tasks.get(id);
      if (t) t.deleted = true;
    },
  };
  const due = (now: number) => [...tasks.values()].filter((t) => !t.deleted && t.at <= now).map((t) => t.task);
  return { q, tasks, due };
}

describe("cooking timer push", () => {
  beforeAll(async () => {
    await clearFirestore();
    await db.doc(`users/${UID}/devices/tok-a`).set({ platform: "web", createdAt: new Date(), lastSeenAt: new Date() });
    await db.doc(`users/${UID}/devices/tok-b`).set({ platform: "web", createdAt: new Date(), lastSeenAt: new Date() });
  });

  it("schedules a task at endsAt and fires a push naming the timer, opening the step", async () => {
    const now = Date.now();
    const m = memoryQueue();
    const taskId = await scheduleTimer(UID, { timerId: "t1", endsAt: now + 60_000, label: "Roast", title: "Salmon", link: "/recipes/r1/cook?step=2" }, m.q, now);
    expect(m.due(now)).toEqual([]);
    const [task] = m.due(now + 60_000);
    expect(task).toEqual({ uid: UID, timerId: "t1", taskId });
    await fireTimer(task!, stubPusher);
    const pushes = await db.collection("_stubPushes").get();
    expect(pushes.size).toBe(1);
    expect(pushes.docs[0]!.data().tokens.sort()).toEqual(["tok-a", "tok-b"]);
    expect(pushes.docs[0]!.data().data).toEqual({ kind: "timer", title: "Salmon: Roast", body: "Timer done", link: "/recipes/r1/cook?step=2", timerId: "t1" });
    expect((await db.doc(`users/${UID}/timers/t1`).get()).exists).toBe(false);
  });

  it("cancel deletes the task; reschedule supersedes the old one", async () => {
    const now = Date.now();
    const m = memoryQueue();
    await scheduleTimer(UID, { timerId: "t2", endsAt: now + 60_000, label: "Rest", link: "/plan" }, m.q, now);
    await cancelTimer(UID, "t2", m.q);
    expect(m.due(now + 120_000)).toEqual([]);
    const first = await scheduleTimer(UID, { timerId: "t3", endsAt: now + 60_000, label: "Boil", link: "/plan" }, m.q, now);
    const second = await scheduleTimer(UID, { timerId: "t3", endsAt: now + 120_000, label: "Boil", link: "/plan" }, m.q, now);
    expect(second).not.toBe(first);
    expect(m.due(now + 200_000).map((t) => t.taskId)).toEqual([second]);
    // A stale task that still fires (delete raced) is ignored.
    expect(await fireTimer({ uid: UID, timerId: "t3", taskId: first }, stubPusher)).toEqual({ skipped: "superseded" });
  });

  it("refuses bad input; the emulator stub queue records schedule and cancel", async () => {
    await expect(scheduleTimer(UID, { timerId: "bad id!", endsAt: Date.now() + 1000, label: "x", link: "/" }, stubQueue)).rejects.toThrow();
    await expect(scheduleTimer(UID, { timerId: "t4", endsAt: Date.now() + 3 * 86_400_000, label: "x", link: "/" }, stubQueue)).rejects.toThrow();
    const id = await scheduleTimer(UID, { timerId: "t5", endsAt: Date.now() + 30_000, label: "x", link: "/" }, stubQueue);
    expect((await db.doc(`_stubTasks/${id}`).get()).data()?.state).toBe("scheduled");
    await cancelTimer(UID, "t5", stubQueue);
    expect((await db.doc(`_stubTasks/${id}`).get()).data()?.state).toBe("deleted");
  });
});
