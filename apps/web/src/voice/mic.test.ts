// Microphone recovery (M13): iOS mutes the capture track and/or interrupts the AudioContext while speech synthesis
// plays. Against a fake track, stream and context: the context is resumed whenever it leaves "running", a track still
// muted after a read is re-acquired, iOS ignores frames while speaking and re-acquires after each batch, an ended track
// gets one re-acquire before hands-free fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechSegment } from "@solving-food/core";
import { NUDGE_CHECK_MS, openMic, type MicDeps } from "./mic";

class FakeTrack extends EventTarget {
  muted = false;
  readyState: "live" | "ended" = "live";
  stopped = false;
  stop() {
    this.stopped = true;
    this.readyState = "ended";
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.dispatchEvent(new Event(m ? "mute" : "unmute"));
  }
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream {
  constructor(public track = new FakeTrack()) {}
  getAudioTracks = () => [this.track];
  getTracks = () => [this.track];
}

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

class FakeContext extends EventTarget {
  state: AudioContextState | "interrupted" = "running";
  sampleRate = 16_000;
  destination = {};
  /** What `resume()` does: "running" works, otherwise the state stays. */
  resumeTo: AudioContextState | "interrupted" = "running";
  resumes = 0;
  closed = false;
  sources: Array<{ stream: FakeStream; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  createGain = () => ({ ...node(), gain: { value: 1 } });
  createMediaStreamSource = (stream: FakeStream) => {
    const s = { stream, ...node() };
    this.sources.push(s);
    return s;
  };
  resume = vi.fn(async () => {
    this.resumes++;
    this.setState(this.resumeTo);
  });
  close = vi.fn(async () => {
    this.closed = true;
    this.state = "closed";
  });
  setState(s: AudioContextState | "interrupted") {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new Event("statechange"));
  }
}

function setup(pauseWhileSpeaking = false) {
  const streams: FakeStream[] = [];
  const contexts: FakeContext[] = [];
  let feed: (chunk: Float32Array) => void = () => undefined;
  let gumFails = false;
  let t = 0;
  const deps: MicDeps = {
    getUserMedia: vi.fn(async () => {
      if (gumFails) throw new DOMException("gone", "NotFoundError");
      const s = new FakeStream();
      streams.push(s);
      return s as unknown as MediaStream;
    }),
    createContext: () => {
      const c = new FakeContext();
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    createCapture: async (_ctx, handle) => {
      feed = handle;
      return node() as unknown as AudioNode;
    },
    now: () => t,
  };
  const segments: SpeechSegment[] = [];
  const errors: unknown[] = [];
  const open = () => openMic({ onSegment: (s) => segments.push(s), onError: (e) => errors.push(e), pauseWhileSpeaking }, deps);
  const RATE = 16_000;
  const say = () => {
    feed(new Float32Array(RATE * 0.2)); // quiet
    feed(Float32Array.from({ length: RATE * 0.6 }, (_, i) => 0.2 * Math.sin(i / 3)));
    feed(new Float32Array(RATE * 1));
  };
  return {
    deps,
    streams,
    contexts,
    segments,
    errors,
    open,
    say,
    advance: (ms: number) => {
      t += ms;
      return vi.advanceTimersByTimeAsync(ms);
    },
    failGum: () => (gumFails = true),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("openMic recovery (M13)", () => {
  it("hears speech and emits a segment", async () => {
    const m = setup();
    const mic = await m.open();
    m.say();
    expect(m.segments).toHaveLength(1);
    mic.stop();
    expect(m.streams[0]!.track.stopped).toBe(true);
    expect(m.contexts[0]!.closed).toBe(true);
  });

  it("resumes the context whenever it leaves running, and on a tap", async () => {
    const m = setup();
    await m.open();
    const ctx = m.contexts[0]!;
    const before = ctx.resumes;
    ctx.setState("interrupted"); // iOS, while speech plays
    await m.advance(0);
    expect(ctx.resumes).toBe(before + 1);
    expect(ctx.state).toBe("running");
    ctx.resumeTo = "suspended";
    ctx.setState("suspended");
    await m.advance(0);
    ctx.resumeTo = "running";
    (window as unknown as EventTarget).dispatchEvent(new Event("pointerdown"));
    await m.advance(0);
    expect(ctx.state).toBe("running");
  });

  it("a track still muted after a read is re-acquired (the toggle stays on); an unmuted one is left alone", async () => {
    const m = setup();
    const mic = await m.open();
    mic.speaking(true);
    m.streams[0]!.track.setMuted(true); // iOS mutes the capture while speech plays
    mic.speaking(false);
    await m.advance(NUDGE_CHECK_MS + 10);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(2);
    expect(m.streams[0]!.track.stopped).toBe(true);
    expect(m.contexts[0]!.sources.at(-1)!.stream).toBe(m.streams[1]);
    expect(m.contexts[0]!.sources.at(-1)!.connect).toHaveBeenCalled();
    expect(m.errors).toEqual([]);
    // The new track works.
    m.say();
    expect(m.segments).toHaveLength(1);

    // A read that didn't mute anything: no re-acquire.
    mic.speaking(true);
    mic.speaking(false);
    await m.advance(NUDGE_CHECK_MS + 10);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("a context that stays interrupted after a read is rebuilt", async () => {
    const m = setup();
    const mic = await m.open();
    const ctx = m.contexts[0]!;
    ctx.resumeTo = "interrupted";
    mic.speaking(true);
    ctx.setState("interrupted");
    mic.speaking(false);
    await m.advance(NUDGE_CHECK_MS + 10);
    expect(m.contexts).toHaveLength(2);
    expect(ctx.closed).toBe(true);
    expect(m.contexts[1]!.sources.at(-1)!.stream).toBe(m.streams[1]);
    m.say();
    expect(m.segments).toHaveLength(1);
  });

  it("a track muted while the app is silent gets a second, then is re-acquired", async () => {
    const m = setup();
    await m.open();
    m.streams[0]!.track.setMuted(true);
    await m.advance(500);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(1);
    await m.advance(600);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("iOS: frames are ignored while speaking (the track is kept) and the mic is re-acquired after each batch", async () => {
    const m = setup(true);
    const mic = await m.open();
    mic.speaking(true);
    m.say(); // the app's own voice, or the user over it: not heard on iOS
    expect(m.segments).toHaveLength(0);
    expect(m.streams[0]!.track.stopped).toBe(false);
    mic.speaking(false);
    await m.advance(0);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(2);
    m.say();
    expect(m.segments).toHaveLength(1);
    // A cancel with nothing being read doesn't re-acquire.
    mic.speaking(false);
    await m.advance(NUDGE_CHECK_MS + 10);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("an ended track gets one re-acquire; ending again right away switches hands-free off", async () => {
    const m = setup();
    await m.open();
    await m.advance(5000);
    m.streams[0]!.track.end();
    await m.advance(0);
    expect(m.deps.getUserMedia).toHaveBeenCalledTimes(2);
    expect(m.errors).toEqual([]);
    m.streams[1]!.track.end();
    await m.advance(0);
    expect(m.errors).toHaveLength(1);
    expect(String((m.errors[0] as Error).message)).toMatch(/microphone stopped/);
  });

  it("a re-acquire that fails switches hands-free off", async () => {
    const m = setup();
    const mic = await m.open();
    m.failGum();
    mic.speaking(true);
    m.streams[0]!.track.setMuted(true);
    mic.speaking(false);
    await m.advance(NUDGE_CHECK_MS + 10);
    expect(m.errors).toHaveLength(1);
  });

  it("stop during a re-acquire releases the new stream", async () => {
    const m = setup();
    const mic = await m.open();
    mic.speaking(true);
    m.streams[0]!.track.setMuted(true);
    mic.speaking(false);
    await vi.advanceTimersByTimeAsync(NUDGE_CHECK_MS + 1);
    mic.stop();
    await m.advance(10);
    for (const s of m.streams) expect(s.track.stopped).toBe(true);
    expect(m.errors).toEqual([]);
  });
});
