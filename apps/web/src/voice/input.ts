// The real voice input (R4.32, R4.34): the microphone (mic.ts, main thread) feeding the Whisper worker (stt.worker.ts).
// The worker outlives a toggle off (so switching back on is instant) and ends when the cooking session closes.
import { openMic, type Mic } from "./mic";
import { VoiceError } from "./errors";
import type { VoiceInput } from "./engine";
import type { SttRequest, SttResponse } from "./stt.worker";

/** Segments waiting for the worker beyond this are dropped, oldest first (the cook has moved on). */
const MAX_QUEUE = 3;

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
    ready = new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<SttResponse>) => {
        const m = e.data;
        if (m.type === "ready") return resolve();
        if (m.type === "text") {
          if (m.id === inFlight) inFlight = 0;
          if (m.text) onText?.(m.text);
          send();
          return;
        }
        if (m.id === undefined) return reject(new VoiceError("The speech model couldn't be loaded, so hands-free mode is off. Check the connection and try again."));
        if (m.id === inFlight) inFlight = 0;
        console.warn("[hands-free] transcription failed", m.message);
        send();
      };
      w.onerror = () => reject(new VoiceError("The speech model couldn't be started, so hands-free mode is off."));
    });
    ready.catch(() => {
      w.terminate();
      if (worker === w) worker = null;
      ready = null;
    });
    w.postMessage({ type: "load" } satisfies SttRequest);
    return ready;
  };

  const stop = () => {
    mic?.stop();
    mic = null;
    onText = null;
    queue.length = 0;
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
    dispose() {
      stop();
      worker?.terminate();
      worker = null;
      ready = null;
      inFlight = 0;
    },
  };
}
