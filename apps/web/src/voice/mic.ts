// Microphone capture for hands-free mode (R4.32, R4.34), on the main thread and apart from the model worker. Audio is
// read at the device's rate by an AudioWorklet (a ScriptProcessor where there is none), downsampled to 16 kHz mono,
// and cut into utterances by `SpeechSegmenter` (`SILENCE_MS` of silence ends one). Nothing is stored or sent anywhere:
// each segment goes straight to `onSegment` (the worker), and `stop()` ends every track so the browser's recording
// indicator goes away.
//
// Recovery (M13): on iOS, playing `speechSynthesis` changes the audio session; WebKit mutes the capture track and/or
// moves the AudioContext to "interrupted"/"suspended", and M12 never looked again, so after the first read the
// segmenter heard silence for good. Now the context is resumed on every `statechange` away from "running" (and on any
// tap), track `mute`/`unmute`/`ended` are watched, and after every speech batch (`speaking(false)`, also after a
// cancel) the mic is nudged: resume, and if the track is still muted or the context still not running ~500 ms later,
// the microphone is re-acquired (new `getUserMedia`, the old track stopped, the worklet reconnected) without touching
// the toggle. On iOS (`pauseWhileSpeaking`) frames are ignored while the app speaks and the microphone is re-acquired
// right after each batch.
import { downsample, SpeechSegmenter, type SpeechSegment } from "@solving-food/core";
import { diag } from "./diag";
import { VoiceError } from "./errors";

/** The worklet: batches the 128-sample render quanta into ~2048-sample chunks and posts them to the page. */
const WORKLET = `
class SfCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(2048); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("sf-capture", SfCapture);
`;

/** How long after a nudge the track may still be muted before the microphone is re-acquired. */
export const NUDGE_CHECK_MS = 500;
/** A track muted while the app is silent gets this long to unmute by itself. */
const MUTE_CHECK_MS = 1000;
/** Re-acquiring more often than this means it isn't helping: an `ended` track then fails as before. */
const REACQUIRE_MIN_GAP_MS = 3000;

export interface Mic {
  stop(): void;
  /** The app started (true) or finished/cancelled (false) reading aloud. */
  speaking(on: boolean): void;
}

export interface MicOptions {
  onSegment(seg: SpeechSegment): void;
  onError(e: unknown): void;
  /** Ignore frames while the app speaks and re-acquire after every batch (iOS). */
  pauseWhileSpeaking: boolean;
}

/** The browser pieces mic.ts uses, injectable for tests. */
export interface MicDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
  /** Builds the capture node on `ctx` that calls `handle` with chunks of PCM at `ctx.sampleRate`. */
  createCapture(ctx: AudioContext, handle: (chunk: Float32Array) => void): Promise<AudioNode>;
  now(): number;
}

const CONSTRAINTS: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };

/** iPhone, iPad (also iPadOS's desktop UA), iPod: every browser there is WebKit with iOS's audio session. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
}

async function createCapture(ctx: AudioContext, handle: (chunk: Float32Array) => void): Promise<AudioNode> {
  try {
    if (!ctx.audioWorklet) throw new Error("no worklet");
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const w = new AudioWorkletNode(ctx, "sf-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    w.port.onmessage = (e: MessageEvent<Float32Array>) => handle(e.data);
    return w;
  } catch {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
    return sp;
  }
}

function browserDeps(): MicDeps {
  const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AC) throw new VoiceError("This browser can't listen, so hands-free mode is off.");
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    createContext: () => new AC(),
    createCapture,
    now: () => performance.now(),
  };
}

function micError(e: unknown): VoiceError {
  const n = (e as { name?: unknown } | null)?.name;
  const name = typeof n === "string" ? n : "";
  if (name === "NotAllowedError" || name === "SecurityError") return new VoiceError("Hands-free mode needs the microphone. Allow it for this site in the browser's settings.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new VoiceError("No microphone was found, so hands-free mode is off.");
  return new VoiceError("The microphone couldn't be opened, so hands-free mode is off.");
}

const STOPPED = "The microphone stopped, so hands-free mode is off.";

export async function openMic(opts: MicOptions, deps: MicDeps = browserDeps()): Promise<Mic> {
  let stream: MediaStream;
  try {
    stream = await deps.getUserMedia(CONSTRAINTS);
  } catch (e) {
    throw micError(e);
  }
  diag("mic opened", { tracks: stream.getAudioTracks().length, muted: stream.getAudioTracks()[0]?.muted, pauseWhileSpeaking: opts.pauseWhileSpeaking });

  let stopped = false;
  let paused = false;
  let speakingNow = false;
  let reacquiring = false;
  let lastReacquire = -Infinity;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  const segmenter = new SpeechSegmenter({ onShort: (voicedMs) => diag("segment ignored", { speech_ms: voicedMs }) });

  let ctx = deps.createContext();
  const handle = (chunk: Float32Array) => {
    if (stopped || paused) return;
    for (const seg of segmenter.pushSegments(downsample(chunk, ctx.sampleRate))) opts.onSegment(seg);
  };

  const resume = (why: string) => {
    if (stopped || ctx.state === "running" || ctx.state === "closed") return;
    void ctx.resume().then(
      () => diag("context resumed", { why, state: ctx.state }),
      (e: unknown) => diag("context resume failed", { why, state: ctx.state, error: String(e) }),
    );
  };
  const onState = () => {
    diag("context state", ctx.state);
    resume("statechange");
  };
  // Without a user gesture the context can start (or be left) suspended: any tap or key resumes it.
  const onGesture = () => resume("gesture");

  const watchContext = (c: AudioContext) => c.addEventListener("statechange", onState);
  watchContext(ctx);
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });

  const sink = ctx.createGain();
  sink.gain.value = 0; // pulls the graph without playing the microphone back
  sink.connect(ctx.destination);
  let node = await deps.createCapture(ctx, handle);
  node.connect(sink);
  let source = ctx.createMediaStreamSource(stream);
  source.connect(node);
  resume("open");

  const trackHandlers = new Map<MediaStreamTrack, Array<[string, () => void]>>();
  const watchTracks = (s: MediaStream) => {
    for (const t of s.getAudioTracks()) {
      const hs: Array<[string, () => void]> = [
        ["mute", () => onMute(t)],
        ["unmute", () => diag("track unmuted")],
        ["ended", () => onEnded(t)],
      ];
      for (const [ev, fn] of hs) t.addEventListener(ev, fn);
      trackHandlers.set(t, hs);
    }
  };
  const releaseStream = (s: MediaStream) => {
    for (const t of s.getTracks()) {
      for (const [ev, fn] of trackHandlers.get(t) ?? []) t.removeEventListener(ev, fn);
      trackHandlers.delete(t);
      t.stop();
    }
  };
  const muted = () => stream.getAudioTracks().some((t) => t.muted || t.readyState === "ended");

  /** A new `getUserMedia` stream on the same graph; a context that still won't run gets rebuilt as well. */
  const reacquire = async (why: string) => {
    if (stopped || reacquiring) return;
    reacquiring = true;
    lastReacquire = deps.now();
    const t0 = deps.now();
    try {
      const old = stream;
      try {
        source.disconnect();
      } catch {
        /* already */
      }
      releaseStream(old);
      const next = await deps.getUserMedia(CONSTRAINTS);
      if (stopped) {
        releaseStream(next);
        return;
      }
      stream = next;
      watchTracks(stream);
      if (ctx.state !== "running") {
        await ctx.resume().catch(() => undefined);
      }
      if (ctx.state !== "running" && ctx.state !== "closed") {
        // The context stayed interrupted: build a new one (its sink and capture node too).
        diag("context rebuilt", { was: ctx.state });
        const oldCtx = ctx;
        oldCtx.removeEventListener("statechange", onState);
        try {
          node.disconnect();
        } catch {
          /* already */
        }
        void oldCtx.close().catch(() => undefined);
        ctx = deps.createContext();
        watchContext(ctx);
        const s = ctx.createGain();
        s.gain.value = 0;
        s.connect(ctx.destination);
        node = await deps.createCapture(ctx, handle);
        node.connect(s);
        resume("rebuilt");
      }
      if (stopped) return;
      source = ctx.createMediaStreamSource(stream);
      source.connect(node);
      segmenter.reset();
      diag("mic re-acquired", { why, ms: Math.round(deps.now() - t0), muted: stream.getAudioTracks()[0]?.muted, state: ctx.state });
    } catch (e) {
      diag("mic re-acquire failed", { why, error: String(e) });
      if (!stopped) {
        stop();
        opts.onError(new VoiceError(STOPPED));
      }
    } finally {
      reacquiring = false;
    }
  };

  const schedule = (ms: number, fn: () => void) => {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      checkTimer = null;
      if (!stopped) fn();
    }, ms);
  };

  function onMute(t: MediaStreamTrack) {
    diag("track muted", { speaking: speakingNow });
    void t;
    // Muted while the app is silent (another app took the mic, a call): give it a second, then re-acquire.
    if (speakingNow || deps.now() - lastReacquire < REACQUIRE_MIN_GAP_MS) return;
    schedule(MUTE_CHECK_MS, () => {
      if (!speakingNow && muted()) void reacquire("muted while idle");
    });
  }

  function onEnded(t: MediaStreamTrack) {
    diag("track ended");
    void t;
    if (stopped || reacquiring) return;
    // Unplugged, or iOS ended it: one re-acquire; a second end soon after means the microphone is really gone.
    if (deps.now() - lastReacquire < REACQUIRE_MIN_GAP_MS) {
      stop();
      opts.onError(new VoiceError(STOPPED));
      return;
    }
    void reacquire("ended");
  }

  watchTracks(stream);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (checkTimer) clearTimeout(checkTimer);
    window.removeEventListener("pointerdown", onGesture, { capture: true });
    window.removeEventListener("keydown", onGesture, { capture: true });
    ctx.removeEventListener("statechange", onState);
    releaseStream(stream);
    try {
      source.disconnect();
      node.disconnect();
    } catch {
      /* already disconnected */
    }
    void ctx.close().catch(() => undefined);
    segmenter.reset();
    diag("mic closed");
  };

  const speaking = (on: boolean) => {
    if (stopped) return;
    if (on) {
      speakingNow = true;
      if (opts.pauseWhileSpeaking && !paused) {
        paused = true;
        segmenter.reset();
        diag("listening paused", "app speaking");
      }
      return;
    }
    const was = speakingNow;
    speakingNow = false;
    if (paused) {
      paused = false;
      segmenter.reset();
      diag("listening resumed");
    }
    resume("speech ended");
    if (opts.pauseWhileSpeaking && was) {
      // iOS: the read changed the audio session; a fresh capture is the reliable way back.
      void reacquire("after speech");
      return;
    }
    schedule(NUDGE_CHECK_MS, () => {
      if (speakingNow) return;
      const bad = muted() || (ctx.state !== "running" && ctx.state !== "closed");
      diag("mic check", { muted: muted(), state: ctx.state });
      if (bad) void reacquire(muted() ? "still muted after speech" : `context ${ctx.state} after speech`);
    });
  };

  return { stop, speaking };
}
