// The real voice input (R4.32, R4.34): the microphone (mic.ts, main thread) feeding the Whisper worker (stt.worker.ts).
// The worker outlives a toggle off (so switching back on is instant) and ends when the cooking session closes.
import { openMic, type Mic } from "./mic";
import { VoiceError } from "./errors";
import type { VoiceInput } from "./engine";
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

const MODEL_FAILED = "The speech model couldn't be loaded, so hands-free mode is off. Check the connection and try again.";
const WORKER_FAILED = "The speech model stopped working, so hands-free mode is off.";

export function realInput(): VoiceInput {
  let worker: Worker | null = null;
  let ready: Promise<void> | null = null;
  let mic: Mic | null = null;
  let onText: ((t: string) => void) | null = null;
  let onError: ((e: unknown) => void) | null = null;
  let seq = 0;
  let inFlight = 0;
  const queue: Float32Array[] = [];

  const send = () => {
    if (!worker || inFlight || !queue.length) return;
    const audio = queue.shift()!;
    inFlight = ++seq;
    worker.postMessage({ type: "transcribe", id: inFlight, audio } satisfies SttRequest, [audio.buffer]);
  };

  const ensureWorker = (): Promise<void> => {
    if (ready) return ready;
    const w = new Worker(new URL("./stt.worker.ts", import.meta.url), { type: "module" });
    worker = w;
    let loaded = false;
    // A worker that crashes (out of memory, a script error) fails the start, or, once loaded, switches hands-free off.
    const crashed = (reject: (e: unknown) => void) => (ev: Event) => {
      console.warn("[hands-free] speech worker failed", ev instanceof ErrorEvent ? ev.message : ev.type);
      if (loaded) {
        dispose();
        onError?.(new VoiceError(WORKER_FAILED));
      } else reject(new VoiceError(MODEL_FAILED));
    };
    ready = new Promise<void>((resolve, reject) => {
      w.onerror = crashed(reject);
      w.onmessageerror = crashed(reject);
      w.onmessage = (e: MessageEvent<SttResponse>) => {
        const m = e.data;
        if (m.type === "ready") {
          loaded = true;
          return resolve();
        }
        if (m.type === "no-gpu") {
          try {
            localStorage.setItem(GPU_KEY, "0");
          } catch {
            /* asks again next time */
          }
          return;
        }
        if (m.type === "text") {
          if (m.id === inFlight) inFlight = 0;
          if (m.text) onText?.(m.text);
          send();
          return;
        }
        if (m.id === undefined) {
          console.warn("[hands-free] model load failed", m.message);
          return reject(new VoiceError(MODEL_FAILED));
        }
        if (m.id === inFlight) inFlight = 0;
        console.warn("[hands-free] transcription failed", m.message);
        send();
      };
    });
    ready.catch(() => {
      w.terminate();
      if (worker === w) worker = null;
      ready = null;
    });
    w.postMessage({ type: "load", gpu: tryGpu() } satisfies SttRequest);
    return ready;
  };

  const stop = () => {
    mic?.stop();
    mic = null;
    onText = null;
    queue.length = 0;
  };

  const dispose = () => {
    stop();
    worker?.terminate();
    worker = null;
    ready = null;
    inFlight = 0;
  };

  return {
    async start(text, error) {
      onText = text;
      onError = error;
      const loading = ensureWorker();
      mic = await openMic(
        (pcm) => {
          queue.push(pcm);
          while (queue.length > MAX_QUEUE) queue.shift();
          void loading.then(send, () => undefined);
        },
        (e) => onError?.(e),
      );
      await loading;
    },
    stop,
    dispose,
  };
}
