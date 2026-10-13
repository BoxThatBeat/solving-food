// The real voice input (R4.32, R4.34): the microphone (mic.ts, main thread) feeding the speech worker (stt.worker.ts).
// The worker outlives a toggle off (so switching back on is instant) and ends when the cooking session closes.
import { diag, TALK_OVER_KEY } from "./diag";
import { isIOS, openMic, type Mic } from "./mic";
import { VoiceError } from "./errors";
import type { InputHooks, VoiceInput } from "./engine";
import type { SttRequest, SttResponse } from "./stt.worker";

/** Segments waiting for the worker beyond this are dropped, oldest first (the cook has moved on). */
const MAX_QUEUE = 3;
/** "0" once this device's WebGPU gave no adapter (M12): the worker goes straight to WASM next time. */
const GPU_KEY = "sf.handsFree.gpu";

/** Safari and every iOS browser (all WebKit): WebGPU there crashed the page while loading the model (M12). */
function isWebKit(): boolean {
  return /Apple/.test(navigator.vendor ?? "") || /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function tryGpu(): boolean {
  if (isWebKit()) return false;
  try {
    return localStorage.getItem(GPU_KEY) !== "0";
  } catch {
    return true;
  }
}

export function pauseWhileSpeaking(): boolean {
  try {
    const v = localStorage.getItem(TALK_OVER_KEY);
    if (v === "1") return false;
    if (v === "0") return true;
  } catch {
    /* the platform rule */
  }
  return isIOS();
}

const MODEL_FAILED = "The speech model couldn't be loaded, so hands-free mode is off. Check the connection and try again.";
const WORKER_FAILED = "The speech model stopped working, so hands-free mode is off.";

interface Queued {
  audio: Float32Array;
  /** `performance.now()` when the speech ended (before the silence wait). */
  endedAt: number;
}

export function realInput(): VoiceInput {
  let worker: Worker | null = null;
  let ready: Promise<void> | null = null;
  let mic: Mic | null = null;
  let hooks: InputHooks | null = null;
  let seq = 0;
  let inFlight: { id: number; endedAt: number; sentAt: number } | null = null;
  const queue: Queued[] = [];

  const send = () => {
    if (!worker || inFlight || !queue.length) return;
    const q = queue.shift()!;
    inFlight = { id: ++seq, endedAt: q.endedAt, sentAt: performance.now() };
    worker.postMessage({ type: "transcribe", id: inFlight.id, audio: q.audio } satisfies SttRequest, [q.audio.buffer]);
  };

  const finished = (id: number, text: string, ms?: number) => {
    const f = inFlight?.id === id ? inFlight : null;
    if (f) inFlight = null;
    if (f) diag("transcribed", { text: JSON.stringify(text), model_ms: ms, wait_ms: Math.round(f.sentAt - f.endedAt), total_ms: Math.round(performance.now() - f.endedAt) });
    hooks?.text(text, { endedAt: f?.endedAt ?? performance.now() });
    send();
    hooks?.busy(!!inFlight || queue.length > 0);
  };

  const ensureWorker = (): Promise<void> => {
    if (ready) return ready;
    const w = new Worker(new URL("./stt.worker.ts", import.meta.url), { type: "module" });
    worker = w;
    let loaded = false;
    const gpu = tryGpu();
    diag("model loading", { gpu });
    // A worker that crashes (out of memory, a script error) fails the start, or, once loaded, switches hands-free off.
    const crashed = (reject: (e: unknown) => void) => (ev: Event) => {
      console.warn("[hands-free] speech worker failed", ev instanceof ErrorEvent ? ev.message : ev.type);
      diag("worker crashed", ev instanceof ErrorEvent ? ev.message : ev.type);
      if (loaded) {
        dispose();
        hooks?.error(new VoiceError(WORKER_FAILED));
      } else reject(new VoiceError(MODEL_FAILED));
    };
    ready = new Promise<void>((resolve, reject) => {
      w.onerror = crashed(reject);
      w.onmessageerror = crashed(reject);
      w.onmessage = (e: MessageEvent<SttResponse>) => {
        const m = e.data;
        if (m.type === "ready") {
          loaded = true;
          diag("model ready", { model: m.model, device: m.device, load_ms: m.loadMs, warmup_ms: m.warmMs });
          return resolve();
        }
        if (m.type === "no-gpu") {
          diag("no WebGPU adapter");
          try {
            localStorage.setItem(GPU_KEY, "0");
          } catch {
            /* asks again next time */
          }
          return;
        }
        if (m.type === "text") return finished(m.id, m.text, m.ms);
        if (m.id === undefined) {
          console.warn("[hands-free] model load failed", m.message);
          diag("model load failed", m.message);
          return reject(new VoiceError(MODEL_FAILED));
        }
        console.warn("[hands-free] transcription failed", m.message);
        diag("transcription failed", m.message);
        finished(m.id, "");
      };
    });
    ready.catch(() => {
      w.terminate();
      if (worker === w) worker = null;
      ready = null;
    });
    w.postMessage({ type: "load", gpu } satisfies SttRequest);
    return ready;
  };

  const stop = () => {
    mic?.stop();
    mic = null;
    hooks = null;
    queue.length = 0;
  };

  const dispose = () => {
    stop();
    worker?.terminate();
    worker = null;
    ready = null;
    inFlight = null;
  };

  return {
    async start(h) {
      hooks = h;
      const loading = ensureWorker();
      mic = await openMic({
        pauseWhileSpeaking: pauseWhileSpeaking(),
        onSegment: (seg) => {
          const endedAt = performance.now() - seg.waitedMs;
          diag("segment", { ms: seg.ms, speech_ms: seg.voicedMs, rms: seg.rms, silence_wait_ms: seg.waitedMs, queued: queue.length + (inFlight ? 1 : 0) });
          queue.push({ audio: seg.pcm, endedAt });
          while (queue.length > MAX_QUEUE) {
            queue.shift();
            diag("segment dropped", "queue full");
          }
          hooks?.busy(true);
          void loading.then(send, () => undefined);
        },
        onError: (e) => hooks?.error(e),
      });
      await loading;
    },
    speaking(on) {
      mic?.speaking(on);
    },
    stop,
    dispose,
  };
}
