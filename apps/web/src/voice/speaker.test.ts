// Speaker (M12): the speech-synthesis quirks that kept hands-free silent on the owner's devices, against a fake
// `speechSynthesis` that behaves like the browsers do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickVoice, Speaker, WATCHDOG_MS } from "./speaker";

type Mode = "normal" | "silent" | "not-allowed";

class FakeUtterance {
  lang = "";
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

/**
 * Like Chrome: a `speak()` in the same task as a `cancel()` is dropped (no events at all); `cancel()` fires
 * `interrupted` on what was queued. `silent` = a device without voices whose utterances never start or end.
 */
class FakeSynth {
  voices: Array<{ lang: string; localService: boolean; name: string }> = [{ lang: "en-US", localService: true, name: "US" }];
  mode: Mode = "normal";
  queue: FakeUtterance[] = [];
  heard: string[] = [];
  dropped: string[] = [];
  cancels = 0;
  private cancelledThisTask = false;
  private listeners: Array<() => void> = [];

  getVoices = () => this.voices;
  addEventListener = (_: string, fn: () => void) => void this.listeners.push(fn);
  removeEventListener = (_: string, fn: () => void) => void (this.listeners = this.listeners.filter((l) => l !== fn));
  fireVoicesChanged() {
    for (const l of [...this.listeners]) l();
  }

  speak = (u: FakeUtterance) => {
    if (this.cancelledThisTask) {
      this.dropped.push(u.text);
      return;
    }
    if (this.mode === "silent") return;
    if (this.mode === "not-allowed") {
      setTimeout(() => u.onerror?.({ error: "not-allowed" }), 0);
      return;
    }
    this.queue.push(u);
    if (this.queue.length === 1) setTimeout(() => this.queue[0] === u && u.onstart?.(), 0);
  };

  cancel = () => {
    this.cancels++;
    const q = this.queue;
    this.queue = [];
    for (const u of q) u.onerror?.({ error: "interrupted" });
    this.cancelledThisTask = true;
    setTimeout(() => (this.cancelledThisTask = false), 0);
  };

  /** The sentence being read finishes; the next starts. */
  finish() {
    const u = this.queue.shift();
    if (!u) return;
    this.heard.push(u.text);
    u.onend?.();
    const next = this.queue[0];
    next?.onstart?.();
  }
}

function setup() {
  const synth = new FakeSynth();
  const onSpeaking = vi.fn<(s: boolean) => void>();
  const onUnavailable = vi.fn<(reason: string) => void>();
  const speaker = new Speaker({ onSpeaking, onUnavailable }, synth as unknown as SpeechSynthesis, FakeUtterance as unknown as typeof SpeechSynthesisUtterance);
  const live = () => (speaker as unknown as { live: unknown[] }).live.length;
  return { synth, speaker, onSpeaking, onUnavailable, live };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pickVoice", () => {
  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });
  it("prefers en-CA, then a name without espeak-ng's '+' variants, then a natural voice over espeak-ng, then local", () => {
    // espeak-ng's list: thousands of voices, variants named "…+f3", none default.
    const espeak = Array.from({ length: 2000 }, (_, i) => v(`English (America)+variant${i}`, "en-US"));
    expect(pickVoice([...espeak, v("eSpeak English", "en-US"), v("pico en-US", "en-US"), v("Deutsch", "de-DE")])!.name).toBe("pico en-US");
    expect(pickVoice([...espeak, v("English (America)", "en-US")])!.name).toBe("English (America)");
    expect(pickVoice([v("Samantha", "en-US"), v("English (Canada)+f2", "en_CA")])!.name).toBe("English (Canada)+f2");
    expect(pickVoice([v("Serena", "en-GB", false), v("Daniel", "en-GB", true)])!.name).toBe("Daniel");
    expect(pickVoice([v("Amélie", "fr-CA")])).toBeUndefined();
    expect(pickVoice([])).toBeUndefined();
  });
});

describe("Speaker", () => {
  it("reads each sentence, in order, with the en-CA voice when the device has one", async () => {
    const { synth, speaker, onSpeaking } = setup();
    synth.voices.push({ lang: "en-CA", localService: true, name: "CA" });
    speaker.say(["Dice the onion. Preheat the oven."]);
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.queue.map((u) => u.text)).toEqual(["Dice the onion.", "Preheat the oven."]);
    expect((synth.queue[0]!.voice as { name: string }).name).toBe("CA");
    expect(synth.queue[0]!.lang).toBe("en-CA");
    expect(onSpeaking).toHaveBeenLastCalledWith(true);
    synth.finish();
    synth.finish();
    expect(synth.heard).toEqual(["Dice the onion.", "Preheat the oven."]);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
  });

  it("doesn't cancel when nothing is queued, and speaks a new batch a task after a cancel (Chrome drops a speak in the cancel's task)", async () => {
    const { synth, speaker, onUnavailable } = setup();
    speaker.say(["One."]);
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.cancels).toBe(0);
    expect(synth.queue.map((u) => u.text)).toEqual(["One."]);

    speaker.say(["Two."]); // replaces the batch being read
    expect(synth.cancels).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.dropped).toEqual([]);
    expect(synth.queue.map((u) => u.text)).toEqual(["Two."]);

    speaker.cancel();
    speaker.say(["Three."]); // "stop" then "steps"
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.dropped).toEqual([]);
    expect(synth.queue.map((u) => u.text)).toEqual(["Three."]);
    synth.finish();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("keeps every utterance referenced until it ends", async () => {
    const { synth, speaker, live } = setup();
    speaker.say(["A. B. C."]);
    await vi.advanceTimersByTimeAsync(0);
    expect(live()).toBe(3);
    synth.finish();
    expect(live()).toBe(2);
    synth.finish();
    synth.finish();
    expect(live()).toBe(0);
  });

  it("re-picks the voice on every voiceschanged: an early empty list, then the real one for later batches", async () => {
    const { synth, speaker } = setup();
    synth.voices = [];
    speaker.say(["First."]);
    synth.fireVoicesChanged(); // Linux Chromium: the first event comes with no voices
    await vi.advanceTimersByTimeAsync(1000); // the wait gives up after 1 s: the first read goes with lang alone
    expect(synth.queue.map((u) => [u.text, u.voice, u.lang])).toEqual([["First.", null, "en-CA"]]);
    synth.finish();
    synth.voices = [
      { lang: "en-US", localService: true, name: "English (America)+f3" },
      { lang: "en-CA", localService: true, name: "English (Canada)" },
    ];
    synth.fireVoicesChanged();
    speaker.say(["Second."]);
    await vi.advanceTimersByTimeAsync(0);
    expect((synth.queue[0]!.voice as { name: string }).name).toBe("English (Canada)");
  });

  it("a first read queued before the voice list arrived and never started is retried once with a voice", async () => {
    const { synth, speaker, onUnavailable } = setup();
    synth.voices = [];
    synth.mode = "silent";
    speaker.say(["Hello."]);
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    synth.voices = [{ lang: "en-US", localService: true, name: "English (America)" }];
    synth.fireVoicesChanged();
    synth.mode = "normal";
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    expect(synth.queue.map((u) => u.text)).toEqual(["Hello."]);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("waits for voiceschanged (once) before the first read", async () => {
    const { synth, speaker } = setup();
    synth.voices = [];
    speaker.say(["Hello."]);
    await vi.advanceTimersByTimeAsync(200);
    expect(synth.queue).toEqual([]);
    synth.voices = [{ lang: "en-CA", localService: true, name: "CA" }];
    synth.fireVoicesChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.queue.map((u) => (u.voice as { name: string }).name)).toEqual(["CA"]);
  });

  it("no voices and nothing starts: unavailable after the voices wait and the watchdog", async () => {
    const { synth, speaker, onUnavailable, onSpeaking } = setup();
    synth.voices = [];
    synth.mode = "silent";
    speaker.say(["Hello."]);
    await vi.advanceTimersByTimeAsync(1000 + WATCHDOG_MS - 10);
    expect(onUnavailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable.mock.calls[0]![0]).toMatch(/no voices/);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
    // Further reads don't retry (or warn again) until reset().
    speaker.say(["Again."]);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    speaker.reset();
    speaker.say(["Again."]);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10);
    expect(onUnavailable).toHaveBeenCalledTimes(2);
  });

  it("voices but the first sentence never starts (a refused speak): the watchdog reports unavailable", async () => {
    const { synth, speaker, onUnavailable } = setup();
    synth.mode = "silent";
    speaker.say(["Hello."]);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10);
    expect(onUnavailable).toHaveBeenCalledWith("speech never started");
  });

  it("a long read that started doesn't trip the watchdog", async () => {
    const { synth, speaker, onUnavailable } = setup();
    speaker.say(["A long sentence."]);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3);
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(synth.queue).toHaveLength(1);
  });

  it("not-allowed is a failure: unavailable", async () => {
    const { synth, speaker, onUnavailable } = setup();
    synth.mode = "not-allowed";
    speaker.say(["Hello."]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUnavailable).toHaveBeenCalledWith("speech error: not-allowed");
  });

  it("interrupted and canceled are a normal end, not a failure", async () => {
    const { synth, speaker, onUnavailable, onSpeaking, live } = setup();
    speaker.say(["A. B."]);
    await vi.advanceTimersByTimeAsync(0);
    synth.queue[0]!.onerror?.({ error: "interrupted" });
    synth.queue[1]!.onerror?.({ error: "canceled" });
    expect(live()).toBe(0);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
    speaker.say(["C."]);
    await vi.advanceTimersByTimeAsync(0);
    speaker.cancel(); // fires interrupted on C
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("remembers what it said for the echo filter", async () => {
    const { synth, speaker } = setup();
    speaker.say(["Next, add the spinach."]);
    expect(speaker.recent()).toEqual(["Next, add the spinach."]);
    await vi.advanceTimersByTimeAsync(0);
    synth.finish();
    await vi.advanceTimersByTimeAsync(9000);
    expect(speaker.recent()).toEqual([]);
  });
});
